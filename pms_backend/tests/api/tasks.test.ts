import sinon from 'sinon';
import request from 'supertest';
import { expect } from 'chai';
import { app } from '../../src/app';
import { TaskService } from '../../src/components/tasks/tasks_service';
import { ProjectsUtil } from '../../src/utils/projects_util';
import { NotificationUtil } from '../../src/utils/notification_util';
import * as composition from '../../src/infrastructure/composition';
import { CreateTaskUseCase } from '../../src/use-cases/create_task_use_case';
import { InMemoryTaskRepository, InMemoryReferenceLookup } from '../../src/adapters/repositories/in_memory_task_repository';
import { TaskNotificationsAdapter } from '../../src/adapters/task_notifications_adapter';
import { ok, stubAuth } from '../helpers/auth';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const flush = () => new Promise((resolve) => setImmediate(resolve));
const useCaseWith = (projects: string[], users: string[]) =>
    sinon.stub(composition, 'buildCreateTaskUseCase').returns(
        new CreateTaskUseCase(new InMemoryTaskRepository(), new InMemoryReferenceLookup(projects, users), new TaskNotificationsAdapter()));
const validTask = { name: 'Implementar API', project_id: PROJECT_ID, user_id: USER_ID };

describe('Pruebas de integración: tareas (/api/tasks)', () => {
    afterEach(() => sinon.restore());

    it('rechaza peticiones sin token (401)', async () => {
        expect((await request(app).get('/api/tasks')).status).to.equal(401);
    });

    it('rechaza la creación sin el derecho add_task (403)', async () => {
        const token = stubAuth([]);
        const res = await request(app).post('/api/tasks').set('Authorization', `Bearer ${token}`).send(validTask);
        expect(res.status).to.equal(403);
    });

    it('valida UUIDs, estado y fechas del cuerpo (400)', async () => {
        const token = stubAuth(['add_task']);
        const res = await request(app).post('/api/tasks').set('Authorization', `Bearer ${token}`)
            .send({ name: 'Tarea', project_id: 'x', user_id: 'y', status: 'Otro', estimated_start_time: '2026-12-01', estimated_end_time: '2026-11-01' });
        expect(res.status).to.equal(400);
    });

    it('crea la tarea y encola un correo para cada miembro del proyecto (201)', async () => {
        const token = stubAuth(['add_task']);
        useCaseWith([PROJECT_ID], [USER_ID]);
        sinon.stub(ProjectsUtil, 'getProjectMemberEmails').resolves(['dev1@pms.com', 'dev2@pms.com']);
        const enqueue = sinon.stub(NotificationUtil, 'enqueueEmail').resolves();

        const res = await request(app).post('/api/tasks').set('Authorization', `Bearer ${token}`).send(validTask);

        expect(res.status).to.equal(201);
        await flush();
        expect(enqueue.callCount).to.equal(2);
        expect(enqueue.firstCall.args[0]).to.equal('dev1@pms.com');
        expect(enqueue.firstCall.args[1]).to.contain('Implementar API');
    });

    it('no bloquea la respuesta si falla el encolado de notificaciones', async () => {
        const token = stubAuth(['add_task']);
        useCaseWith([PROJECT_ID], [USER_ID]);
        sinon.stub(ProjectsUtil, 'getProjectMemberEmails').rejects(new Error('redis caído'));
        sinon.stub(console, 'error');

        const res = await request(app).post('/api/tasks').set('Authorization', `Bearer ${token}`).send(validTask);
        expect(res.status).to.equal(201);
    });

    it('responde 201 aunque Redis no conteste y el encolado quede pendiente', async () => {
        const token = stubAuth(['add_task']);
        useCaseWith([PROJECT_ID], [USER_ID]);
        sinon.stub(ProjectsUtil, 'getProjectMemberEmails').resolves(['dev1@pms.com']);
        sinon.stub(NotificationUtil, 'enqueueEmail').returns(new Promise<void>(() => undefined));

        const res = await request(app).post('/api/tasks').set('Authorization', `Bearer ${token}`).send(validTask);
        expect(res.status).to.equal(201);
    });

    it('escapa el nombre de la tarea en el HTML del correo', async () => {
        const token = stubAuth(['add_task']);
        useCaseWith([PROJECT_ID], [USER_ID]);
        sinon.stub(ProjectsUtil, 'getProjectMemberEmails').resolves(['dev1@pms.com']);
        const enqueue = sinon.stub(NotificationUtil, 'enqueueEmail').resolves();

        await request(app).post('/api/tasks').set('Authorization', `Bearer ${token}`).send({ ...validTask, name: '<script>x</script>' });
        await flush();

        expect(enqueue.firstCall.args[2]).to.not.contain('<script>');
        expect(enqueue.firstCall.args[2]).to.contain('&lt;script&gt;');
    });

    it('retorna 404 si el proyecto o el usuario asignado no existen', async () => {
        const token = stubAuth(['add_task']);
        useCaseWith([], [USER_ID]);
        const res = await request(app).post('/api/tasks').set('Authorization', `Bearer ${token}`).send(validTask);
        expect(res.status).to.equal(404);
    });

    it('PUT /:id/status rechaza un estado fuera del enum (400)', async () => {
        const token = stubAuth(['edit_task']);
        const res = await request(app).put(`/api/tasks/${TASK_ID}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'Hecho' });
        expect(res.status).to.equal(400);
    });

    it('PUT /:id/status actualiza el estado (200)', async () => {
        const token = stubAuth(['edit_task']);
        const update = sinon.stub(TaskService.prototype, 'updateTaskStatus').resolves({ task_id: TASK_ID, status: 'Completed' } as any);
        const res = await request(app).put(`/api/tasks/${TASK_ID}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'Completed' });
        expect(res.status).to.equal(200);
        expect(update.calledWith(TASK_ID, 'Completed')).to.be.true;
    });

    it('PUT /:id/status notifica a los miembros del proyecto el cambio de estado', async () => {
        const token = stubAuth(['edit_task']);
        sinon.stub(TaskService.prototype, 'updateTaskStatus').resolves({ task_id: TASK_ID, name: 'Implementar API', status: 'Completed', project_id: PROJECT_ID } as any);
        const members = sinon.stub(ProjectsUtil, 'getProjectMemberEmails').resolves(['dev1@pms.com']);
        const enqueue = sinon.stub(NotificationUtil, 'enqueueEmail').resolves();

        await request(app).put(`/api/tasks/${TASK_ID}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'Completed' });
        await flush();

        expect(members.calledWith(PROJECT_ID)).to.be.true;
        expect(enqueue.firstCall.args[1]).to.contain('Implementar API');
        expect(enqueue.firstCall.args[2]).to.contain('Completed');
    });

    it('PUT /:id/status retorna 404 si la tarea no existe', async () => {
        const token = stubAuth(['edit_task']);
        sinon.stub(TaskService.prototype, 'updateTaskStatus').resolves(null);
        const res = await request(app).put(`/api/tasks/${TASK_ID}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'In-Progress' });
        expect(res.status).to.equal(404);
    });

    it('PUT /:id rechaza nombre vacío, prioridad inválida y fechas invertidas (400)', async () => {
        const token = stubAuth(['edit_task']);
        const put = (body: object) => request(app).put(`/api/tasks/${TASK_ID}`).set('Authorization', `Bearer ${token}`).send(body);
        expect((await put({ name: '' })).status).to.equal(400);
        expect((await put({ priority: 'Urgente' })).status).to.equal(400);
        expect((await put({ estimated_start_time: '2026-12-01', estimated_end_time: '2026-11-01' })).status).to.equal(400);
    });

    describe('GET /api/tasks/:id/cost', () => {
        const getCost = (token: string, qs = '') => request(app).get(`/api/tasks/${TASK_ID}/cost${qs}`).set('Authorization', `Bearer ${token}`);
        const readerWith = (task: any) => sinon.stub(composition, 'buildTaskReader').returns({ findById: async () => task, findByProjectId: async () => [], save: async (t: any) => t } as any);

        it('calcula el costo estándar y el urgente según las horas estimadas', async () => {
            const { Task } = await import('../../src/domain/entities/task');
            readerWith(new Task({ name: 'Tarea', projectId: PROJECT_ID, estimatedStartTime: new Date('2026-11-01T08:00:00Z'), estimatedEndTime: new Date('2026-11-01T18:00:00Z') }));
            const token = stubAuth(['get_details_task']);
            expect((await getCost(token)).body.data).to.include({ type: 'standard', hours: 10, cost: 500 });
            expect((await getCost(token, '?type=urgent')).body.data).to.include({ type: 'urgent', cost: 750 });
        });

        it('responde 404 sin tarea, 400 sin fechas o con tarifa inválida, y 403 sin permiso', async () => {
            const { Task } = await import('../../src/domain/entities/task');
            const token = stubAuth(['get_details_task']);
            const reader = readerWith(null);
            expect((await getCost(token)).status).to.equal(404);
            reader.restore();
            readerWith(new Task({ name: 'Tarea', projectId: PROJECT_ID }));
            expect((await getCost(token)).status).to.equal(400);
            expect((await getCost(token, '?type=gratis')).status).to.equal(400);
        });

        it('exige el derecho get_details_task (403)', async () => {
            expect((await getCost(stubAuth(['get_all_tasks']))).status).to.equal(403);
        });
    });
});

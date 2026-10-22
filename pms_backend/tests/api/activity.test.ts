import sinon from 'sinon';
import request from 'supertest';
import { expect } from 'chai';
import { app } from '../../src/app';
import { ActivityClient, ActivityLog, ActivityUnavailableError } from '../../src/utils/activity_client';
import { TaskService } from '../../src/components/tasks/tasks_service';
import { TaskOrchestrator } from '../../src/components/tasks/task_orchestrator';
import { TaskTransactionService } from '../../src/components/tasks/task_transaction_service';
import { WorkflowError } from '../../src/domain/task_workflow';
import * as composition from '../../src/infrastructure/composition';
import { CreateTaskUseCase } from '../../src/use-cases/create_task_use_case';
import { InMemoryReferenceLookup, InMemoryTaskRepository } from '../../src/adapters/repositories/in_memory_task_repository';
import { HybridHistoryStore } from '../../src/commands/task_commands';
import { fakeUser, ok, stubAuth } from '../helpers/auth';

const TASK_ID = '44444444-4444-4444-8444-444444444444';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const event = (action: string) => ({ taskId: TASK_ID, userId: USER_ID, action, timestamp: '2026-10-22T08:00:00.000Z' });

describe('Pruebas de integración (API): actividad de tareas', () => {
    beforeEach(() => { sinon.stub(console, 'log'); });
    afterEach(() => sinon.restore());

    describe('lectura', () => {
        const get = (token: string, suffix = '') => request(app).get(`/api/tasks/${TASK_ID}/activity${suffix}`).set('Authorization', `Bearer ${token}`);

        it('exige autenticación (401) y el derecho get_details_task (403)', async () => {
            expect((await request(app).get(`/api/tasks/${TASK_ID}/activity`)).status).to.equal(401);
            expect((await get(stubAuth(['get_all_tasks']))).status).to.equal(403);
        });

        it('devuelve el historial con límite y orden', async () => {
            const history = sinon.stub(ActivityClient.prototype, 'history').resolves([event('task.created')] as any);
            const res = await get(stubAuth(['get_details_task']), '?limit=5&order=desc');
            expect(res.status).to.equal(200);
            expect(res.body.data[0].action).to.equal('task.created');
            expect(history.calledWith(TASK_ID, 5, 'desc')).to.be.true;
        });

        it('limita el tamaño de la consulta y usa orden ascendente por defecto', async () => {
            const history = sinon.stub(ActivityClient.prototype, 'history').resolves([]);
            await get(stubAuth(['get_details_task']), '?limit=999999');
            expect(history.firstCall.args.slice(1)).to.deep.equal([1000, 'asc']);
        });

        it('responde 503 si el servicio de actividad no está disponible', async () => {
            sinon.stub(ActivityClient.prototype, 'history').rejects(new ActivityUnavailableError());
            const res = await get(stubAuth(['get_details_task']));
            expect(res.status).to.equal(503);
            expect(res.body.message).to.contain('no está disponible');
        });

        it('última actividad: 200 con el evento y 404 si no hay', async () => {
            const last = sinon.stub(ActivityClient.prototype, 'last');
            last.onFirstCall().resolves(event('task.start') as any);
            last.onSecondCall().resolves(null);
            const token = stubAuth(['get_details_task']);
            const first = await get(token, '/last');
            expect(first.status).to.equal(200);
            expect(first.body.data.action).to.equal('task.start');
            expect((await get(token, '/last')).status).to.equal(404);
        });
    });

    describe('registro automático en cada operación', () => {
        let record: sinon.SinonStub;
        beforeEach(() => { record = sinon.stub(ActivityLog, 'record'); });
        const actions = () => record.args.map((a) => a[2]);

        it('crear una tarea registra task.created con quién la creó', async () => {
            sinon.stub(composition, 'buildCreateTaskUseCase').returns(new CreateTaskUseCase(new InMemoryTaskRepository(), new InMemoryReferenceLookup([PROJECT_ID], [USER_ID])));
            const token = stubAuth(['add_task']);
            await request(app).post('/api/tasks').set('Authorization', `Bearer ${token}`).send({ name: 'Registrada', project_id: PROJECT_ID, user_id: USER_ID });
            expect(actions()).to.deep.equal(['task.created']);
            expect(record.firstCall.args[1]).to.equal(fakeUser.user_id);
        });

        it('las acciones del flujo de trabajo registran task.<acción> con el estado resultante', async () => {
            sinon.stub(TaskService.prototype, 'performWorkflowAction').resolves({ task_id: TASK_ID, name: 'T', status: 'In-Progress', project_id: PROJECT_ID } as any);
            const token = stubAuth(['edit_task']);
            await request(app).post(`/api/tasks/${TASK_ID}/workflow/start`).set('Authorization', `Bearer ${token}`);
            expect(actions()).to.deep.equal(['task.start']);
            expect(record.firstCall.args[3]).to.deep.equal({ status: 'In-Progress' });
        });

        it('una transición ilegal no deja registro', async () => {
            sinon.stub(TaskService.prototype, 'performWorkflowAction').rejects(new WorkflowError('no'));
            const token = stubAuth(['edit_task']);
            await request(app).post(`/api/tasks/${TASK_ID}/workflow/approve`).set('Authorization', `Bearer ${token}`);
            expect(record.called).to.be.false;
        });

        it('PUT /status registra task.status_changed', async () => {
            sinon.stub(TaskService.prototype, 'updateTaskStatus').resolves({ task_id: TASK_ID, name: 'T', status: 'In-Review', project_id: PROJECT_ID } as any);
            const token = stubAuth(['edit_task']);
            await request(app).put(`/api/tasks/${TASK_ID}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'In-Review' });
            expect(actions()).to.deep.equal(['task.status_changed']);
        });

        it('reasignar y deshacer registran task.assigned y task.assignment_undone', async () => {
            const history: any[] = [];
            sinon.stub(HybridHistoryStore.prototype, 'push').callsFake(async (_k, e) => { history.push(e); });
            sinon.stub(HybridHistoryStore.prototype, 'pop').callsFake(async () => history.pop() ?? null);
            sinon.stub(TaskService.prototype, 'findOne').resolves(ok({ task_id: TASK_ID, user_id: 'anterior' }));
            sinon.stub(TaskService.prototype, 'update').resolves(ok({}));
            const token = stubAuth(['edit_task']);
            await request(app).put(`/api/tasks/${TASK_ID}/assign`).set('Authorization', `Bearer ${token}`).send({ user_id: USER_ID });
            await request(app).post(`/api/tasks/${TASK_ID}/assign/undo`).set('Authorization', `Bearer ${token}`);
            expect(actions()).to.deep.equal(['task.assigned', 'task.assignment_undone']);
        });

        it('subir y eliminar un adjunto registran task.attachment_added y task.attachment_removed', async () => {
            sinon.stub(TaskService.prototype, 'findOne').resolves(ok({ task_id: TASK_ID }));
            sinon.stub(TaskOrchestrator.prototype, 'processTaskAttachment').resolves('memory://x');
            sinon.stub(TaskOrchestrator.prototype, 'removeTaskAttachment').resolves();
            sinon.stub(TaskTransactionService.prototype, 'addAttachment').resolves('ok');
            sinon.stub(TaskTransactionService.prototype, 'removeAttachment').resolves('ok');
            const token = stubAuth(['edit_task']);
            await request(app).post(`/api/tasks/${TASK_ID}/attachments?filename=b.txt`).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send('contenido');
            await request(app).delete(`/api/tasks/${TASK_ID}/attachments/a.txt`).set('Authorization', `Bearer ${token}`);
            expect(actions()).to.deep.equal(['task.attachment_added', 'task.attachment_removed']);
        });
    });
});

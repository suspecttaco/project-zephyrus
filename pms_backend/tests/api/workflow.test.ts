import sinon from 'sinon';
import request from 'supertest';
import { expect } from 'chai';
import { app } from '../../src/app';
import { TaskService } from '../../src/components/tasks/tasks_service';
import { WorkflowError } from '../../src/domain/task_workflow';
import { HybridHistoryStore } from '../../src/commands/task_commands';
import { DbReportDataSource } from '../../src/reports/project_report_generators';
import { ok, stubAuth } from '../helpers/auth';

const TASK_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

describe('Pruebas de integración (API): flujo de trabajo, reasignación y reportes', () => {
    beforeEach(() => sinon.stub(console, 'log'));
    afterEach(() => sinon.restore());

    describe('POST /api/tasks/:id/workflow/:action (State + Pipeline)', () => {
        const act = (token: string, action: string) => request(app).post(`/api/tasks/${TASK_ID}/workflow/${action}`).set('Authorization', `Bearer ${token}`);

        it('exige autenticación (401), el derecho edit_task (403) y una acción válida (400)', async () => {
            expect((await request(app).post(`/api/tasks/${TASK_ID}/workflow/start`)).status).to.equal(401);
            const readOnly = stubAuth(['get_all_tasks']);
            const perform = sinon.stub(TaskService.prototype, 'performWorkflowAction');
            expect((await act(readOnly, 'start')).status).to.equal(403);
            expect(perform.called).to.be.false;
            expect((await act(readOnly, 'borrar')).status).to.equal(400);
        });

        it('aplica la transición y responde el nuevo estado', async () => {
            const token = stubAuth(['edit_task']);
            const perform = sinon.stub(TaskService.prototype, 'performWorkflowAction').resolves({ task_id: TASK_ID, name: 'T', status: 'In-Progress', project_id: PROJECT_ID, actual_start_time: new Date() } as any);
            const res = await act(token, 'start');
            expect(res.status).to.equal(200);
            expect(res.body.data).to.include({ task_id: TASK_ID, status: 'In-Progress' });
            expect(perform.calledWith(TASK_ID, 'start')).to.be.true;
        });

        it('responde 409 con el motivo cuando la transición no es legal', async () => {
            const token = stubAuth(['edit_task']);
            sinon.stub(TaskService.prototype, 'performWorkflowAction').rejects(new WorkflowError('Debe pasar por revisión antes de aprobar.'));
            const res = await act(token, 'approve');
            expect(res.status).to.equal(409);
            expect(res.body.message).to.equal('Debe pasar por revisión antes de aprobar.');
        });

        it('responde 404 si la tarea no existe y 500 ante errores inesperados', async () => {
            const token = stubAuth(['edit_task']);
            const perform = sinon.stub(TaskService.prototype, 'performWorkflowAction');
            perform.onFirstCall().resolves(null);
            perform.onSecondCall().rejects(new Error('base caída'));
            expect((await act(token, 'start')).status).to.equal(404);
            expect((await act(token, 'start')).status).to.equal(500);
        });

        it('el middleware de métricas registra la acción y el código de respuesta', async () => {
            const token = stubAuth(['edit_task']);
            sinon.stub(TaskService.prototype, 'performWorkflowAction').resolves({ task_id: TASK_ID, name: 'T', status: 'In-Review', project_id: PROJECT_ID } as any);
            await act(token, 'submit');
            const lines = (console.log as sinon.SinonStub).args.map((a) => String(a[0]));
            expect(lines.some((l) => /\[Workflow\] submit sobre tarea .* -> 200 en \d+ms/.test(l))).to.be.true;
        });

        it('PUT /:id/status también respeta la máquina de estados (409)', async () => {
            const token = stubAuth(['edit_task']);
            sinon.stub(TaskService.prototype, 'updateTaskStatus').rejects(new WorkflowError('Debe pasar por revisión antes de aprobar.'));
            const res = await request(app).put(`/api/tasks/${TASK_ID}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'Completed' });
            expect(res.status).to.equal(409);
        });

        it('el estado In-Review es válido en el cuerpo de PUT /status', async () => {
            const token = stubAuth(['edit_task']);
            sinon.stub(TaskService.prototype, 'updateTaskStatus').resolves({ task_id: TASK_ID, name: 'T', status: 'In-Review', project_id: PROJECT_ID } as any);
            const res = await request(app).put(`/api/tasks/${TASK_ID}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'In-Review' });
            expect(res.status).to.equal(200);
        });
    });

    describe('PUT /api/tasks/:id/assign y POST .../assign/undo (Command)', () => {
        const history: any[] = [];
        beforeEach(() => {
            history.length = 0;
            sinon.stub(HybridHistoryStore.prototype, 'push').callsFake(async (_k, e) => { history.push(e); });
            sinon.stub(HybridHistoryStore.prototype, 'pop').callsFake(async () => history.pop() ?? null);
        });

        it('valida el UUID, los permisos y la existencia de la tarea', async () => {
            const readOnly = stubAuth(['get_all_tasks']);
            const put = (t: string, body: object) => request(app).put(`/api/tasks/${TASK_ID}/assign`).set('Authorization', `Bearer ${t}`).send(body);
            expect((await put(readOnly, { user_id: 'x' })).status).to.equal(400);
            expect((await put(readOnly, { user_id: USER_ID })).status).to.equal(403);
        });

        it('reasigna recordando al usuario anterior y permite deshacer', async () => {
            const token = stubAuth(['edit_task']);
            sinon.stub(TaskService.prototype, 'findOne').resolves(ok({ task_id: TASK_ID, user_id: 'anterior-id' }));
            const update = sinon.stub(TaskService.prototype, 'update').resolves(ok({}));

            const res = await request(app).put(`/api/tasks/${TASK_ID}/assign`).set('Authorization', `Bearer ${token}`).send({ user_id: USER_ID });
            expect(res.status).to.equal(200);
            expect(res.body.data).to.include({ user_id: USER_ID, previous_user_id: 'anterior-id' });
            expect(update.calledWith(TASK_ID, { user_id: USER_ID })).to.be.true;

            const undo = await request(app).post(`/api/tasks/${TASK_ID}/assign/undo`).set('Authorization', `Bearer ${token}`);
            expect(undo.status).to.equal(200);
            expect(update.lastCall.args).to.deep.equal([TASK_ID, { user_id: 'anterior-id' }]);
        });

        it('deshacer sin historial responde 404', async () => {
            const token = stubAuth(['edit_task']);
            const res = await request(app).post(`/api/tasks/${TASK_ID}/assign/undo`).set('Authorization', `Bearer ${token}`);
            expect(res.status).to.equal(404);
        });

        it('si la asignación falla (usuario inexistente) no queda en el historial', async () => {
            const token = stubAuth(['edit_task']);
            sinon.stub(TaskService.prototype, 'findOne').resolves(ok({ task_id: TASK_ID, user_id: 'anterior-id' }));
            sinon.stub(TaskService.prototype, 'update').resolves({ statusCode: 404, status: 'error', message: 'El usuario asignado no existe' });
            const res = await request(app).put(`/api/tasks/${TASK_ID}/assign`).set('Authorization', `Bearer ${token}`).send({ user_id: USER_ID });
            expect(res.status).to.equal(404);
            expect(history).to.have.lengthOf(0);
        });
    });

    describe('GET /api/projects/:id/report (Template Method + Strategy)', () => {
        const get = (t: string, qs = '') => request(app).get(`/api/projects/${PROJECT_ID}/report${qs}`).set('Authorization', `Bearer ${t}`);
        beforeEach(() => {
            sinon.stub(DbReportDataSource.prototype, 'getProject').resolves({ project_id: PROJECT_ID, name: 'P', status: 'Planning' });
            sinon.stub(DbReportDataSource.prototype, 'taskBatches').callsFake(async function* () {
                yield [{ task_id: 'a', name: 'Uno', status: 'Completed', priority: 'High', user_id: 'u' }];
            });
        });

        it('devuelve CSV por defecto, como descarga', async () => {
            const res = await get(stubAuth(['get_details_project']));
            expect(res.status).to.equal(200);
            expect(res.headers['content-type']).to.contain('text/csv');
            expect(res.headers['content-disposition']).to.contain(`proyecto-${PROJECT_ID}.csv`);
            expect(res.text).to.contain('task_id,tarea,estado').and.contain('a,Uno,Completed');
        });

        it('devuelve JSON si se pide', async () => {
            const res = await get(stubAuth(['get_details_project']), '?format=json');
            expect(res.status).to.equal(200);
            expect(res.headers['content-type']).to.contain('application/json');
            expect(JSON.parse(res.text).total_tasks).to.equal(1);
        });

        it('valida el formato (400), la autenticación (401) y el UUID (400)', async () => {
            const token = stubAuth(['get_details_project']);
            expect((await get(token, '?format=pdf')).status).to.equal(400);
            expect((await request(app).get(`/api/projects/${PROJECT_ID}/report`)).status).to.equal(401);
            expect((await request(app).get('/api/projects/no-uuid/report').set('Authorization', `Bearer ${token}`)).status).to.equal(400);
        });

        it('exige el derecho get_details_project (403)', async () => {
            expect((await get(stubAuth(['get_all_tasks']))).status).to.equal(403);
        });
    });
});

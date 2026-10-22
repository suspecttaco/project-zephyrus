import { expect } from 'chai';
import { DatabaseUtil } from '../../src/utils/db';
import { CacheUtil } from '../../src/utils/cache_util';
import { api, auth, login, uniq, waitFor } from './helpers';

describe('Integración (real): flujo de trabajo (State + Pipeline), reasignación (Command) y reportes', () => {
    let admin: string;
    let adminId: string;
    let projectId: string;

    const newTask = async (extra: object = {}) =>
        (await api().post('/api/tasks').set(auth(admin)).send({ name: `T${uniq()}`, project_id: projectId, user_id: adminId, ...extra })).body.data;
    const workflow = (taskId: string, action: string, token = admin) => api().post(`/api/tasks/${taskId}/workflow/${action}`).set(auth(token));
    const statusOf = async (taskId: string) => (await api().get(`/api/tasks/${taskId}`).set(auth(admin))).body.data;

    before(async () => {
        admin = (await login()).access;
        adminId = (await api().get('/api/users?username=superadmin').set(auth(admin))).body.data[0].user_id;
        projectId = (await api().post('/api/projects').set(auth(admin)).send({ name: `Flujo${uniq()}` })).body.data.project_id;
    });

    describe('máquina de estados de la tarea', () => {
        it('recorre Not-Started -> In-Progress -> In-Review -> Completed y registra las horas reales', async () => {
            const task = await newTask();
            expect(task.status).to.equal('Not-Started');

            const started = await workflow(task.task_id, 'start');
            expect(started.status).to.equal(200);
            expect(started.body.data.status).to.equal('In-Progress');
            expect(started.body.data.actual_start_time).to.be.a('string');
            expect(started.body.data.actual_end_time).to.equal(null);

            expect((await workflow(task.task_id, 'submit')).body.data.status).to.equal('In-Review');
            const approved = await workflow(task.task_id, 'approve');
            expect(approved.body.data.status).to.equal('Completed');
            expect(approved.body.data.actual_end_time).to.be.a('string');
            expect((await statusOf(task.task_id)).status).to.equal('Completed');
        });

        it('rechaza las transiciones ilegales con 409 y no cambia el estado guardado', async () => {
            const task = await newTask();
            expect((await workflow(task.task_id, 'submit')).status).to.equal(409);
            expect((await workflow(task.task_id, 'approve')).status).to.equal(409);
            await workflow(task.task_id, 'start');
            const skip = await workflow(task.task_id, 'approve');
            expect(skip.status).to.equal(409);
            expect(skip.body.message).to.contain('revisión');
            expect((await statusOf(task.task_id)).status).to.equal('In-Progress');
        });

        it('una tarea completada no admite más cambios', async () => {
            const task = await newTask();
            for (const action of ['start', 'submit', 'approve']) await workflow(task.task_id, action);
            for (const action of ['start', 'submit', 'approve']) expect((await workflow(task.task_id, action)).status, action).to.equal(409);
            expect((await api().put(`/api/tasks/${task.task_id}/status`).set(auth(admin)).send({ status: 'In-Progress' })).status).to.equal(409);
        });

        it('PUT /status aplica las mismas reglas: no se puede saltar la revisión ni volver a Not-Started', async () => {
            const task = await newTask();
            const put = (status: string) => api().put(`/api/tasks/${task.task_id}/status`).set(auth(admin)).send({ status });
            expect((await put('Completed')).status).to.equal(409);
            expect((await put('In-Progress')).status).to.equal(200);
            expect((await put('Not-Started')).status).to.equal(409);
            expect((await put('In-Review')).status).to.equal(200);
            expect((await put('Completed')).status).to.equal(200);
        });

        it('valida la acción (400), la tarea (404) y los permisos (403)', async () => {
            const task = await newTask();
            expect((await workflow(task.task_id, 'destruir')).status).to.equal(400);
            expect((await workflow('00000000-0000-4000-8000-000000000000', 'start')).status).to.equal(404);

            const role = (await api().post('/api/roles').set(auth(admin)).send({ name: `Lector${uniq()}`, rights: 'get_all_tasks' })).body.data;
            const email = `l${uniq()}@pms.com`;
            await api().post('/api/users').set(auth(admin)).send({ fullname: 'Lector', username: `l${uniq()}`, email, password: 'Clave123!', role_ids: [role.role_id] });
            const reader = (await login(email, 'Clave123!')).access;
            const denied = await workflow(task.task_id, 'start', reader);
            expect(denied.status).to.equal(403);
            expect((await statusOf(task.task_id)).status).to.equal('Not-Started');
        });
    });

    describe('reasignación con deshacer (Command + historial en Redis)', () => {
        const createUser = async () => (await api().post('/api/users').set(auth(admin)).send({
            fullname: 'U', username: `u${uniq()}`, email: `u${uniq()}@pms.com`, password: 'Clave123!', role_ids: []
        })).body.data.user_id;
        const assignee = async (taskId: string) => (await statusOf(taskId)).user_id;

        before(async () => { await waitFor(async () => CacheUtil.isAvailable(), 10000); });

        it('reasigna dos veces y deshace en orden inverso hasta agotar el historial', async () => {
            const [u2, u3] = [await createUser(), await createUser()];
            const task = await newTask();
            const assign = (userId: string) => api().put(`/api/tasks/${task.task_id}/assign`).set(auth(admin)).send({ user_id: userId });
            const undo = () => api().post(`/api/tasks/${task.task_id}/assign/undo`).set(auth(admin));

            expect((await assign(u2)).body.data.previous_user_id).to.equal(adminId);
            expect((await assign(u3)).body.data.previous_user_id).to.equal(u2);
            expect(await assignee(task.task_id)).to.equal(u3);

            expect((await undo()).status).to.equal(200);
            expect(await assignee(task.task_id)).to.equal(u2);
            expect((await undo()).status).to.equal(200);
            expect(await assignee(task.task_id)).to.equal(adminId);
            expect((await undo()).status).to.equal(404);
        });

        it('asignar a un usuario inexistente da 404 y no deja nada que deshacer', async () => {
            const task = await newTask();
            const res = await api().put(`/api/tasks/${task.task_id}/assign`).set(auth(admin)).send({ user_id: '00000000-0000-4000-8000-000000000000' });
            expect(res.status).to.equal(404);
            expect((await api().post(`/api/tasks/${task.task_id}/assign/undo`).set(auth(admin))).status).to.equal(404);
            expect(await assignee(task.task_id)).to.equal(adminId);
        });

        it('el historial vive en Redis (compartido entre procesos), no solo en memoria', async function () {
            if (!CacheUtil.isAvailable()) return this.skip();
            const task = await newTask();
            await api().put(`/api/tasks/${task.task_id}/assign`).set(auth(admin)).send({ user_id: await createUser() });
            const stored = await CacheUtil.get('CommandHistory', task.task_id);
            expect(stored).to.have.lengthOf(1);
            expect(stored[0]).to.include({ type: 'assign_user', taskId: task.task_id, previousUserId: adminId });
        });
    });

    describe('reporte del proyecto', () => {
        let reportProject: string;
        before(async () => {
            reportProject = (await api().post('/api/projects').set(auth(admin)).send({ name: `Rep${uniq()}` })).body.data.project_id;
            const special = [`Tarea, con coma`, `=SUMA(1+1)`, `Dice "hola"`];
            for (const name of special) {
                await api().post('/api/tasks').set(auth(admin)).send({ name, project_id: reportProject, user_id: adminId });
            }
            await new DatabaseUtil().getDataSource().query(
                `insert into tasks (name, project_id, user_id) select 'Masiva ' || g, $1, $2 from generate_series(1, 105) g`, [reportProject, adminId]);
        });

        it('CSV: incluye las 108 tareas (varios lotes) y escapa lo peligroso', async () => {
            const res = await api().get(`/api/projects/${reportProject}/report?format=csv`).set(auth(admin)).buffer(true);
            expect(res.status).to.equal(200);
            expect(res.headers['content-type']).to.contain('text/csv');
            expect(res.headers['content-disposition']).to.contain(`proyecto-${reportProject}.csv`);
            const rows = res.text.trim().split('\n');
            expect(rows[0]).to.contain('task_id,tarea,estado');
            expect(rows.length - 1).to.equal(108);
            expect(res.text).to.contain('"Tarea, con coma"');
            expect(res.text).to.contain(",'=SUMA(1+1),");
            expect(res.text).to.not.contain(',=SUMA(1+1),');
            expect(res.text).to.contain('"Dice ""hola"""');
        });

        it('JSON: total, resumen por estado y tareas completas', async () => {
            const res = await api().get(`/api/projects/${reportProject}/report?format=json`).set(auth(admin));
            expect(res.status).to.equal(200);
            expect(res.body.total_tasks).to.equal(108);
            expect(res.body.summary).to.deep.equal({ 'Not-Started': 108 });
            expect(res.body.tasks).to.have.lengthOf(108);
        });

        it('proyecto inexistente (404), formato inválido (400)', async () => {
            expect((await api().get('/api/projects/00000000-0000-4000-8000-000000000000/report').set(auth(admin))).status).to.equal(404);
            expect((await api().get(`/api/projects/${reportProject}/report?format=pdf`).set(auth(admin))).status).to.equal(400);
        });
    });
});

import { expect } from 'chai';
import { DatabaseUtil } from '../../src/utils/db';
import { TaskTransactionService } from '../../src/components/tasks/task_transaction_service';
import { TaskLimitError } from '../../src/domain/task_workflow';
import { Status } from '../../src/domain/task_status';
import { api, auth, login, uniq } from './helpers';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const LIMIT = 5;

describe('Integración (PostgreSQL real): concurrencia, aislamiento y bloqueos', () => {
    let admin: string;
    let adminId: string;

    before(async () => {
        admin = (await login()).access;
        adminId = (await api().get('/api/users?username=superadmin').set(auth(admin))).body.data[0].user_id;
    });

    const newProject = async () => (await api().post('/api/projects').set(auth(admin)).send({ name: `Conc${uniq()}` })).body.data.project_id;
    const newTasks = async (projectId: string, count: number): Promise<string[]> => {
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
            ids.push((await api().post('/api/tasks').set(auth(admin)).send({ name: `T${uniq()}`, project_id: projectId, user_id: adminId })).body.data.task_id);
        }
        return ids;
    };
    const inProgress = async (projectId: string): Promise<number> =>
        Number((await new DatabaseUtil().getDataSource().query(`select count(*) from tasks where project_id = $1 and status = 'In-Progress'`, [projectId]))[0].count);

    describe('write skew: máximo de tareas en progreso por proyecto', () => {
        it('CONTROL: en READ COMMITTED las transacciones simultáneas SUPERAN el límite', async () => {
            const projectId = await newProject();
            const tasks = await newTasks(projectId, 8);
            const results = await Promise.allSettled(tasks.map((id) =>
                new TaskTransactionService({ isolation: 'READ COMMITTED', limit: LIMIT, afterRead: () => sleep(200) }).startTaskWithLimit(id)));

            expect(results.every((r) => r.status === 'fulfilled')).to.be.true;
            expect(await inProgress(projectId), 'sin aislamiento serializable se rompe la invariante').to.equal(8);
        });

        it('SERIALIZABLE + reintentos: exactamente el límite entra y el resto recibe TaskLimitError', async () => {
            const projectId = await newProject();
            const tasks = await newTasks(projectId, 8);
            const retries: number[] = [];
            const results = await Promise.allSettled(tasks.map((id) =>
                new TaskTransactionService({ limit: LIMIT, maxRetries: 12, afterRead: () => sleep(100), onRetry: (a: number) => retries.push(a) }).startTaskWithLimit(id)));

            const ok = results.filter((r) => r.status === 'fulfilled');
            const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
            expect(ok).to.have.lengthOf(LIMIT);
            expect(rejected).to.have.lengthOf(3);
            rejected.forEach((r) => expect(r.reason).to.be.instanceOf(TaskLimitError));
            expect(await inProgress(projectId)).to.equal(LIMIT);
            expect(retries.length, 'PostgreSQL abortó transacciones conflictivas y se reintentaron').to.be.greaterThan(0);
        });

        it('API: 8 inicios simultáneos dan exactamente 5 respuestas 200 y 3 respuestas 409', async () => {
            const projectId = await newProject();
            const tasks = await newTasks(projectId, 8);
            const responses = await Promise.all(tasks.map((id) => api().post(`/api/tasks/${id}/workflow/start`).set(auth(admin))));

            const statuses = responses.map((r) => r.status).sort();
            expect(statuses.filter((s) => s === 200)).to.have.lengthOf(LIMIT);
            expect(statuses.filter((s) => s === 409)).to.have.lengthOf(3);
            responses.filter((r) => r.status === 409).forEach((r) => expect(r.body.message).to.contain('Límite alcanzado'));
            expect(await inProgress(projectId)).to.equal(LIMIT);
        });

        it('al completar una tarea se libera un cupo, y el límite es por proyecto', async () => {
            const [projectA, projectB] = [await newProject(), await newProject()];
            const tasksA = await newTasks(projectA, 6);
            for (const id of tasksA.slice(0, LIMIT)) expect((await api().post(`/api/tasks/${id}/workflow/start`).set(auth(admin))).status).to.equal(200);

            expect((await api().post(`/api/tasks/${tasksA[5]}/workflow/start`).set(auth(admin))).status).to.equal(409);
            const [taskB] = await newTasks(projectB, 1);
            expect((await api().post(`/api/tasks/${taskB}/workflow/start`).set(auth(admin))).status, 'otro proyecto no se ve afectado').to.equal(200);

            for (const action of ['submit', 'approve']) await api().post(`/api/tasks/${tasksA[0]}/workflow/${action}`).set(auth(admin));
            expect((await api().post(`/api/tasks/${tasksA[5]}/workflow/start`).set(auth(admin))).status).to.equal(200);
        });

        it('PUT /status respeta el mismo límite e iniciar una tarea ya iniciada no consume cupo', async () => {
            const projectId = await newProject();
            const tasks = await newTasks(projectId, 6);
            for (const id of tasks.slice(0, LIMIT)) await api().put(`/api/tasks/${id}/status`).set(auth(admin)).send({ status: 'In-Progress' });
            expect((await api().put(`/api/tasks/${tasks[5]}/status`).set(auth(admin)).send({ status: 'In-Progress' })).status).to.equal(409);
            expect((await api().put(`/api/tasks/${tasks[0]}/status`).set(auth(admin)).send({ status: 'In-Progress' })).status).to.equal(200);
            expect(await inProgress(projectId)).to.equal(LIMIT);
        });
    });

    describe('lost update: lista de adjuntos modificada por varias peticiones a la vez', () => {
        const attachments = async (taskId: string) => (await api().get(`/api/tasks/${taskId}/attachments`).set(auth(admin))).body.data.map((a: any) => a.name);

        it('CONTROL: sin bloqueo de fila, las modificaciones simultáneas se pisan', async () => {
            const [taskId] = await newTasks(await newProject(), 1);
            await Promise.all(Array.from({ length: 12 }, (_, i) =>
                new TaskTransactionService({ lock: false, isolation: 'READ COMMITTED' as any, afterRead: () => sleep(150) }).addAttachment(taskId, { name: `f${i}.txt` })));
            expect((await attachments(taskId)).length, 'se perdieron actualizaciones').to.be.lessThan(12);
        });

        it('con SELECT ... FOR UPDATE las 12 modificaciones simultáneas se conservan todas', async () => {
            const [taskId] = await newTasks(await newProject(), 1);
            await Promise.all(Array.from({ length: 12 }, (_, i) =>
                new TaskTransactionService({ afterRead: () => sleep(30) }).addAttachment(taskId, { name: `f${i}.txt` })));
            expect(await attachments(taskId)).to.have.members(Array.from({ length: 12 }, (_, i) => `f${i}.txt`));
        });

        it('API: 12 subidas simultáneas de archivos distintos quedan todas registradas', async () => {
            process.env.STORAGE_PROVIDER = 'memory';
            const [taskId] = await newTasks(await newProject(), 1);
            const responses = await Promise.all(Array.from({ length: 12 }, (_, i) =>
                api().post(`/api/tasks/${taskId}/attachments?filename=archivo${i}.txt`).set(auth(admin)).set('Content-Type', 'application/octet-stream').send(`contenido ${i}`)));
            expect(responses.every((r) => r.status === 201)).to.be.true;
            expect(await attachments(taskId)).to.have.lengthOf(12);
            delete process.env.STORAGE_PROVIDER;
        });

        it('API: subir y borrar a la vez no corrompe la lista', async () => {
            process.env.STORAGE_PROVIDER = 'memory';
            const [taskId] = await newTasks(await newProject(), 1);
            for (let i = 0; i < 4; i++) {
                await api().post(`/api/tasks/${taskId}/attachments?filename=base${i}.txt`).set(auth(admin)).set('Content-Type', 'application/octet-stream').send('x');
            }
            await Promise.all([
                ...[0, 1].map((i) => api().delete(`/api/tasks/${taskId}/attachments/base${i}.txt`).set(auth(admin))),
                ...[0, 1, 2].map((i) => api().post(`/api/tasks/${taskId}/attachments?filename=nuevo${i}.txt`).set(auth(admin)).set('Content-Type', 'application/octet-stream').send('y'))
            ]);
            expect(await attachments(taskId)).to.have.members(['base2.txt', 'base3.txt', 'nuevo0.txt', 'nuevo1.txt', 'nuevo2.txt']);
            delete process.env.STORAGE_PROVIDER;
        });
    });

    it('el estado final es consistente: ninguna tarea quedó en un estado inválido', async () => {
        const rows = await new DatabaseUtil().getDataSource().query(`select distinct status from tasks`);
        const allowed = Object.values(Status) as string[];
        rows.forEach((r: any) => expect(allowed).to.include(r.status));
    });
});

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import { expect } from 'chai';
import { ActivityStore } from '../../src/engines/activity_store';
import { createActivityApp } from '../../src/workers/activity_server';
import { DatabaseUtil } from '../../src/utils/db';
import { api, auth, login, uniq } from './helpers';

describe('Integración (real): actividad en LevelDB + motor de registro e índices B-Tree', () => {
    let admin: string;
    let adminId: string;
    let dir: string;
    let store: ActivityStore;
    let server: http.Server;
    let projectId: string;
    const saved = { ...process.env };

    const startService = (): Promise<void> => new Promise((resolve) => {
        server = http.createServer(createActivityApp(store, 'token-de-prueba')).listen(0, '127.0.0.1', () => {
            process.env.ACTIVITY_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
            resolve();
        });
    });
    const stopService = async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); };
    const newTask = async () => (await api().post('/api/tasks').set(auth(admin)).send({ name: `T${uniq()}`, project_id: projectId, user_id: adminId })).body.data;
    const waitForEvents = async (taskId: string, count: number) => {
        for (let i = 0; i < 40; i++) {
            const res = await api().get(`/api/tasks/${taskId}/activity`).set(auth(admin));
            if (res.body.data?.length >= count) return res.body.data;
            await new Promise((r) => setTimeout(r, 100));
        }
        return (await api().get(`/api/tasks/${taskId}/activity`).set(auth(admin))).body.data;
    };

    before(async () => {
        process.env.ACTIVITY_TOKEN = 'token-de-prueba';
        process.env.ACTIVITY_DISABLED = 'false';
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-act-int-'));
        store = new ActivityStore(dir);
        await store.open();
        await startService();
        admin = (await login()).access;
        adminId = (await api().get('/api/users?username=superadmin').set(auth(admin))).body.data[0].user_id;
        projectId = (await api().post('/api/projects').set(auth(admin)).send({ name: `Act${uniq()}` })).body.data.project_id;
    });
    after(async () => {
        process.env = { ...saved };
        await stopService().catch(() => undefined);
        await store.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('registra el ciclo de vida completo de una tarea en orden cronológico', async () => {
        const task = await newTask();
        for (const action of ['start', 'submit', 'approve']) await api().post(`/api/tasks/${task.task_id}/workflow/${action}`).set(auth(admin));

        const history = await waitForEvents(task.task_id, 4);
        expect(history.map((e: any) => e.action)).to.deep.equal(['task.created', 'task.start', 'task.submit', 'task.approve']);
        expect(history.every((e: any) => e.userId === adminId)).to.be.true;
        expect(history[3].details).to.deep.equal({ status: 'Completed' });
        expect(history.map((e: any) => e.timestamp)).to.deep.equal([...history.map((e: any) => e.timestamp)].sort());
    });

    it('la última actividad sale del índice hash y coincide con el último evento del historial', async () => {
        const task = await newTask();
        await api().post(`/api/tasks/${task.task_id}/workflow/start`).set(auth(admin));
        const history = await waitForEvents(task.task_id, 2);
        const last = await api().get(`/api/tasks/${task.task_id}/activity/last`).set(auth(admin));
        expect(last.status).to.equal(200);
        expect(last.body.data).to.deep.equal(history[history.length - 1]);
    });

    it('admite orden descendente y límite', async () => {
        const task = await newTask();
        for (const action of ['start', 'submit']) await api().post(`/api/tasks/${task.task_id}/workflow/${action}`).set(auth(admin));
        await waitForEvents(task.task_id, 3);
        const res = await api().get(`/api/tasks/${task.task_id}/activity?order=desc&limit=2`).set(auth(admin));
        expect(res.body.data.map((e: any) => e.action)).to.deep.equal(['task.submit', 'task.start']);
    });

    it('cada tarea tiene su propio historial', async () => {
        const [a, b] = [await newTask(), await newTask()];
        await api().post(`/api/tasks/${a.task_id}/workflow/start`).set(auth(admin));
        await waitForEvents(a.task_id, 2);
        expect((await waitForEvents(b.task_id, 1)).map((e: any) => e.action)).to.deep.equal(['task.created']);
    });

    it('una tarea sin actividad responde 404 en "última" y lista vacía en el historial', async () => {
        const ghost = '00000000-0000-4000-8000-000000000000';
        expect((await api().get(`/api/tasks/${ghost}/activity/last`).set(auth(admin))).status).to.equal(404);
        expect((await api().get(`/api/tasks/${ghost}/activity`).set(auth(admin))).body.data).to.deep.equal([]);
    });

    it('con el servicio de actividad caído la API sigue funcionando y la consulta responde 503', async () => {
        await stopService();
        const created = await api().post('/api/tasks').set(auth(admin)).send({ name: `Sin${uniq()}`, project_id: projectId, user_id: adminId });
        expect(created.status).to.equal(201);
        const started = await api().post(`/api/tasks/${created.body.data.task_id}/workflow/start`).set(auth(admin));
        expect(started.status).to.equal(200);
        expect((await api().get(`/api/tasks/${created.body.data.task_id}/activity`).set(auth(admin))).status).to.equal(503);
        await startService();
        expect((await api().get(`/api/tasks/${created.body.data.task_id}/activity`).set(auth(admin))).status).to.equal(200);
    });

    it('los eventos y la última actividad sobreviven al reinicio del servicio', async () => {
        const task = await newTask();
        await waitForEvents(task.task_id, 1);
        await stopService();
        await store.close();
        store = new ActivityStore(dir);
        await store.open();
        await startService();
        expect((await api().get(`/api/tasks/${task.task_id}/activity`).set(auth(admin))).body.data).to.have.lengthOf(1);
        expect((await api().get(`/api/tasks/${task.task_id}/activity/last`).set(auth(admin))).body.data.action).to.equal('task.created');
    });

    it('PostgreSQL tiene los índices B-Tree de las consultas frecuentes', async () => {
        const rows = await new DatabaseUtil().getDataSource().query(
            `select indexname, indexdef from pg_indexes where tablename in ('tasks','comments') and schemaname = 'public'`);
        const names = rows.map((r: any) => r.indexname);
        expect(names).to.include.members(['idx_tasks_user_id', 'idx_tasks_status', 'idx_comments_task_id']);
        expect(rows.find((r: any) => r.indexname === 'idx_tasks_status').indexdef).to.contain('USING btree');
    });
});

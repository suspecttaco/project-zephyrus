import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import request from 'supertest';
import sinon from 'sinon';
import { expect } from 'chai';
import { ActivityStore } from '../../src/engines/activity_store';
import { createActivityApp } from '../../src/workers/activity_server';
import { ActivityClient, ActivityLog, ActivityUnavailableError } from '../../src/utils/activity_client';

describe('Servicio de actividad (único dueño de los motores)', () => {
    let dir: string;
    let store: ActivityStore;
    beforeEach(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-svc-')); store = new ActivityStore(dir); await store.open(); });
    afterEach(async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('POST /events guarda y GET devuelve historial, última actividad y estadísticas', async () => {
        const app = createActivityApp(store, undefined);
        expect((await request(app).post('/events').send({ taskId: 't', userId: 'u', action: 'task.created' })).status).to.equal(201);
        await request(app).post('/events').send({ taskId: 't', action: 'task.start' });

        const history = await request(app).get('/tasks/t/events');
        expect(history.body.data.map((e: any) => e.action)).to.deep.equal(['task.created', 'task.start']);
        expect(history.body.data[1].userId).to.equal(null);
        expect((await request(app).get('/tasks/t/events?order=desc&limit=1')).body.data[0].action).to.equal('task.start');
        expect((await request(app).get('/tasks/t/last')).body.data.action).to.equal('task.start');
        expect((await request(app).get('/tasks/nada/last')).status).to.equal(404);
        expect((await request(app).get('/stats')).body.data.latestIndex.keys).to.equal(1);
    });

    it('valida el cuerpo (400) y exige el token interno cuando está configurado (401)', async () => {
        const app = createActivityApp(store, 'secreto');
        expect((await request(app).post('/events').send({ taskId: 't', action: 'a' })).status).to.equal(401);
        expect((await request(app).post('/events').set('X-Internal-Token', 'otro').send({})).status).to.equal(401);
        expect((await request(app).post('/events').set('X-Internal-Token', 'secreto').send({ taskId: 't' })).status).to.equal(400);
        expect((await request(app).post('/events').set('X-Internal-Token', 'secreto').send({ taskId: 't', action: 'a' })).status).to.equal(201);
    });

    describe('ActivityClient (HTTP con el Builder del capítulo 11)', () => {
        let server: http.Server;
        let url: string;
        beforeEach((done) => {
            server = http.createServer(createActivityApp(store, 'tok')).listen(0, '127.0.0.1', () => {
                url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
                done();
            });
        });
        afterEach(() => { server.closeAllConnections(); server.close(); });

        it('registra y consulta a través del servicio', async () => {
            const client = new ActivityClient(url, 'tok');
            await client.record('t', 'u', 'task.created', { name: 'X' });
            await client.record('t', 'u', 'task.start');
            expect((await client.history('t')).map((e) => e.action)).to.deep.equal(['task.created', 'task.start']);
            expect((await client.history('t', 1, 'desc'))[0].action).to.equal('task.start');
            expect((await client.last('t'))!.action).to.equal('task.start');
            expect(await client.last('nada')).to.equal(null);
        });

        it('con un token incorrecto el servicio rechaza (error HTTP, no "no disponible")', async () => {
            let error: any;
            try { await new ActivityClient(url, 'malo').history('t'); } catch (e) { error = e; }
            expect(error.response.status).to.equal(401);
        });
    });

    it('si el servicio está caído, el cliente lanza ActivityUnavailableError', async () => {
        let error: any;
        try { await new ActivityClient('http://127.0.0.1:1', undefined).history('t'); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(ActivityUnavailableError);
    });

    describe('ActivityLog.record (dispara y olvida)', () => {
        const saved = { ...process.env };
        afterEach(() => { process.env = { ...saved }; sinon.restore(); });

        it('no hace nada si está deshabilitado', () => {
            process.env.ACTIVITY_DISABLED = 'true';
            const record = sinon.stub(ActivityClient.prototype, 'record').resolves();
            ActivityLog.record('t', 'u', 'a');
            expect(record.called).to.be.false;
        });

        it('envía el evento sin esperar y nunca lanza aunque el servicio falle', async () => {
            process.env.ACTIVITY_DISABLED = 'false';
            sinon.stub(console, 'error');
            const record = sinon.stub(ActivityClient.prototype, 'record').rejects(new ActivityUnavailableError());
            expect(() => ActivityLog.record('t', undefined, 'task.created', { a: 1 })).to.not.throw();
            await new Promise((r) => setImmediate(r));
            expect(record.calledOnceWith('t', null, 'task.created', { a: 1 })).to.be.true;
        });
    });
});

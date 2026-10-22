import { expect } from 'chai';
import { ConfirmChannel } from 'amqplib';
import { DatabaseUtil } from '../../src/utils/db';
import { RabbitMQConnection } from '../../src/messaging/rabbitmq_connection';
import { EventPublisher } from '../../src/messaging/event_publisher';
import { consumeWithRetry, setupQueue } from '../../src/messaging/consumer_support';
import { AUDIT_QUEUE, startAuditConsumer } from '../../src/messaging/audit_consumer';
import { NOTIFICATION_QUEUE, startNotificationConsumer } from '../../src/messaging/notification_consumer';
import { api, auth, login, uniq, waitFor, mailpitAvailable, mailsWithSubject, MAIL_API } from './helpers';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Integración (RabbitMQ real): eventos de dominio, consumidores, reintentos y mensajes muertos', () => {
    let admin: string;
    let adminId: string;
    let projectId: string;
    let channel: ConfirmChannel;
    const rabbit = RabbitMQConnection.getInstance();
    const tags: string[] = [];
    const db = () => new DatabaseUtil().getDataSource();

    const auditRows = async (taskId: string) =>
        db().query(`select routing_key, user_id, payload from audit_events where task_id = $1 order by occurred_at, received_at`, [taskId]);
    const newTask = async (extra: object = {}) =>
        (await api().post('/api/tasks').set(auth(admin)).send({ name: `T${uniq()}`, project_id: projectId, user_id: adminId, ...extra })).body.data;
    const startAudit = async () => { tags.push(await startAuditConsumer()); };

    before(async function () {
        if (!RabbitMQConnection.isEnabled()) return this.skip();
        admin = (await login()).access;
        adminId = (await api().get('/api/users?username=superadmin').set(auth(admin))).body.data[0].user_id;
        projectId = (await api().post('/api/projects').set(auth(admin)).send({ name: `Msg${uniq()}` })).body.data.project_id;
        channel = await rabbit.connect();
    });
    beforeEach(async () => {
        for (const [queue, key] of [[AUDIT_QUEUE, '#'], [NOTIFICATION_QUEUE, 'task.event.*']] as const) {
            await setupQueue(channel, queue, key);
            await channel.purgeQueue(queue);
        }
        await channel.purgeQueue(rabbit.DEAD_QUEUE);
    });
    afterEach(async () => {
        for (const tag of tags.splice(0)) await channel.cancel(tag).catch(() => undefined);
        process.env.RABBITMQ_URL = process.env.TEST_RABBITMQ_URL || 'amqp://guest:guest@127.0.0.1:5672/pms_test';
    });

    it('cada operación de la API publica un evento y el microservicio de auditoría lo registra en PostgreSQL', async () => {
        await startAudit();
        const task = await newTask();
        for (const action of ['start', 'submit', 'approve']) await api().post(`/api/tasks/${task.task_id}/workflow/${action}`).set(auth(admin));

        expect(await waitFor(async () => (await auditRows(task.task_id)).length >= 4)).to.be.true;
        const rows = await auditRows(task.task_id);
        expect(rows.map((r: any) => r.routing_key)).to.deep.equal(['task.event.created', 'task.event.status_changed', 'task.event.status_changed', 'task.event.status_changed']);
        expect(rows.every((r: any) => r.user_id === adminId)).to.be.true;
        expect(rows[3].payload.data).to.deep.equal({ status: 'Completed' });
    });

    it('GET /api/audit/events devuelve la auditoría con filtros y exige el derecho', async () => {
        await startAudit();
        const task = await newTask();
        await api().post(`/api/tasks/${task.task_id}/workflow/start`).set(auth(admin));
        await waitFor(async () => (await auditRows(task.task_id)).length >= 2);

        const all = await api().get(`/api/audit/events?task_id=${task.task_id}`).set(auth(admin));
        expect(all.status).to.equal(200);
        expect(all.body.data).to.have.lengthOf(2);
        const only = await api().get(`/api/audit/events?task_id=${task.task_id}&type=task.event.status_changed`).set(auth(admin));
        expect(only.body.data.map((e: any) => e.routing_key)).to.deep.equal(['task.event.status_changed']);
        expect((await api().get('/api/audit/events?type=NO%20VALIDO').set(auth(admin))).status).to.equal(400);

        const role = (await api().post('/api/roles').set(auth(admin)).send({ name: `SinAud${uniq()}`, rights: 'get_all_tasks' })).body.data;
        const email = `a${uniq()}@pms.com`;
        await api().post('/api/users').set(auth(admin)).send({ fullname: 'A', username: `a${uniq()}`, email, password: 'Clave123!', role_ids: [role.role_id] });
        expect((await api().get('/api/audit/events').set(auth((await login(email, 'Clave123!')).access))).status).to.equal(403);
    });

    it('la cola duradera conserva los mensajes mientras no hay consumidor y los entrega al arrancar', async () => {
        const tasks = [await newTask(), await newTask(), await newTask()];
        expect(await waitFor(async () => (await channel.checkQueue(AUDIT_QUEUE)).messageCount >= 3)).to.be.true;
        expect((await auditRows(tasks[0].task_id)).length, 'aún nadie los consumió').to.equal(0);

        await startAudit();
        for (const t of tasks) expect(await waitFor(async () => (await auditRows(t.task_id)).length === 1)).to.be.true;
        expect(await waitFor(async () => (await channel.checkQueue(AUDIT_QUEUE)).messageCount === 0)).to.be.true;
    });

    it('el consumidor de auditoría es idempotente: el mismo evento entregado dos veces se registra una vez', async () => {
        await startAudit();
        const task = await newTask();
        await waitFor(async () => (await auditRows(task.task_id)).length === 1);
        const event = EventPublisher.buildEvent('task.event.status_changed', task.task_id, adminId, { status: 'X' });
        await EventPublisher.publish(event);
        await EventPublisher.publish(event);
        await sleep(800);
        const rows = await db().query(`select count(*)::int as n from audit_events where event_id = $1`, [event.eventId]);
        expect(rows[0].n).to.equal(1);
    });

    describe('microservicio de notificaciones (colas independientes sobre el mismo intercambiador)', () => {
        let mail = false;
        before(async function () { mail = await mailpitAvailable(); if (!mail) this.skip(); });

        it('avisa por correo a quien recibe una tarea, pero no si se la asigna a sí mismo', async () => {
            tags.push(await startNotificationConsumer());
            const beto = (await api().post('/api/users').set(auth(admin)).send({
                fullname: 'Beto', username: `b${uniq()}`, email: `beto${uniq()}@pms.com`, password: 'Clave123!', role_ids: []
            })).body.data;
            await fetch(`${MAIL_API}/api/v1/messages`, { method: 'DELETE' });

            const name = `Asignada${uniq()}`;
            await newTask({ name, user_id: beto.user_id });
            const own = `Propia${uniq()}`;
            await newTask({ name: own, user_id: adminId });

            expect(await waitFor(async () => (await mailsWithSubject(`Se te asignó la tarea: ${name}`)).length === 1)).to.be.true;
            expect((await mailsWithSubject(`Se te asignó la tarea: ${name}`))[0].To[0].Address).to.equal(beto.email);
            await sleep(1000);
            expect(await mailsWithSubject(`Se te asignó la tarea: ${own}`)).to.have.lengthOf(0);
        });

        it('una reasignación también avisa a la persona nueva', async () => {
            tags.push(await startNotificationConsumer());
            const carla = (await api().post('/api/users').set(auth(admin)).send({
                fullname: 'Carla', username: `c${uniq()}`, email: `carla${uniq()}@pms.com`, password: 'Clave123!', role_ids: []
            })).body.data;
            const name = `Reasignada${uniq()}`;
            const task = await newTask({ name });
            await api().put(`/api/tasks/${task.task_id}/assign`).set(auth(admin)).send({ user_id: carla.user_id });
            expect(await waitFor(async () => (await mailsWithSubject(`Se te asignó la tarea: ${name}`)).some((m) => m.To[0].Address === carla.email))).to.be.true;
        });
    });

    it('consumidores competidores: dos instancias sobre la misma cola se reparten el trabajo y cada mensaje se procesa una vez', async () => {
        const queue = `test_competing_${uniq()}`;
        await channel.assertQueue(queue, { durable: false, autoDelete: true });
        await channel.bindQueue(queue, rabbit.EXCHANGE_NAME, 'test.competing.*');
        const seen: Record<string, string[]> = { a: [], b: [] };
        for (const who of ['a', 'b']) {
            const worker = await rabbit.connect();
            tags.push(await consumeWithRetry(worker, queue, async (msg) => { seen[who].push(msg.properties.messageId); await sleep(40); }, { name: who }));
        }
        for (let i = 0; i < 20; i++) await EventPublisher.publish({ eventId: `ev-${i}`, type: 'test.competing.msg', taskId: 't', userId: null, occurredAt: new Date().toISOString(), data: {} });

        expect(await waitFor(async () => seen.a.length + seen.b.length >= 20)).to.be.true;
        const all = [...seen.a, ...seen.b];
        expect(all).to.have.lengthOf(20);
        expect(new Set(all).size, 'ningún mensaje se procesó dos veces').to.equal(20);
        expect(seen.a.length).to.be.greaterThan(0);
        expect(seen.b.length).to.be.greaterThan(0);
    });

    it('un mensaje venenoso se reintenta 3 veces y termina en la cola de mensajes muertos, sin bloquear al resto', async () => {
        const queue = `test_poison_${uniq()}`;
        await setupQueue(channel, queue, 'test.poison.*');
        let attempts = 0;
        const processed: string[] = [];
        tags.push(await consumeWithRetry(channel, queue, async (msg) => {
            const event = JSON.parse(msg.content.toString());
            if (event.data.poison) { attempts++; throw new Error('mensaje venenoso'); }
            processed.push(event.eventId);
        }, { name: 'veneno' }));

        const base = { type: 'test.poison.msg', taskId: 't', userId: null, occurredAt: new Date().toISOString() };
        await EventPublisher.publish({ ...base, eventId: 'malo', data: { poison: true } });
        await EventPublisher.publish({ ...base, eventId: 'bueno', data: {} });

        expect(await waitFor(async () => (await channel.checkQueue(rabbit.DEAD_QUEUE)).messageCount === 1)).to.be.true;
        expect(attempts).to.equal(3);
        expect(processed).to.deep.equal(['bueno']);
        const dead = await channel.get(rabbit.DEAD_QUEUE, { noAck: true });
        expect(dead).to.not.equal(false);
        expect(JSON.parse((dead as any).content.toString()).eventId).to.equal('malo');
        expect((dead as any).properties.headers['x-death'][0]).to.deep.include({ queue, reason: 'rejected' });
        expect((await channel.checkQueue(queue)).messageCount, 'la cola principal quedó limpia').to.equal(0);
        await channel.deleteQueue(queue);
    });

    it('si RabbitMQ no está disponible la API sigue respondiendo y se recupera sola al volver', async () => {
        await rabbit.close();
        process.env.RABBITMQ_URL = 'amqp://guest:guest@127.0.0.1:5999/pms_test';
        const started = Date.now();
        const during = await newTask();
        expect(during.task_id).to.be.a('string');
        expect(Date.now() - started, 'la petición no espera al broker').to.be.lessThan(2000);
        expect((await api().get('/api/health')).body.rabbitmq).to.equal(false);

        process.env.RABBITMQ_URL = process.env.TEST_RABBITMQ_URL || 'amqp://guest:guest@127.0.0.1:5672/pms_test';
        channel = await rabbit.connect();
        await setupQueue(channel, AUDIT_QUEUE, '#');
        await startAudit();
        const after = await newTask();
        expect(await waitFor(async () => (await auditRows(after.task_id)).length === 1)).to.be.true;
        expect((await auditRows(during.task_id)).length, 'los eventos emitidos con el broker caído no se reponen').to.equal(0);
        expect((await api().get('/api/health')).body.rabbitmq).to.equal(true);
    });
});

import sinon from 'sinon';
import { expect } from 'chai';
import { DomainEvents, routingKeyFor } from '../../src/messaging/domain_events';
import { EventPublisher } from '../../src/messaging/event_publisher';
import { RabbitMQConnection } from '../../src/messaging/rabbitmq_connection';
import { ActivityLog } from '../../src/utils/activity_client';
import { consumeWithRetry, MAX_ATTEMPTS } from '../../src/messaging/consumer_support';
import { buildNotificationHandler } from '../../src/messaging/notification_consumer';
import { buildAuditHandler } from '../../src/messaging/audit_consumer';

const message = (event: object, extra: any = {}): any => ({
    content: Buffer.from(JSON.stringify(event)),
    fields: { routingKey: (event as any).type ?? 'task.event.created' },
    properties: { headers: {}, messageId: 'm1', contentType: 'application/json', type: 'x' },
    ...extra
});
const created = (data: object, userId: string | null = 'admin') =>
    ({ eventId: 'e1', type: 'task.event.created', taskId: 't1', userId, occurredAt: '2026-10-22T08:00:00.000Z', data });

describe('Claves de enrutamiento de los eventos de dominio', () => {
    it('cada acción de tarea se publica bajo task.event.*', () => {
        expect(routingKeyFor('task.created')).to.equal('task.event.created');
        for (const a of ['task.start', 'task.submit', 'task.approve', 'task.status_changed']) expect(routingKeyFor(a)).to.equal('task.event.status_changed');
        for (const a of ['task.assigned', 'task.assignment_undone']) expect(routingKeyFor(a)).to.equal('task.event.assigned');
        expect(routingKeyFor('task.attachment_added')).to.equal('task.event.attachment_added');
        expect(routingKeyFor('task.otra_cosa')).to.equal('task.event.otra_cosa');
    });
});

describe('DomainEvents.emit (actividad + RabbitMQ, dispara y olvida)', () => {
    const saved = { ...process.env };
    afterEach(() => { process.env = { ...saved }; sinon.restore(); });

    it('siempre registra la actividad, y sin RABBITMQ_URL no publica nada', () => {
        delete process.env.RABBITMQ_URL;
        const record = sinon.stub(ActivityLog, 'record');
        const publish = sinon.stub(EventPublisher, 'publish').resolves(true);
        DomainEvents.emit('t', 'u', 'task.created', { a: 1 });
        expect(record.calledOnceWith('t', 'u', 'task.created', { a: 1 })).to.be.true;
        expect(publish.called).to.be.false;
    });

    it('con RABBITMQ_URL publica un evento con id, tipo, tarea, usuario y datos', () => {
        process.env.RABBITMQ_URL = 'amqp://127.0.0.1:5672';
        sinon.stub(ActivityLog, 'record');
        const publish = sinon.stub(EventPublisher, 'publish').resolves(true);
        DomainEvents.emit('t1', 'u1', 'task.start', { status: 'In-Progress' });
        const event = publish.firstCall.args[0];
        expect(event).to.deep.include({ type: 'task.event.status_changed', taskId: 't1', userId: 'u1', data: { status: 'In-Progress' } });
        expect(event.eventId).to.match(/^[0-9a-f-]{36}$/);
        expect(new Date(event.occurredAt).toString()).to.not.equal('Invalid Date');
    });

    it('si RabbitMQ falla nunca lanza ni rompe la petición', async () => {
        process.env.RABBITMQ_URL = 'amqp://127.0.0.1:5672';
        sinon.stub(ActivityLog, 'record');
        sinon.stub(console, 'error');
        sinon.stub(EventPublisher, 'publish').rejects(new Error('broker caído'));
        expect(() => DomainEvents.emit('t', 'u', 'task.created')).to.not.throw();
        await new Promise((r) => setImmediate(r));
    });
});

describe('EventPublisher: confirmación del broker', () => {
    beforeEach(() => sinon.stub(console, 'log'));
    afterEach(() => sinon.restore());
    const withChannel = (publish: (...args: any[]) => void) =>
        sinon.stub(RabbitMQConnection.getInstance(), 'connect').resolves({ publish: sinon.spy(publish) } as any);

    it('construye eventos con identificador único', () => {
        const a = EventPublisher.buildEvent('task.event.created', 't', undefined, {});
        const b = EventPublisher.buildEvent('task.event.created', 't', 'u', {});
        expect(a.eventId).to.not.equal(b.eventId);
        expect(a.userId).to.equal(null);
    });

    it('publica persistente en el intercambiador con la clave de enrutamiento y espera el confirm', async () => {
        const connect = withChannel((_ex, _rk, _p, _o, cb) => cb(null));
        const event = EventPublisher.buildEvent('task.event.created', 't1', 'u', { n: 1 });
        expect(await EventPublisher.publish(event)).to.equal(true);
        const channel: any = await connect.firstCall.returnValue;
        const [exchange, key, payload, options] = channel.publish.firstCall.args;
        expect(exchange).to.equal('pms_events_exchange');
        expect(key).to.equal('task.event.created');
        expect(JSON.parse(payload.toString())).to.deep.equal(event);
        expect(options).to.deep.include({ persistent: true, contentType: 'application/json', messageId: event.eventId });
    });

    it('falla si el broker rechaza el mensaje (nack del confirm)', async () => {
        withChannel((_ex, _rk, _p, _o, cb) => cb(new Error('nack')));
        let error: any;
        try { await EventPublisher.publish(EventPublisher.buildEvent('task.event.created', 't', 'u', {})); } catch (e) { error = e; }
        expect(error.message).to.equal('nack');
    });

    it('falla si el broker no confirma a tiempo (no deja la petición esperando)', async function () {
        this.timeout(6000);
        withChannel(() => undefined);
        let error: any;
        try { await EventPublisher.publish(EventPublisher.buildEvent('task.event.created', 't', 'u', {})); } catch (e) { error = e; }
        expect(error.message).to.contain('no confirmó');
    });
});

describe('consumeWithRetry: ACK manual, reintentos y mensajes muertos', () => {
    const run = async (handler: (m: any) => Promise<void>, msg: any, max?: number) => {
        let deliver: (m: any) => Promise<void> = async () => undefined;
        const channel: any = {
            prefetch: sinon.stub().resolves(),
            consume: sinon.stub().callsFake(async (_q: string, fn: any) => { deliver = fn; return { consumerTag: 'tag' }; }),
            ack: sinon.spy(), nack: sinon.spy(), sendToQueue: sinon.spy()
        };
        await consumeWithRetry(channel, 'cola', handler, { maxAttempts: max, name: 'T' });
        await deliver(msg);
        return channel;
    };
    beforeEach(() => { sinon.stub(console, 'warn'); sinon.stub(console, 'error'); });
    afterEach(() => sinon.restore());

    it('procesa de uno en uno (prefetch 1) y confirma con ACK cuando el manejador termina', async () => {
        const msg = message(created({}));
        const channel = await run(async () => undefined, msg);
        expect(channel.prefetch.calledOnceWith(1)).to.be.true;
        expect(channel.ack.calledOnceWith(msg)).to.be.true;
        expect(channel.nack.called).to.be.false;
    });

    it('ante un error reencola con el contador x-attempts y confirma el original', async () => {
        const msg = message(created({}));
        const channel = await run(async () => { throw new Error('smtp'); }, msg);
        expect(channel.sendToQueue.calledOnce).to.be.true;
        expect(channel.sendToQueue.firstCall.args[0]).to.equal('cola');
        expect(channel.sendToQueue.firstCall.args[2].headers['x-attempts']).to.equal(1);
        expect(channel.ack.calledOnceWith(msg)).to.be.true;
        expect(channel.nack.called).to.be.false;
    });

    it(`tras ${MAX_ATTEMPTS} intentos manda el mensaje a la cola de mensajes muertos (nack sin reencolar)`, async () => {
        const msg = message(created({}), { properties: { headers: { 'x-attempts': MAX_ATTEMPTS - 1 } } });
        const channel = await run(async () => { throw new Error('siempre falla'); }, msg);
        expect(channel.nack.calledOnceWith(msg, false, false)).to.be.true;
        expect(channel.sendToQueue.called).to.be.false;
        expect(channel.ack.called).to.be.false;
    });
});

describe('Consumidor de notificaciones', () => {
    const deps = (emails: Record<string, string | null> = { b: 'beto@pms.com' }) => ({
        findUserEmail: sinon.stub().callsFake(async (id: string) => emails[id] ?? null),
        findTaskName: sinon.stub().resolves('Nombre de BD'),
        sendEmail: sinon.stub().resolves()
    });
    beforeEach(() => sinon.stub(console, 'log'));
    afterEach(() => sinon.restore());

    it('avisa a la persona asignada al crear la tarea', async () => {
        const d = deps();
        await buildNotificationHandler(d)(message(created({ name: 'Diseñar API', assigned_user_id: 'b' })));
        expect(d.sendEmail.calledOnce).to.be.true;
        expect(d.sendEmail.firstCall.args[0]).to.equal('beto@pms.com');
        expect(d.sendEmail.firstCall.args[1]).to.equal('Se te asignó la tarea: Diseñar API');
    });

    it('avisa en una reasignación y obtiene el nombre de la tarea cuando el evento no lo trae', async () => {
        const d = deps();
        await buildNotificationHandler(d)(message({ ...created({ user_id: 'b', previous_user_id: 'x' }), type: 'task.event.assigned' }));
        expect(d.findTaskName.calledWith('t1')).to.be.true;
        expect(d.sendEmail.firstCall.args[1]).to.contain('Nombre de BD');
    });

    it('no avisa si no hay asignado, si se la asignó a sí mismo, si el usuario no existe o el evento es de otro tipo', async () => {
        const d = deps();
        const handler = buildNotificationHandler(d);
        await handler(message(created({ name: 'X', assigned_user_id: null })));
        await handler(message(created({ name: 'X', assigned_user_id: 'b' }, 'b')));
        await handler(message(created({ name: 'X', assigned_user_id: 'fantasma' })));
        await handler(message({ ...created({ user_id: 'b' }), type: 'task.event.status_changed' }));
        expect(d.sendEmail.called).to.be.false;
    });

    it('escapa el HTML del nombre de la tarea', async () => {
        const d = deps();
        await buildNotificationHandler(d)(message(created({ name: '<script>x</script>', assigned_user_id: 'b' })));
        expect(d.sendEmail.firstCall.args[2]).to.not.contain('<script>');
        expect(d.sendEmail.firstCall.args[2]).to.contain('&lt;script&gt;');
    });

    it('propaga los fallos de envío para que el consumidor reintente', async () => {
        const d = deps();
        d.sendEmail.rejects(new Error('redis caído'));
        let error: any;
        try { await buildNotificationHandler(d)(message(created({ name: 'X', assigned_user_id: 'b' }))); } catch (e) { error = e; }
        expect(error.message).to.equal('redis caído');
    });
});

describe('Consumidor de auditoría (idempotente)', () => {
    beforeEach(() => sinon.stub(console, 'log'));
    afterEach(() => sinon.restore());

    it('guarda cada evento con su clave de enrutamiento', async () => {
        const store = { save: sinon.stub().resolves(true) };
        const event = created({ name: 'X' });
        await buildAuditHandler(store)(message(event, { fields: { routingKey: 'task.event.created' } }));
        expect(store.save.calledOnceWith('task.event.created', event)).to.be.true;
    });

    it('un evento repetido se reconoce como duplicado y no falla', async () => {
        const store = { save: sinon.stub().resolves(false) };
        await buildAuditHandler(store)(message(created({})));
        expect((console.log as sinon.SinonStub).firstCall.args[0]).to.contain('DUPLICADO');
    });

    it('rechaza mensajes que no son eventos válidos (irán a reintento y a la cola de mensajes muertos)', async () => {
        const store = { save: sinon.stub() };
        let error: any;
        try { await buildAuditHandler(store)(message({ basura: true })); } catch (e) { error = e; }
        expect(error.message).to.contain('eventId');
        expect(store.save.called).to.be.false;
    });
});

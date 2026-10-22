import { bootstrap } from './helpers';

async function prepareRabbitMQ(): Promise<void> {
    const api = process.env.TEST_RABBITMQ_API || 'http://127.0.0.1:15672';
    const auth = 'Basic ' + Buffer.from('guest:guest').toString('base64');
    const vhost = 'pms_test';
    try {
        const created = await fetch(`${api}/api/vhosts/${vhost}`, { method: 'PUT', headers: { Authorization: auth } });
        const perms = await fetch(`${api}/api/permissions/${vhost}/guest`, {
            method: 'PUT',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ configure: '.*', write: '.*', read: '.*' })
        });
        if (!created.ok || !perms.ok) throw new Error('vhost');
        process.env.RABBITMQ_URL = process.env.TEST_RABBITMQ_URL || `amqp://guest:guest@127.0.0.1:5672/${vhost}`;
    } catch {
        delete process.env.RABBITMQ_URL;
    }
}

export const mochaHooks = {
    beforeAll: async function (this: Mocha.Context) {
        this.timeout(60000);
        await prepareRabbitMQ();
        await bootstrap();
    }
};

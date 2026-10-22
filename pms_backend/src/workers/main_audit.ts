import 'dotenv/config';
import 'reflect-metadata';
import { DatabaseUtil } from '../utils/db';
import { RabbitMQConnection } from '../messaging/rabbitmq_connection';
import { startAuditConsumer } from '../messaging/audit_consumer';

(async () => {
    new DatabaseUtil();
    await DatabaseUtil.waitUntilReady();
    RabbitMQConnection.getInstance().onDisconnect(() => {
        console.error('[Auditoría] Se perdió la conexión con RabbitMQ; terminando para que el supervisor me reinicie.');
        process.exit(1);
    });
    await startAuditConsumer();

    const shutdown = async () => {
        console.log('[Auditoría] Cerrando conexión con RabbitMQ...');
        await RabbitMQConnection.getInstance().close();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
})().catch((error) => {
    console.error('[Auditoría] No se pudo iniciar:', error.message);
    process.exit(1);
});

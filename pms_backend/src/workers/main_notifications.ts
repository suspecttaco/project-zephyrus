import 'dotenv/config';
import 'reflect-metadata';
import { DatabaseUtil } from '../utils/db';
import { RabbitMQConnection } from '../messaging/rabbitmq_connection';
import { startNotificationConsumer } from '../messaging/notification_consumer';

(async () => {
    new DatabaseUtil();
    await DatabaseUtil.waitUntilReady();
    RabbitMQConnection.getInstance().onDisconnect(() => {
        console.error('[Notificaciones] Se perdió la conexión con RabbitMQ; terminando para que el supervisor me reinicie.');
        process.exit(1);
    });
    await startNotificationConsumer();

    const shutdown = async () => {
        console.log('[Notificaciones] Cerrando conexión con RabbitMQ...');
        await RabbitMQConnection.getInstance().close();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
})().catch((error) => {
    console.error('[Notificaciones] No se pudo iniciar:', error.message);
    process.exit(1);
});

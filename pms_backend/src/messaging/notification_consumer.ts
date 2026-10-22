import { ConsumeMessage } from 'amqplib';
import { DatabaseUtil } from '../utils/db';
import { Users } from '../components/users/users_entity';
import { Tasks } from '../components/tasks/tasks_entity';
import { NotificationUtil } from '../utils/notification_util';
import { escapeHtml } from '../utils/task_notifications';
import { RabbitMQConnection } from './rabbitmq_connection';
import { consumeWithRetry, setupQueue } from './consumer_support';
import { DomainEvent } from './event_publisher';

export const NOTIFICATION_QUEUE = 'notification_service_queue';

export interface NotificationDeps {
    findUserEmail(userId: string): Promise<string | null>;
    findTaskName(taskId: string): Promise<string | null>;
    sendEmail(to: string, subject: string, html: string): Promise<void>;
}

export const defaultNotificationDeps: NotificationDeps = {
    async findUserEmail(userId) {
        return (await new DatabaseUtil().getRepository(Users).findOneBy({ user_id: userId }))?.email ?? null;
    },
    async findTaskName(taskId) {
        return (await new DatabaseUtil().getRepository(Tasks).findOneBy({ task_id: taskId }))?.name ?? null;
    },
    sendEmail: (to, subject, html) => NotificationUtil.enqueueEmail(to, subject, html)
};

export function buildNotificationHandler(deps: NotificationDeps = defaultNotificationDeps) {
    return async (msg: ConsumeMessage): Promise<void> => {
        const event: DomainEvent<any> = JSON.parse(msg.content.toString());
        if (event.type !== 'task.event.created' && event.type !== 'task.event.assigned') return;

        const assigneeId: string | undefined = event.data?.user_id ?? event.data?.assigned_user_id;
        if (!assigneeId || assigneeId === event.userId) return;

        const email = await deps.findUserEmail(assigneeId);
        if (!email) return;
        const taskName = event.data?.name ?? (await deps.findTaskName(event.taskId)) ?? 'una tarea';

        await deps.sendEmail(email, `Se te asignó la tarea: ${taskName}`,
            `<p>Hola, se te ha asignado la tarea <b>${escapeHtml(taskName)}</b>.</p>`);
        console.log(`[NotificationWorker] Aviso de asignación enviado a ${email} por tarea '${taskName}'`);
    };
}

export async function startNotificationConsumer(deps: NotificationDeps = defaultNotificationDeps): Promise<string> {
    const channel = await RabbitMQConnection.getInstance().connect();
    await setupQueue(channel, NOTIFICATION_QUEUE, 'task.event.*');
    console.log(`[NotificationWorker] Escuchando eventos en la cola '${NOTIFICATION_QUEUE}'...`);
    return consumeWithRetry(channel, NOTIFICATION_QUEUE, buildNotificationHandler(deps), { name: 'NotificationWorker' });
}

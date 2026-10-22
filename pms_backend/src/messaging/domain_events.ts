import { ActivityLog } from '../utils/activity_client';
import { EventPublisher } from './event_publisher';
import { RabbitMQConnection } from './rabbitmq_connection';

const ROUTING_KEYS: Record<string, string> = {
    'task.created': 'task.event.created',
    'task.start': 'task.event.status_changed',
    'task.submit': 'task.event.status_changed',
    'task.approve': 'task.event.status_changed',
    'task.status_changed': 'task.event.status_changed',
    'task.assigned': 'task.event.assigned',
    'task.assignment_undone': 'task.event.assigned',
    'task.attachment_added': 'task.event.attachment_added',
    'task.attachment_removed': 'task.event.attachment_removed'
};

export const routingKeyFor = (action: string): string => ROUTING_KEYS[action] ?? `task.event.${action.replace(/^task\./, '')}`;

let warned = false;

export const DomainEvents = {
    emit(taskId: string, userId: string | null | undefined, action: string, details?: Record<string, unknown>): void {
        ActivityLog.record(taskId, userId, action, details);

        if (!RabbitMQConnection.isEnabled()) return;
        EventPublisher.publish(EventPublisher.buildEvent(routingKeyFor(action), taskId, userId, details ?? {}))
            .then(() => { warned = false; })
            .catch((error: any) => {
                if (!warned) {
                    warned = true;
                    console.error(`[Eventos] No se pudo publicar ${action} en RabbitMQ: ${error.message}`);
                }
            });
    }
};

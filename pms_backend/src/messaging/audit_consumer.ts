import { ConsumeMessage } from 'amqplib';
import { DatabaseUtil } from '../utils/db';
import { AuditEvents } from '../components/audit/audit_entity';
import { RabbitMQConnection } from './rabbitmq_connection';
import { consumeWithRetry, setupQueue } from './consumer_support';
import { DomainEvent } from './event_publisher';

export const AUDIT_QUEUE = 'audit_service_queue';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuditStore {
    save(routingKey: string, event: DomainEvent): Promise<boolean>;
}

export class PostgresAuditStore implements AuditStore {
    async save(routingKey: string, event: DomainEvent): Promise<boolean> {
        const result = await new DatabaseUtil().getRepository(AuditEvents).createQueryBuilder()
            .insert()
            .values({
                event_id: event.eventId,
                routing_key: routingKey,
                task_id: UUID.test(event.taskId) ? event.taskId : null,
                user_id: event.userId && UUID.test(event.userId) ? event.userId : null,
                payload: event as unknown as object,
                occurred_at: new Date(event.occurredAt)
            })
            .orIgnore()
            .returning('event_id')
            .execute();
        return Array.isArray(result.raw) && result.raw.length > 0;
    }
}

export function buildAuditHandler(store: AuditStore) {
    return async (msg: ConsumeMessage): Promise<void> => {
        const event: DomainEvent = JSON.parse(msg.content.toString());
        if (!event.eventId || !event.occurredAt) {
            throw new Error('Evento sin eventId u occurredAt');
        }
        const saved = await store.save(msg.fields.routingKey, event);
        console.log(`[AuditWorker] [${saved ? 'REGISTRADO' : 'DUPLICADO'} - ${msg.fields.routingKey}]: ${event.eventId}`);
    };
}

export async function startAuditConsumer(store: AuditStore = new PostgresAuditStore()): Promise<string> {
    const channel = await RabbitMQConnection.getInstance().connect();
    await setupQueue(channel, AUDIT_QUEUE, '#');
    console.log(`[AuditWorker] Escuchando todos los eventos en la cola '${AUDIT_QUEUE}'...`);
    return consumeWithRetry(channel, AUDIT_QUEUE, buildAuditHandler(store), { name: 'AuditWorker' });
}

import { randomUUID } from 'crypto';
import { RabbitMQConnection } from './rabbitmq_connection';

export interface DomainEvent<T = unknown> {
    eventId: string;
    type: string;
    taskId: string;
    userId: string | null;
    occurredAt: string;
    data: T;
}

const PUBLISH_TIMEOUT_MS = 3000;

export class EventPublisher {
    public static buildEvent<T>(type: string, taskId: string, userId: string | null | undefined, data: T): DomainEvent<T> {
        return { eventId: randomUUID(), type, taskId, userId: userId ?? null, occurredAt: new Date().toISOString(), data };
    }

    public static async publish(event: DomainEvent): Promise<true> {
        const rabbit = RabbitMQConnection.getInstance();
        const channel = await rabbit.connect();
        const payload = Buffer.from(JSON.stringify(event));

        const confirmed = new Promise<true>((resolve, reject) => {
            channel.publish(rabbit.EXCHANGE_NAME, event.type, payload,
                { persistent: true, contentType: 'application/json', messageId: event.eventId, type: event.type },
                (err) => (err ? reject(err) : resolve(true)));
        });
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('RabbitMQ no confirmó el mensaje a tiempo')), PUBLISH_TIMEOUT_MS).unref());

        const result = await Promise.race([confirmed, timeout]);
        console.log(`[Publisher] Evento publicado (${event.type}): ${event.taskId}`);
        return result;
    }
}

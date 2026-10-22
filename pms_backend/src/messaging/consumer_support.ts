import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { RabbitMQConnection } from './rabbitmq_connection';

export const MAX_ATTEMPTS = 3;

export async function setupQueue(channel: ConfirmChannel, queue: string, bindingKey: string): Promise<void> {
    const rabbit = RabbitMQConnection.getInstance();
    await channel.assertQueue(queue, { durable: true, deadLetterExchange: rabbit.DLX_NAME });
    await channel.bindQueue(queue, rabbit.EXCHANGE_NAME, bindingKey);
}

export async function consumeWithRetry(
    channel: ConfirmChannel,
    queue: string,
    handler: (msg: ConsumeMessage) => Promise<void>,
    options: { prefetch?: number; maxAttempts?: number; name?: string } = {}
): Promise<string> {
    const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    const name = options.name ?? queue;
    await channel.prefetch(options.prefetch ?? 1);

    const { consumerTag } = await channel.consume(queue, async (msg) => {
        if (!msg) return;
        try {
            await handler(msg);
            channel.ack(msg);
        } catch (error: any) {
            const attempts = Number(msg.properties.headers?.['x-attempts'] ?? 0) + 1;
            if (attempts >= maxAttempts) {
                console.error(`[${name}] Mensaje descartado tras ${attempts} intentos (va a la cola de mensajes muertos): ${error.message}`);
                channel.nack(msg, false, false);
            } else {
                console.warn(`[${name}] Error (intento ${attempts}/${maxAttempts}), se reintenta: ${error.message}`);
                channel.sendToQueue(queue, msg.content, {
                    persistent: true,
                    contentType: msg.properties.contentType,
                    messageId: msg.properties.messageId,
                    type: msg.properties.type,
                    headers: { ...msg.properties.headers, 'x-attempts': attempts }
                });
                channel.ack(msg);
            }
        }
    }, { noAck: false });
    return consumerTag;
}

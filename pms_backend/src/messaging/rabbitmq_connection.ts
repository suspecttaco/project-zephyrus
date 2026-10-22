import amqp, { ChannelModel, ConfirmChannel } from 'amqplib';

export class RabbitMQConnection {
    private static instance: RabbitMQConnection;
    private connection: ChannelModel | null = null;
    private channel: ConfirmChannel | null = null;
    private connecting: Promise<ConfirmChannel> | null = null;
    private closing = false;
    private disconnectHandlers: Array<() => void> = [];

    public readonly EXCHANGE_NAME = 'pms_events_exchange';
    public readonly DLX_NAME = 'pms_events_dlx';
    public readonly DEAD_QUEUE = 'pms_dead_letters';

    private constructor() {}

    public static getInstance(): RabbitMQConnection {
        if (!RabbitMQConnection.instance) {
            RabbitMQConnection.instance = new RabbitMQConnection();
        }
        return RabbitMQConnection.instance;
    }

    public static isEnabled(): boolean {
        return !!process.env.RABBITMQ_URL;
    }

    public onDisconnect(handler: () => void): void {
        this.disconnectHandlers.push(handler);
    }

    public isConnected(): boolean {
        return this.channel !== null;
    }

    public async connect(url: string = process.env.RABBITMQ_URL || 'amqp://127.0.0.1:5672'): Promise<ConfirmChannel> {
        if (this.channel) return this.channel;
        if (this.connecting) return this.connecting;

        this.connecting = (async () => {
            const connection = await amqp.connect(url);
            connection.on('error', (err) => console.error('[RabbitMQ] Error de conexión:', err.message));
            connection.on('close', () => {
                this.connection = null;
                this.channel = null;
                if (!this.closing) this.disconnectHandlers.forEach((handler) => handler());
            });

            const channel = await connection.createConfirmChannel();
            channel.on('error', (err) => console.error('[RabbitMQ] Error de canal:', err.message));
            channel.on('close', () => { this.channel = null; });

            await channel.assertExchange(this.EXCHANGE_NAME, 'topic', { durable: true });
            await channel.assertExchange(this.DLX_NAME, 'topic', { durable: true });
            await channel.assertQueue(this.DEAD_QUEUE, { durable: true });
            await channel.bindQueue(this.DEAD_QUEUE, this.DLX_NAME, '#');

            this.connection = connection;
            this.channel = channel;
            console.log('[RabbitMQ] Conexión establecida e intercambiadores declarados.');
            return channel;
        })().finally(() => { this.connecting = null; });

        return this.connecting;
    }

    public async close(): Promise<void> {
        const { channel, connection } = this;
        this.closing = true;
        this.channel = null;
        this.connection = null;
        await channel?.close().catch(() => undefined);
        await connection?.close().catch(() => undefined);
        this.closing = false;
    }
}

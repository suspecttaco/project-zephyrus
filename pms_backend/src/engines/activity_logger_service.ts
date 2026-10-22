import { Level } from 'level';

export interface ActivityEvent {
    taskId: string;
    userId: string | null;
    action: string;
    details?: unknown;
    timestamp: string;
}

export interface HistoryOptions {
    limit?: number;
    reverse?: boolean;
}

export class ActivityLoggerService {
    private db: Level<string, string>;
    private sequence = 0;

    constructor(dbPath: string) {
        this.db = new Level<string, string>(dbPath, { valueEncoding: 'utf8' });
    }

    public async open(): Promise<void> {
        await this.db.open();
    }

    public async logEvent(taskId: string, userId: string | null, action: string, details?: unknown): Promise<ActivityEvent> {
        const timestamp = new Date().toISOString();
        const key = `event:${taskId}:${timestamp}:${String(this.sequence++ % 1_000_000).padStart(6, '0')}`;
        const event: ActivityEvent = { taskId, userId, action, details, timestamp };
        await this.db.put(key, JSON.stringify(event));
        return event;
    }

    public async getTaskHistory(taskId: string, options: HistoryOptions = {}): Promise<ActivityEvent[]> {
        const events: ActivityEvent[] = [];
        for await (const [, value] of this.db.iterator({
            gte: `event:${taskId}:`,
            lte: `event:${taskId}:\xff`,
            reverse: options.reverse ?? false,
            limit: options.limit ?? -1
        })) {
            events.push(JSON.parse(value));
        }
        return events;
    }

    public async close(): Promise<void> {
        await this.db.close();
    }
}

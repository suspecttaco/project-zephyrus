import * as path from 'path';
import { ActivityEvent, ActivityLoggerService, HistoryOptions } from './activity_logger_service';
import { LogEngineStats, SimpleLogEngine } from './simple_log_engine';

const COMPACT_MIN_BYTES = 256 * 1024;
const COMPACT_GARBAGE_RATIO = 0.5;

export class ActivityStore {
    private readonly history: ActivityLoggerService;
    private readonly latest: SimpleLogEngine;

    constructor(dir: string) {
        this.history = new ActivityLoggerService(path.join(dir, 'history'));
        this.latest = new SimpleLogEngine(path.join(dir, 'latest.log'));
    }

    public async open(): Promise<void> {
        await this.history.open();
    }

    public async record(taskId: string, userId: string | null, action: string, details?: unknown): Promise<ActivityEvent> {
        const event = await this.history.logEvent(taskId, userId, action, details);
        await this.latest.set(`task:${taskId}`, JSON.stringify(event));
        const stats = this.latest.stats();
        if (stats.fileBytes > COMPACT_MIN_BYTES && stats.garbageRatio > COMPACT_GARBAGE_RATIO) {
            await this.latest.compact();
        }
        return event;
    }

    public getHistory(taskId: string, options?: HistoryOptions): Promise<ActivityEvent[]> {
        return this.history.getTaskHistory(taskId, options);
    }

    public async getLast(taskId: string): Promise<ActivityEvent | null> {
        const raw = await this.latest.get(`task:${taskId}`);
        return raw ? JSON.parse(raw) : null;
    }

    public stats(): { latestIndex: LogEngineStats } {
        return { latestIndex: this.latest.stats() };
    }

    public compact(): Promise<LogEngineStats> {
        return this.latest.compact();
    }

    public async close(): Promise<void> {
        this.latest.close();
        await this.history.close();
    }
}

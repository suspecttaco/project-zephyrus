import { DatabaseUtil } from '../utils/db';
import { ProjectMetricsProjector } from './projectors';
import { ChangeRow, deriveEvents } from './stream_events';

export const PROJECT_METRICS_CONSUMER = 'project-metrics';

export interface ProcessorOptions {
    consumer?: string;
    batchSize?: number;
    intervalMs?: number;
}

export class StreamProcessor {
    private running = false;
    private timer?: NodeJS.Timeout;
    private readonly consumer: string;
    private readonly batchSize: number;
    private readonly intervalMs: number;

    constructor(options: ProcessorOptions = {}) {
        this.consumer = options.consumer ?? PROJECT_METRICS_CONSUMER;
        this.batchSize = options.batchSize ?? 200;
        this.intervalMs = options.intervalMs ?? 500;
    }

    private get dataSource() {
        return new DatabaseUtil().getDataSource();
    }

    public async processBatch(): Promise<number> {
        const runner = this.dataSource.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        try {
            await runner.query(`INSERT INTO stream_offsets (consumer, last_seq) VALUES ($1, 0) ON CONFLICT (consumer) DO NOTHING`, [this.consumer]);
            const [{ last_seq }] = await runner.query(`SELECT last_seq FROM stream_offsets WHERE consumer = $1 FOR UPDATE`, [this.consumer]);

            const rows: Array<ChangeRow & { tx_id: string; safe_xmin: string }> = await runner.query(
                `SELECT seq, op, task_id, old_row, new_row, changed_at, tx_id,
                        pg_snapshot_xmin(pg_current_snapshot())::text AS safe_xmin
                   FROM task_changes WHERE seq > $1 ORDER BY seq LIMIT $2`, [last_seq, this.batchSize]);

            const safe: typeof rows = [];
            for (const row of rows) {
                if (BigInt(row.tx_id) >= BigInt(row.safe_xmin)) break;
                safe.push(row);
            }
            if (safe.length === 0) {
                await runner.commitTransaction();
                return 0;
            }

            const projector = new ProjectMetricsProjector();
            for (const change of safe) deriveEvents(change).forEach((event) => projector.handleEvent(event));

            for (const [projectId, d] of projector.getDeltas()) {
                await runner.query(
                    `INSERT INTO project_metrics (project_id, total, not_started, in_progress, in_review, completed)
                          VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (project_id) DO UPDATE SET
                          total = project_metrics.total + EXCLUDED.total,
                          not_started = project_metrics.not_started + EXCLUDED.not_started,
                          in_progress = project_metrics.in_progress + EXCLUDED.in_progress,
                          in_review = project_metrics.in_review + EXCLUDED.in_review,
                          completed = project_metrics.completed + EXCLUDED.completed,
                          updated_at = now()`,
                    [projectId, d.total, d.not_started, d.in_progress, d.in_review, d.completed]);
            }

            await runner.query(`UPDATE stream_offsets SET last_seq = $2, updated_at = now() WHERE consumer = $1`, [this.consumer, safe[safe.length - 1].seq]);
            await runner.commitTransaction();
            return safe.length;
        } catch (error) {
            await runner.rollbackTransaction();
            throw error;
        } finally {
            await runner.release();
        }
    }

    public async drain(): Promise<number> {
        let total = 0;
        for (let n = await this.processBatch(); n > 0; n = await this.processBatch()) total += n;
        return total;
    }

    public async lag(): Promise<number> {
        const [row] = await this.dataSource.query(
            `SELECT count(*)::int AS lag FROM task_changes WHERE seq > COALESCE((SELECT last_seq FROM stream_offsets WHERE consumer = $1), 0)`, [this.consumer]);
        return row.lag;
    }

    public async rebuild(): Promise<number> {
        const runner = this.dataSource.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        try {
            await runner.query(`INSERT INTO stream_offsets (consumer, last_seq) VALUES ($1, 0) ON CONFLICT (consumer) DO NOTHING`, [this.consumer]);
            await runner.query(`SELECT last_seq FROM stream_offsets WHERE consumer = $1 FOR UPDATE`, [this.consumer]);
            await runner.query(`TRUNCATE project_metrics`);
            await runner.query(`UPDATE stream_offsets SET last_seq = 0, updated_at = now() WHERE consumer = $1`, [this.consumer]);
            await runner.commitTransaction();
        } catch (error) {
            await runner.rollbackTransaction();
            throw error;
        } finally {
            await runner.release();
        }
        return this.drain();
    }

    public start(): void {
        if (this.running) return;
        this.running = true;
        const tick = async () => {
            if (!this.running) return;
            let processed = 0;
            try {
                processed = await this.processBatch();
            } catch (error: any) {
                console.error(`[Proyector] Error procesando el lote: ${error.message}`);
            }
            if (this.running) this.timer = setTimeout(tick, processed > 0 ? 0 : this.intervalMs);
        };
        void tick();
    }

    public stop(): void {
        this.running = false;
        if (this.timer) clearTimeout(this.timer);
    }
}

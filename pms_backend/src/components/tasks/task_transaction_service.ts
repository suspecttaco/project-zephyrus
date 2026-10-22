import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { DatabaseUtil } from '../../utils/db';
import { executeSerializableTransaction } from '../../utils/serializable_retry';
import { Tasks, Status } from './tasks_entity';
import { TaskWorkflow, TaskLimitError } from '../../domain/task_workflow';

export const MAX_IN_PROGRESS_PER_PROJECT = Number(process.env.MAX_IN_PROGRESS_PER_PROJECT) || 5;

export interface TransactionOptions {
    isolation?: 'SERIALIZABLE' | 'READ COMMITTED';
    limit?: number;
    maxRetries?: number;
    afterRead?: () => Promise<void>;
    onRetry?: (attempt: number, delayMs: number) => void;
    lock?: boolean;
}

export type AttachmentResult = 'ok' | 'task_not_found' | 'attachment_not_found';

export class TaskTransactionService {
    private readonly options: Required<Pick<TransactionOptions, 'isolation' | 'limit' | 'maxRetries' | 'lock'>> & TransactionOptions;

    constructor(options: TransactionOptions = {}, private readonly dataSource: () => DataSource = () => new DatabaseUtil().getDataSource()) {
        this.options = { isolation: 'SERIALIZABLE', limit: MAX_IN_PROGRESS_PER_PROJECT, maxRetries: 6, lock: true, ...options };
    }

    private async inTransaction<T>(isolation: string | undefined, work: (manager: EntityManager) => Promise<T>): Promise<T> {
        const queryRunner: QueryRunner = this.dataSource().createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction(isolation as any);
        try {
            const result = await work(queryRunner.manager);
            await queryRunner.commitTransaction();
            return result;
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    public async startTaskWithLimit(taskId: string): Promise<Tasks | null> {
        return executeSerializableTransaction(
            () => this.inTransaction(this.options.isolation, async (manager) => {
                const task = await manager.findOne(Tasks, { where: { task_id: taskId }, loadRelationIds: true });
                if (!task) return null;

                const workflow = new TaskWorkflow(taskId, task.status);
                workflow.startWork();
                if (workflow.getStatus() === task.status) return task;

                const active = await manager.count(Tasks, { where: { project_id: task.project_id as any, status: Status.InProgress } });
                if (this.options.afterRead) await this.options.afterRead();
                if (active >= this.options.limit) {
                    throw new TaskLimitError(`Límite alcanzado: el proyecto ya tiene ${this.options.limit} tareas en progreso.`);
                }

                task.status = Status.InProgress;
                task.actual_start_time = task.actual_start_time ?? new Date();
                return manager.save(task);
            }),
            { maxRetries: this.options.maxRetries, initialDelayMs: 40, onRetry: this.options.onRetry }
        );
    }

    private async mutateAttachments(taskId: string, mutate: (list: any[]) => any[] | null): Promise<AttachmentResult> {
        return this.inTransaction(undefined, async (manager) => {
            const task = await manager.findOne(Tasks, {
                where: { task_id: taskId },
                ...(this.options.lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
                loadRelationIds: true
            });
            if (!task) return 'task_not_found';

            let current: any[] = [];
            try { current = task.supported_files ? JSON.parse(task.supported_files) : []; } catch { current = []; }
            if (this.options.afterRead) await this.options.afterRead();

            const updated = mutate(current);
            if (updated === null) return 'attachment_not_found';
            task.supported_files = JSON.stringify(updated);
            await manager.save(task);
            return 'ok';
        });
    }

    public addAttachment(taskId: string, attachment: { name: string; [key: string]: any }): Promise<AttachmentResult> {
        return this.mutateAttachments(taskId, (list) => [...list.filter((a) => a.name !== attachment.name), attachment]);
    }

    public removeAttachment(taskId: string, name: string): Promise<AttachmentResult> {
        return this.mutateAttachments(taskId, (list) => (list.some((a) => a.name === name) ? list.filter((a) => a.name !== name) : null));
    }
}

import { Entity, PrimaryGeneratedColumn, PrimaryColumn, Column, Index } from 'typeorm';

@Entity('task_changes')
@Index('idx_task_changes_task', ['task_id', 'seq'])
@Index('idx_task_changes_time', ['changed_at'])
export class TaskChanges {
    @PrimaryGeneratedColumn('increment', { type: 'bigint' })
    seq!: string;

    @Column({ type: 'char', length: 1 })
    op!: 'I' | 'U' | 'D';

    @Column({ type: 'uuid' })
    task_id!: string;

    @Column({ type: 'jsonb', nullable: true })
    old_row!: Record<string, any> | null;

    @Column({ type: 'jsonb', nullable: true })
    new_row!: Record<string, any> | null;

    @Column({ type: 'bigint', default: () => 'txid_current()' })
    tx_id!: string;

    @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
    changed_at!: Date;
}

@Entity('stream_offsets')
export class StreamOffsets {
    @PrimaryColumn({ length: 60 })
    consumer!: string;

    @Column({ type: 'bigint', default: 0 })
    last_seq!: string;

    @Column({ type: 'timestamptz', default: () => 'now()' })
    updated_at!: Date;
}

@Entity('project_metrics')
export class ProjectMetrics {
    @PrimaryColumn('uuid')
    project_id!: string;

    @Column({ type: 'int', default: 0 }) total!: number;
    @Column({ type: 'int', default: 0 }) not_started!: number;
    @Column({ type: 'int', default: 0 }) in_progress!: number;
    @Column({ type: 'int', default: 0 }) in_review!: number;
    @Column({ type: 'int', default: 0 }) completed!: number;

    @Column({ type: 'timestamptz', default: () => 'now()' })
    updated_at!: Date;
}

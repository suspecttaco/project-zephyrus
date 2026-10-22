import { Entity, PrimaryColumn, Column, Index, CreateDateColumn } from 'typeorm';

@Entity('audit_events')
@Index('idx_audit_task', ['task_id', 'occurred_at'])
export class AuditEvents {
    @PrimaryColumn('uuid')
    event_id!: string;

    @Column({ length: 100 })
    routing_key!: string;

    @Column({ type: 'uuid', nullable: true })
    task_id!: string | null;

    @Column({ type: 'uuid', nullable: true })
    user_id!: string | null;

    @Column({ type: 'jsonb' })
    payload!: object;

    @Column({ type: 'timestamp' })
    occurred_at!: Date;

    @CreateDateColumn()
    received_at!: Date;
}

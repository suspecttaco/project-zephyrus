import { Entity, Index, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Users } from '../users/users_entity';
import { Tasks } from '../tasks/tasks_entity';

@Entity('comments')
@Index('idx_comments_task_id', ['task_id'])
export class Comments {
    @PrimaryGeneratedColumn('uuid')
    comment_id!: string;

    @Column({ type: 'text', nullable: false })
    comment!: string;

    @ManyToOne(() => Tasks)
    @JoinColumn({ name: 'task_id' })
    task_id!: string;

    @ManyToOne(() => Users)
    @JoinColumn({ name: 'user_id' })
    user_id!: string;

    @Column({ type: 'text', nullable: true })
    supported_files!: string;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}


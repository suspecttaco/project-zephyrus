import { Entity, Index, Unique, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Users } from '../users/users_entity';
import { Projects } from '../projects/projects_entity';

import { Status, Priority } from '../../domain/task_status';
export { Status, Priority };

@Entity('tasks')
@Unique(['project_id', 'name'])
@Index('idx_tasks_user_id', ['user_id'])
@Index('idx_tasks_status', ['status'])
export class Tasks {
    @PrimaryGeneratedColumn('uuid')
    task_id!: string;

    @Column({ length: 30, nullable: false })
    name!: string;

    @Column({ length: 500, nullable: true })
    description!: string;

    @ManyToOne(() => Projects)
    @JoinColumn({ name: 'project_id' })
    project_id!: string;

    @ManyToOne(() => Users)
    @JoinColumn({ name: 'user_id' })
    user_id!: string;

    @Column({ type: 'timestamp', nullable: true })
    estimated_start_time!: Date;

    @Column({ type: 'timestamp', nullable: true })
    estimated_end_time!: Date;

    @Column({ type: 'timestamp', nullable: true })
    actual_start_time!: Date;

    @Column({ type: 'timestamp', nullable: true })
    actual_end_time!: Date;

    @Column({ type: 'enum', enum: Priority, default: Priority.Medium })
    priority!: Priority;

    @Column({ type: 'enum', enum: Status, default: Status.NotStarted })
    status!: Status;

    @Column({ type: 'text', nullable: true })
    supported_files!: string;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}


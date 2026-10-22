import { Task } from '../../domain/entities/task';
import { IReferenceLookup, ITaskRepository } from '../../domain/repositories/task_repository';
import { Priority, Status } from '../../domain/task_status';
import { DatabaseUtil } from '../../utils/db';
import { Tasks } from '../../components/tasks/tasks_entity';
import { Projects } from '../../components/projects/projects_entity';
import { Users } from '../../components/users/users_entity';

export class TypeOrmDomainTaskRepository implements ITaskRepository {
    private get repo() {
        return new DatabaseUtil().getRepository(Tasks);
    }

    private toDomain(row: Tasks): Task {
        return new Task({
            id: row.task_id,
            name: row.name,
            description: row.description ?? undefined,
            projectId: row.project_id,
            assignedUserId: row.user_id ?? undefined,
            priority: row.priority as Priority,
            status: row.status as Status,
            estimatedStartTime: row.estimated_start_time ?? undefined,
            estimatedEndTime: row.estimated_end_time ?? undefined,
            actualStartTime: row.actual_start_time ?? undefined,
            actualEndTime: row.actual_end_time ?? undefined,
            supportedFiles: row.supported_files ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }

    async save(task: Task): Promise<Task> {
        const row = this.repo.create({
            task_id: task.id,
            name: task.name,
            description: task.description,
            project_id: task.projectId,
            user_id: task.assignedUserId,
            priority: task.priority as Priority,
            status: task.status as Status,
            estimated_start_time: task.estimatedStartTime,
            estimated_end_time: task.estimatedEndTime,
            supported_files: task.supportedFiles
        } as any);
        const saved = (await this.repo.save(row)) as unknown as Tasks;
        return this.toDomain(await this.repo.findOneOrFail({ where: { task_id: saved.task_id }, loadRelationIds: true }));
    }

    async findById(id: string): Promise<Task | null> {
        const row = await this.repo.findOne({ where: { task_id: id }, loadRelationIds: true });
        return row ? this.toDomain(row) : null;
    }

    async findByProjectId(projectId: string): Promise<Task[]> {
        const rows = await this.repo.find({ where: { project_id: projectId } as any, loadRelationIds: true, order: { created_at: 'ASC' } });
        return rows.map((r) => this.toDomain(r));
    }
}

export class TypeOrmReferenceLookup implements IReferenceLookup {
    async projectExists(projectId: string): Promise<boolean> {
        return (await new DatabaseUtil().getRepository(Projects).findOneBy({ project_id: projectId })) !== null;
    }

    async userExists(userId: string): Promise<boolean> {
        return (await new DatabaseUtil().getRepository(Users).findOneBy({ user_id: userId })) !== null;
    }
}

import { DatabaseUtil } from '../utils/db';
import { Tasks } from '../components/tasks/tasks_entity';
import { ITaskRepository, TaskEntity } from './task_repository';

export class TypeOrmTaskRepository implements ITaskRepository {
    private get repo() {
        return new DatabaseUtil().getRepository(Tasks);
    }

    public async create(task: TaskEntity): Promise<TaskEntity> {
        const saved = await this.repo.save(this.repo.create(task as any));
        return saved as unknown as TaskEntity;
    }

    public async findById(id: string): Promise<TaskEntity | null> {
        const found = await this.repo.findOne({ where: { task_id: id }, loadRelationIds: true });
        return found as unknown as TaskEntity | null;
    }
}

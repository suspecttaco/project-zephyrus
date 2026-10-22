import { ITaskRepository, TaskEntity } from '../repositories/task_repository';
import { cryptoUtil } from '../utils/crypto_util';

export class EncryptedTaskRepositoryDecorator implements ITaskRepository {
    constructor(private readonly innerRepository: ITaskRepository) {}

    public async create(task: TaskEntity): Promise<TaskEntity> {
        const taskToSave = task.description
            ? { ...task, description: cryptoUtil.encrypt(task.description) }
            : task;
        const savedTask = await this.innerRepository.create(taskToSave);
        return { ...savedTask, description: task.description };
    }

    public async findById(id: string): Promise<TaskEntity | null> {
        const task = await this.innerRepository.findById(id);
        if (!task) return null;
        return task.description ? { ...task, description: cryptoUtil.decrypt(task.description) } : task;
    }
}

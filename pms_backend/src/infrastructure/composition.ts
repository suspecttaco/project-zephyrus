import { CreateTaskUseCase } from '../use-cases/create_task_use_case';
import { TypeOrmDomainTaskRepository, TypeOrmReferenceLookup } from '../adapters/repositories/typeorm_task_repository';
import { TaskNotificationsAdapter } from '../adapters/task_notifications_adapter';

export function buildCreateTaskUseCase(): CreateTaskUseCase {
    return new CreateTaskUseCase(new TypeOrmDomainTaskRepository(), new TypeOrmReferenceLookup(), new TaskNotificationsAdapter());
}

export function buildTaskReader(): TypeOrmDomainTaskRepository {
    return new TypeOrmDomainTaskRepository();
}

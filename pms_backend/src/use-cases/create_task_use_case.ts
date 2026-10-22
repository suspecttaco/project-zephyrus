import { Task } from '../domain/entities/task';
import { DomainValidationError, NotFoundError } from '../domain/errors';
import { IReferenceLookup, ITaskNotifier, ITaskWriter } from '../domain/repositories/task_repository';
import { Priority, Status } from '../domain/task_status';

export interface CreateTaskDTO {
    name: string;
    description?: string;
    projectId: string;
    assignedUserId?: string;
    priority?: Priority;
    status?: Status;
    estimatedStartTime?: Date;
    estimatedEndTime?: Date;
    supportedFiles?: string;
}

export class CreateTaskUseCase {
    constructor(
        private readonly tasks: ITaskWriter,
        private readonly references: IReferenceLookup,
        private readonly notifier?: ITaskNotifier
    ) {}

    async execute(dto: CreateTaskDTO): Promise<Task> {
        if (dto.status && dto.status !== Status.NotStarted) {
            throw new DomainValidationError('Una tarea nueva debe iniciar en estado Not-Started.');
        }
        const task = new Task({ ...dto, status: Status.NotStarted });

        if (!(await this.references.projectExists(task.projectId))) {
            throw new NotFoundError('El proyecto indicado no existe');
        }
        if (task.assignedUserId && !(await this.references.userExists(task.assignedUserId))) {
            throw new NotFoundError('El usuario asignado no existe');
        }

        const saved = await this.tasks.save(task);
        this.notifier?.notifyTaskCreated(saved);
        return saved;
    }
}

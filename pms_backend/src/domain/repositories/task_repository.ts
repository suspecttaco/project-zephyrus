import { Task } from '../entities/task';

export interface ITaskReader {
    findById(id: string): Promise<Task | null>;
    findByProjectId(projectId: string): Promise<Task[]>;
}

export interface ITaskWriter {
    save(task: Task): Promise<Task>;
}

export interface ITaskRepository extends ITaskReader, ITaskWriter {}

export interface IReferenceLookup {
    projectExists(projectId: string): Promise<boolean>;
    userExists(userId: string): Promise<boolean>;
}

export interface ITaskNotifier {
    notifyTaskCreated(task: Task): void;
}

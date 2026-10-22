export interface TaskEntity {
    task_id?: string;
    name: string;
    description?: string;
    project_id?: string;
    user_id?: string;
    [key: string]: any;
}

export interface ITaskRepository {
    create(task: TaskEntity): Promise<TaskEntity>;
    findById(id: string): Promise<TaskEntity | null>;
}

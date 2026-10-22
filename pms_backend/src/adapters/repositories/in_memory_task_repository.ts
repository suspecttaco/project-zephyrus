import { randomUUID } from 'crypto';
import { Task } from '../../domain/entities/task';
import { IReferenceLookup, ITaskRepository } from '../../domain/repositories/task_repository';

export class InMemoryTaskRepository implements ITaskRepository {
    public readonly items = new Map<string, Task>();

    async save(task: Task): Promise<Task> {
        const now = new Date();
        const saved = new Task({ ...task.toProps(), id: task.id ?? randomUUID(), createdAt: task.createdAt ?? now, updatedAt: now });
        this.items.set(saved.id as string, saved);
        return saved;
    }

    async findById(id: string): Promise<Task | null> {
        return this.items.get(id) ?? null;
    }

    async findByProjectId(projectId: string): Promise<Task[]> {
        return [...this.items.values()].filter((t) => t.projectId === projectId);
    }
}

export class InMemoryReferenceLookup implements IReferenceLookup {
    constructor(private readonly projects: string[] = [], private readonly users: string[] = []) {}
    async projectExists(id: string) { return this.projects.includes(id); }
    async userExists(id: string) { return this.users.includes(id); }
}

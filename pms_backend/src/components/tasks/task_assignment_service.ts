import { IAssignmentService, AssignUserCommand, CommandManager, HybridHistoryStore, SerializedCommand, SerializableCommand } from '../../commands/task_commands';
import { TaskService } from './tasks_service';

export class AssignmentError extends Error {
    constructor(public readonly statusCode: number, message: string) {
        super(message);
    }
}

export class TaskAssignmentService implements IAssignmentService {
    private async setUser(taskId: string, userId: string | null): Promise<void> {
        const result = await new TaskService().update(taskId, { user_id: userId });
        if (result.statusCode !== 200) {
            throw new AssignmentError(result.statusCode, result.message ?? 'No se pudo cambiar la asignación');
        }
    }

    assign(taskId: string, userId: string): Promise<void> { return this.setUser(taskId, userId); }
    unassign(taskId: string): Promise<void> { return this.setUser(taskId, null); }
}

export function buildAssignmentCommandManager(service: IAssignmentService = new TaskAssignmentService()): CommandManager {
    const rebuild = (entry: SerializedCommand): SerializableCommand => {
        if (entry.type === AssignUserCommand.TYPE) {
            return new AssignUserCommand(entry.taskId, entry.newUserId, entry.previousUserId, service);
        }
        throw new Error(`Comando desconocido: ${entry.type}`);
    };
    return new CommandManager(new HybridHistoryStore(), rebuild);
}

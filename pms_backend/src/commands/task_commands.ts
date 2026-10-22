import { CacheUtil } from '../utils/cache_util';

export interface Command {
    execute(): Promise<void>;
    undo(): Promise<void>;
}

export interface SerializedCommand {
    type: string;
    [key: string]: any;
}

export interface SerializableCommand extends Command {
    serialize(): SerializedCommand;
}

export interface IAssignmentService {
    assign(taskId: string, userId: string): Promise<void>;
    unassign(taskId: string): Promise<void>;
}

export class AssignUserCommand implements SerializableCommand {
    public static readonly TYPE = 'assign_user';

    constructor(
        private readonly taskId: string,
        private readonly newUserId: string,
        private readonly previousUserId: string | null,
        private readonly taskService: IAssignmentService
    ) {}

    async execute(): Promise<void> {
        await this.taskService.assign(this.taskId, this.newUserId);
        console.log(`[Command] Usuario ${this.newUserId} asignado a tarea ${this.taskId}`);
    }

    async undo(): Promise<void> {
        if (this.previousUserId) {
            await this.taskService.assign(this.taskId, this.previousUserId);
            console.log(`[Undo] Revertido a usuario ${this.previousUserId}`);
        } else {
            await this.taskService.unassign(this.taskId);
            console.log(`[Undo] Asignación removida`);
        }
    }

    serialize(): SerializedCommand {
        return { type: AssignUserCommand.TYPE, taskId: this.taskId, newUserId: this.newUserId, previousUserId: this.previousUserId };
    }
}

export interface CommandHistoryStore {
    push(key: string, entry: SerializedCommand): Promise<void>;
    pop(key: string): Promise<SerializedCommand | null>;
}

export class HybridHistoryStore implements CommandHistoryStore {
    private static readonly memory = new Map<string, SerializedCommand[]>();
    private static readonly TTL_SECONDS = 24 * 60 * 60;

    private async load(key: string): Promise<SerializedCommand[]> {
        if (CacheUtil.isAvailable()) {
            return (await CacheUtil.get('CommandHistory', key)) ?? [];
        }
        return HybridHistoryStore.memory.get(key) ?? [];
    }

    private async save(key: string, list: SerializedCommand[]): Promise<void> {
        if (CacheUtil.isAvailable()) {
            await CacheUtil.set('CommandHistory', key, list, HybridHistoryStore.TTL_SECONDS);
        } else {
            HybridHistoryStore.memory.set(key, list);
        }
    }

    async push(key: string, entry: SerializedCommand): Promise<void> {
        const list = await this.load(key);
        list.push(entry);
        await this.save(key, list);
    }

    async pop(key: string): Promise<SerializedCommand | null> {
        const list = await this.load(key);
        const entry = list.pop() ?? null;
        await this.save(key, list);
        return entry;
    }
}

export class CommandManager {
    constructor(
        private readonly store: CommandHistoryStore,
        private readonly rebuild: (entry: SerializedCommand) => SerializableCommand
    ) {}

    async run(key: string, command: SerializableCommand): Promise<void> {
        await command.execute();
        await this.store.push(key, command.serialize());
    }

    async undoLast(key: string): Promise<boolean> {
        const entry = await this.store.pop(key);
        if (!entry) return false;
        await this.rebuild(entry).undo();
        return true;
    }
}

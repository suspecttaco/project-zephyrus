export interface SnapshotCapable {
    snapshot(): void;
    rollback(): void;
}

export class MemoryStore<T> implements SnapshotCapable {
    private entries = new Map<string, T>();
    private snapshotEntries: Map<string, T> | null = null;

    set(id: string, value: T): void {
        this.entries.set(id, value);
    }

    get(id: string): T | undefined {
        return this.entries.get(id);
    }

    remove(id: string): void {
        this.entries.delete(id);
    }

    values(): T[] {
        return [...this.entries.values()];
    }

    snapshot(): void {
        this.snapshotEntries = new Map(this.entries);
    }

    rollback(): void {
        if (this.snapshotEntries) {
            this.entries = this.snapshotEntries;
            this.snapshotEntries = null;
        }
    }
}

import type { Movement } from "../../domain/entities/movement.js";
import type { IMovementRepository } from "../../domain/repositories/movement-repository.js";
import { MemoryStore, type SnapshotCapable } from "./memory-store.js";

export class InMemoryMovementRepository implements IMovementRepository, SnapshotCapable {
    private readonly store = new MemoryStore<Movement>();

    findById(id: string): Promise<Movement | null> {
        return Promise.resolve(this.store.get(id) ?? null);
    }

    findByAccount(accountId: string): Promise<Movement[]> {
        return Promise.resolve(
            this.store
                .values()
                .filter((movement) => movement.accountId === accountId || movement.destinationAccountId === accountId),
        );
    }

    save(movement: Movement): Promise<void> {
        this.store.set(movement.id, movement);
        return Promise.resolve();
    }

    delete(id: string): Promise<void> {
        this.store.remove(id);
        return Promise.resolve();
    }

    snapshot(): void {
        this.store.snapshot();
    }

    rollback(): void {
        this.store.rollback();
    }
}

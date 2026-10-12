import type { Account } from "../../domain/entities/account.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";
import { MemoryStore, type SnapshotCapable } from "./memory-store.js";

export class InMemoryAccountRepository implements IAccountRepository, SnapshotCapable {
    private readonly store = new MemoryStore<Account>();

    findById(id: string): Promise<Account | null> {
        const account = this.store.get(id);
        return Promise.resolve(account ? account.clone() : null);
    }

    findByUser(userId: string): Promise<Account[]> {
        return Promise.resolve(
            this.store
                .values()
                .filter((account) => account.userId === userId)
                .map((account) => account.clone()),
        );
    }

    save(account: Account): Promise<void> {
        this.store.set(account.id, account);
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

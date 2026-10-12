import type { UnitOfWork } from "../../application/unit-of-work.js";
import type { SnapshotCapable } from "./memory-store.js";

export class MemoryUnitOfWork implements UnitOfWork {
    constructor(private readonly stores: SnapshotCapable[]) {}

    async run<T>(operation: () => Promise<T>): Promise<T> {
        for (const store of this.stores) {
            store.snapshot();
        }

        try {
            return await operation();
        } catch (error) {
            for (const store of this.stores) {
                store.rollback();
            }
            throw error;
        }
    }
}

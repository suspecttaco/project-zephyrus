import type { InstallmentPurchase } from "../../domain/entities/installment-purchase.js";
import type { IInstallmentPurchaseRepository } from "../../domain/repositories/installment-purchase-repository.js";
import { MemoryStore, type SnapshotCapable } from "./memory-store.js";

export class InMemoryInstallmentPurchaseRepository implements IInstallmentPurchaseRepository, SnapshotCapable {
    private readonly store = new MemoryStore<InstallmentPurchase>();

    findById(id: string): Promise<InstallmentPurchase | null> {
        const purchase = this.store.get(id);
        return Promise.resolve(purchase ? purchase.clone() : null);
    }

    findByAccount(accountId: string): Promise<InstallmentPurchase[]> {
        return Promise.resolve(
            this.store
                .values()
                .filter((purchase) => purchase.accountId === accountId)
                .map((purchase) => purchase.clone()),
        );
    }

    save(purchase: InstallmentPurchase): Promise<void> {
        this.store.set(purchase.id, purchase);
        return Promise.resolve();
    }

    snapshot(): void {
        this.store.snapshot();
    }

    rollback(): void {
        this.store.rollback();
    }
}

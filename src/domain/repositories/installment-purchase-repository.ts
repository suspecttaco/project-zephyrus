import type { InstallmentPurchase } from "../entities/installment-purchase.js";

export interface IInstallmentPurchaseRepository {
    findById(id: string): Promise<InstallmentPurchase | null>;
    findByAccount(accountId: string): Promise<InstallmentPurchase[]>;
    save(purchase: InstallmentPurchase): Promise<void>;
}

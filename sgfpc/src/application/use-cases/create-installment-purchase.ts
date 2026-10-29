import { randomUUID } from "node:crypto";
import { InstallmentPurchase } from "../../domain/entities/installment-purchase.js";
import type { IInstallmentPurchaseRepository } from "../../domain/repositories/installment-purchase-repository.js";

export class CreateInstallmentPurchase {
    constructor(private readonly installmentPurchaseRepository: IInstallmentPurchaseRepository) {}

    async execute(input: {
        accountId: string;
        description: string;
        totalAmountInCents: number;
        totalInstallments: number;
        monthlyPaymentInCents: number;
    }): Promise<InstallmentPurchase> {
        const purchase = InstallmentPurchase.create({
            id: randomUUID(),
            ...input,
        });
        await this.installmentPurchaseRepository.save(purchase);
        return purchase;
    }
}

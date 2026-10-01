import { NotFoundError } from "../../domain/errors.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";
import type { IInstallmentPurchaseRepository } from "../../domain/repositories/installment-purchase-repository.js";

export interface AccountSummary {
    accountId: string;
    name: string;
    type: string;
    balanceInCents: number;
    availableCreditInCents: number | null;
    cutOffDay: number | null;
    pendingInstallments: {
        purchaseId: string;
        description: string;
        remainingInstallments: number;
        remainingDebtInCents: number;
    }[];
}

export class GetAccountSummary {
    constructor(
        private readonly accountRepository: IAccountRepository,
        private readonly installmentPurchaseRepository: IInstallmentPurchaseRepository,
    ) {}

    async execute(accountId: string): Promise<AccountSummary> {
        const account = await this.accountRepository.findById(accountId);
        if (!account) throw new NotFoundError("account not found");

        const purchases = await this.installmentPurchaseRepository.findByAccount(accountId);
        const pendingInstallments = purchases
            .filter((p) => p.isActive)
            .map((p) => ({
                purchaseId: p.id,
                description: p.description,
                remainingInstallments: p.remainingInstallments,
                remainingDebtInCents: p.remainingDebt.amountInCents,
            }));

        return {
            accountId: account.id,
            name: account.name,
            type: account.type,
            balanceInCents: account.currentBalance.amountInCents,
            availableCreditInCents: account.availableCredit ? account.availableCredit.amountInCents : null,
            cutOffDay: account.cutOffDay,
            pendingInstallments,
        };
    }
}

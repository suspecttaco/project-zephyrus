import { BusinessConflictError, NotFoundError } from "../../domain/errors.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";
import type { IMovementRepository } from "../../domain/repositories/movement-repository.js";
import type { IInstallmentPurchaseRepository } from "../../domain/repositories/installment-purchase-repository.js";
import type { RequestContext } from "../request-context.js";

export class DeleteAccount {
    constructor(
        private readonly accountRepository: IAccountRepository,
        private readonly movementRepository: IMovementRepository,
        private readonly installmentPurchaseRepository: IInstallmentPurchaseRepository,
    ) {}

    async execute(input: { accountId: string; context: RequestContext }): Promise<void> {
        const account = await this.accountRepository.findById(input.accountId);
        if (account?.userId !== input.context.ownerUserId) {
            throw new NotFoundError("account not found");
        }

        const movements = await this.movementRepository.findByAccount(account.id);
        if (movements.length > 0) {
            throw new BusinessConflictError("account has movements as source or destination");
        }

        const purchases = await this.installmentPurchaseRepository.findByAccount(account.id);
        if (purchases.length > 0) {
            throw new BusinessConflictError("account has linked installment purchases");
        }

        if (!account.currentBalance.isZero()) {
            throw new BusinessConflictError("account balance or debt is not zero");
        }

        await this.accountRepository.delete(account.id);
    }
}

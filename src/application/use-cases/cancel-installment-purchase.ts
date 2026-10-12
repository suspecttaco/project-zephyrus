import type { InstallmentPurchase } from "../../domain/entities/installment-purchase.js";
import { MovementType } from "../../domain/enums.js";
import { BusinessConflictError, NotFoundError } from "../../domain/errors.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";
import type { IMovementRepository } from "../../domain/repositories/movement-repository.js";
import type { IInstallmentPurchaseRepository } from "../../domain/repositories/installment-purchase-repository.js";
import type { RequestContext } from "../request-context.js";

export class CancelInstallmentPurchase {
    constructor(
        private readonly installmentPurchaseRepository: IInstallmentPurchaseRepository,
        private readonly movementRepository: IMovementRepository,
        private readonly accountRepository: IAccountRepository,
    ) {}

    async execute(input: { purchaseId: string; context: RequestContext }): Promise<InstallmentPurchase> {
        const purchase = await this.installmentPurchaseRepository.findById(input.purchaseId);
        if (!purchase) {
            throw new NotFoundError("installment purchase not found");
        }

        const account = await this.accountRepository.findById(purchase.accountId);
        if (account?.userId !== input.context.ownerUserId) {
            throw new NotFoundError("account not found");
        }

        if (!purchase.isActive) {
            throw new BusinessConflictError("purchase is already cancelled");
        }

        // Copias de trabajo: nada se almacena hasta la confirmación conjunta.
        const workingPurchase = purchase.clone();
        const workingAccount = account.clone();

        // Reversión financiera de las mensualidades pagadas/adelantadas.
        const settledInstallments = purchase.paidInstallments + purchase.advancedInstallments;
        if (settledInstallments > 0) {
            const settledEffect = purchase.monthlyPayment.multiply(settledInstallments);
            workingAccount.applyMovement(MovementType.INCOME, settledEffect);
        }

        // Desactiva conservando el registro y el historial de mensualidades.
        workingPurchase.cancel();

        // Elimina los movimientos generados por la compra.
        const accountMovements = await this.movementRepository.findByAccount(purchase.accountId);
        const generated = accountMovements.filter((movement) => movement.installmentPurchaseId === purchase.id);
        for (const movement of generated) {
            await this.movementRepository.delete(movement.id);
        }

        await this.accountRepository.save(workingAccount);
        await this.installmentPurchaseRepository.save(workingPurchase);

        return workingPurchase;
    }
}

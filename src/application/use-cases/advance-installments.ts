import { randomUUID } from "node:crypto";
import { Movement } from "../../domain/entities/movement.js";
import { MovementType } from "../../domain/enums.js";
import { NotFoundError } from "../../domain/errors.js";
import type { IInstallmentPurchaseRepository } from "../../domain/repositories/installment-purchase-repository.js";
import type { IMovementRepository } from "../../domain/repositories/movement-repository.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";

export class AdvanceInstallments {
    constructor(
        private readonly installmentPurchaseRepository: IInstallmentPurchaseRepository,
        private readonly movementRepository: IMovementRepository,
        private readonly accountRepository: IAccountRepository,
    ) {}

    async execute(input: { purchaseId: string; count: number }): Promise<Movement> {
        const purchase = await this.installmentPurchaseRepository.findById(input.purchaseId);
        if (!purchase) throw new NotFoundError("installment purchase not found");

        const account = await this.accountRepository.findById(purchase.accountId);
        if (!account) throw new NotFoundError("account not found");

        purchase.assertCanAdvance(input.count);

        const movement = Movement.create({
            id: randomUUID(),
            accountId: purchase.accountId,
            type: MovementType.EXPENSE,
            amountInCents: purchase.monthlyPayment.multiply(input.count).amountInCents,
            description: `Advance of ${String(input.count)} installment(s): ${purchase.description}`,
        });

        account.applyMovement(MovementType.EXPENSE, movement.amount);
        purchase.advanceInstallments(input.count);

        await this.movementRepository.save(movement);
        await this.accountRepository.save(account);
        await this.installmentPurchaseRepository.save(purchase);

        return movement;
    }
}
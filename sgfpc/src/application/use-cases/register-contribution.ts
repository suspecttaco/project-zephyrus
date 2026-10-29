import { randomUUID } from "node:crypto";
import { Movement } from "../../domain/entities/movement.js";
import { MovementType } from "../../domain/enums.js";
import { NotFoundError } from "../../domain/errors.js";
import type { IInvestmentRepository } from "../../domain/repositories/investment-repository.js";
import type { IMovementRepository } from "../../domain/repositories/movement-repository.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";

export class RegisterContribution {
    constructor(
        private readonly investmentRepository: IInvestmentRepository,
        private readonly movementRepository: IMovementRepository,
        private readonly accountRepository: IAccountRepository,
    ) {}

    async execute(input: {
        investmentId: string;
        userId: string;
        accountId: string;
        amountInCents: number;
    }): Promise<Movement> {
        const investment = await this.investmentRepository.findById(input.investmentId);
        if (!investment) throw new NotFoundError("investment not found");

        investment.registerContribution(input.userId, input.amountInCents);

        const account = await this.accountRepository.findById(input.accountId);
        if (!account) throw new NotFoundError("account not found");

        const movement = Movement.create({
            id: randomUUID(),
            accountId: input.accountId,
            type: MovementType.EXPENSE,
            amountInCents: input.amountInCents,
            description: `Investment contribution: ${investment.name}`,
        });

        account.applyMovement(MovementType.EXPENSE, movement.amount);

        await this.movementRepository.save(movement);
        await this.accountRepository.save(account);
        await this.investmentRepository.save(investment);

        return movement;
    }
}

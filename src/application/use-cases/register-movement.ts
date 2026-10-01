import { randomUUID } from "node:crypto";
import { Movement } from "../../domain/entities/movement.js";
import { NotFoundError } from "../../domain/errors.js";
import type { MovementType, MovementCategory } from "../../domain/enums.js";
import type { IMovementRepository } from "../../domain/repositories/movement-repository.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";

export class RegisterMovement {
    constructor(
        private readonly movementRepository: IMovementRepository,
        private readonly accountRepository: IAccountRepository,
    ) {}

    async execute(input: {
        accountId: string; type: MovementType; amountInCents: number;
        category?: MovementCategory; description: string;
    }): Promise<Movement> {
        const account = await this.accountRepository.findById(input.accountId);
        if (!account) throw new NotFoundError("account not found");

        const movement = Movement.create({ id: randomUUID(), ...input });
        account.applyMovement(movement.type, movement.amount);

        await this.movementRepository.save(movement);
        await this.accountRepository.save(account);

        return movement;
    }
}
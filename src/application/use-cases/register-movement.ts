import { randomUUID } from "node:crypto";
import { Movement } from "../../domain/entities/movement.js";
import { InvalidTransferError, NotFoundError } from "../../domain/errors.js";
import { MovementType } from "../../domain/enums.js";
import type { MovementCategory } from "../../domain/enums.js";
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
        destinationAccountId?: string; // obligatorio solo si type = TRANSFER
    }): Promise<Movement> {
        const account = await this.accountRepository.findById(input.accountId);
        if (!account) throw new NotFoundError("account not found");

        const movement = Movement.create({ id: randomUUID(), ...input });

        if (movement.type !== MovementType.TRANSFER || movement.destinationAccountId === null) {
            account.applyMovement(movement.type, movement.amount);

            await this.movementRepository.save(movement);
            await this.accountRepository.save(account);

            return movement;
        }

        const destination = await this.accountRepository.findById(movement.destinationAccountId);
        if (!destination) throw new NotFoundError("destination account not found");
        if (destination.userId !== account.userId) {
            throw new InvalidTransferError("transfers are only allowed between accounts of the same user");
        }

        // Primero el origen: es el único lado que puede fallar (saldo insuficiente o límite excedido)
        account.transferOut(movement.amount);
        destination.transferIn(movement.amount);

        await this.movementRepository.save(movement);
        await this.accountRepository.save(account);
        await this.accountRepository.save(destination);

        return movement;
    }
}
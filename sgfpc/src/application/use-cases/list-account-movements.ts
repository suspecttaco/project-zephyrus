import type { Movement } from "../../domain/entities/movement.js";
import { NotFoundError } from "../../domain/errors.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";
import type { IMovementRepository } from "../../domain/repositories/movement-repository.js";
import type { RequestContext } from "../request-context.js";

export class ListAccountMovements {
    constructor(
        private readonly movementRepository: IMovementRepository,
        private readonly accountRepository: IAccountRepository,
    ) {}

    async execute(input: { accountId: string; context: RequestContext }): Promise<Movement[]> {
        const account = await this.accountRepository.findById(input.accountId);
        if (account?.userId !== input.context.ownerUserId) {
            throw new NotFoundError("account not found");
        }
        return this.movementRepository.findByAccount(account.id);
    }
}

export class GetMovement {
    constructor(
        private readonly movementRepository: IMovementRepository,
        private readonly accountRepository: IAccountRepository,
    ) {}

    async execute(input: { accountId: string; movementId: string; context: RequestContext }): Promise<Movement> {
        const account = await this.accountRepository.findById(input.accountId);
        if (account?.userId !== input.context.ownerUserId) {
            throw new NotFoundError("account not found");
        }

        const movement = await this.movementRepository.findById(input.movementId);
        if (!movement) {
            throw new NotFoundError("movement not found");
        }

        const belongsToAccount =
            movement.accountId === input.accountId || movement.destinationAccountId === input.accountId;
        if (!belongsToAccount) {
            throw new NotFoundError("movement not found in this account");
        }

        return movement;
    }
}

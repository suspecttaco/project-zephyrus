import type { Account } from "../../domain/entities/account.js";
import type { AccountType } from "../../domain/enums.js";
import { BusinessConflictError, NotFoundError } from "../../domain/errors.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";
import type { RequestContext } from "../request-context.js";

export interface AccountChanges {
    name: string;
    creditLimitInCents?: number | null;
    cutOffDay?: number | null;
}

export class UpdateAccount {
    constructor(private readonly accountRepository: IAccountRepository) {}

    async execute(input: {
        accountId: string;
        context: RequestContext;
        changes: AccountChanges;
        requestedType?: AccountType;
    }): Promise<Account> {
        const account = await this.accountRepository.findById(input.accountId);
        if (account?.userId !== input.context.ownerUserId) {
            throw new NotFoundError("account not found");
        }

        if (input.requestedType !== undefined && input.requestedType !== account.type) {
            throw new BusinessConflictError("account type is immutable");
        }

        const updated = account.update(input.changes);
        await this.accountRepository.save(updated);
        return updated;
    }
}

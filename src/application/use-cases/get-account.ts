import type { Account } from "../../domain/entities/account.js";
import { NotFoundError } from "../../domain/errors.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";
import type { RequestContext } from "../request-context.js";

export class GetAccount {
    constructor(private readonly accountRepository: IAccountRepository) {}

    async execute(input: { accountId: string; context: RequestContext }): Promise<Account> {
        const account = await this.accountRepository.findById(input.accountId);
        if (account?.userId !== input.context.ownerUserId) {
            throw new NotFoundError("account not found");
        }
        return account;
    }
}

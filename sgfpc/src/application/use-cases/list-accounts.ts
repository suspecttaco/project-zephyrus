import type { Account } from "../../domain/entities/account.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";
import type { RequestContext } from "../request-context.js";

export class ListAccounts {
    constructor(private readonly accountRepository: IAccountRepository) {}

    async execute(context: RequestContext): Promise<Account[]> {
        return this.accountRepository.findByUser(context.ownerUserId);
    }
}

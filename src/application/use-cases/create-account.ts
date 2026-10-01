import { randomUUID } from "node:crypto";
import { Account } from "../../domain/entities/account.js";
import type { AccountType } from "../../domain/enums.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";

export class CreateAccount {
    constructor(private readonly accountRepository: IAccountRepository) {}

    async execute(input: {
        userId: string; name: string; type: AccountType; creditLimitInCents?: number; cutOffDay?: number;
    }): Promise<Account> {
        const account = Account.create({ id: randomUUID(), ...input });
        await this.accountRepository.save(account);
        return account;
    }
}
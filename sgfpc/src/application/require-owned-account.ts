import type { Account } from "../domain/entities/account.js";
import { NotFoundError } from "../domain/errors.js";
import type { IAccountRepository } from "../domain/repositories/account-repository.js";

export async function requireOwnedAccount(
    accountRepository: IAccountRepository,
    accountId: string,
    ownerUserId: string,
): Promise<Account> {
    const account = await accountRepository.findById(accountId);
    if (account?.userId !== ownerUserId) {
        throw new NotFoundError("account not found");
    }
    return account;
}

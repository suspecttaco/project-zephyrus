import type { Account } from "../entities/account.js";

export interface IAccountRepository {
    findById(id: string): Promise<Account | null>;
    findByUser(userId: string): Promise<Account[]>;
    save(account: Account): Promise<void>;
}

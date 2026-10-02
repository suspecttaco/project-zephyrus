import type { SharedExpense } from "../entities/shared-expense.js";

export interface ISharedExpenseRepository {
    findByGroup(groupId: string): Promise<SharedExpense[]>;
    save(expense: SharedExpense): Promise<void>;
}

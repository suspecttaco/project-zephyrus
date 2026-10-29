import type { Budget } from "../entities/budget.js";

export interface IBudgetRepository {
    findByGroup(groupId: string): Promise<Budget[]>;
    save(budget: Budget): Promise<void>;
}

import { randomUUID } from "node:crypto";
import { Budget } from "../../domain/entities/budget.js";
import type { MovementCategory } from "../../domain/enums.js";
import type { IBudgetRepository } from "../../domain/repositories/budget-repository.js";

export class CreateBudget {
    constructor(private readonly budgetRepository: IBudgetRepository) {}

    async execute(input: {
        groupId?: string | null;
        userId?: string | null;
        category: MovementCategory;
        limitAmountInCents: number;
        periodStart: Date;
        periodEnd: Date;
    }): Promise<Budget> {
        const budget = Budget.create({
            id: randomUUID(),
            ...input,
        });
        await this.budgetRepository.save(budget);
        return budget;
    }
}

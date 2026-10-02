import { randomUUID } from "node:crypto";
import { SharedExpense } from "../../domain/entities/shared-expense.js";
import type { ISharedExpenseRepository } from "../../domain/repositories/shared-expense-repository.js";

export class CreateSharedExpense {
    constructor(private readonly sharedExpenseRepository: ISharedExpenseRepository) {}

    async execute(input: {
        groupId: string;
        paidBy: string;
        amountInCents: number;
        description: string;
        split: { userId: string; assignedAmountInCents: number }[];
    }): Promise<SharedExpense> {
        const expense = SharedExpense.create({ id: randomUUID(), ...input });
        await this.sharedExpenseRepository.save(expense);
        return expense;
    }
}

import type { IMovementRepository } from "../../domain/repositories/movement-repository.js";
import type { IAccountRepository } from "../../domain/repositories/account-repository.js";
import type { ISharedExpenseRepository } from "../../domain/repositories/shared-expense-repository.js";
import type { MovementCategory } from "../../domain/enums.js";

export interface MonthlyReport {
    month: string;
    totalIncomeInCents: number;
    totalExpensesInCents: number;
    byCategory: Record<string, number>;
    byAccount: Record<string, { accountId: string; name: string; totalInCents: number }>;
    byPerson: Record<string, { userId: string; paidInCents: number; owedInCents: number }>;
}

export class GenerateMonthlyReport {
    constructor(
        private readonly movementRepository: IMovementRepository,
        private readonly accountRepository: IAccountRepository,
        private readonly sharedExpenseRepository: ISharedExpenseRepository,
    ) {}

    async execute(input: {
        userId: string;
        groupId?: string;
        month: string; // YYYY-MM
    }): Promise<MonthlyReport> {
        const [year, monthNum] = input.month.split("-").map(Number);
        const startDate = new Date(year, monthNum - 1, 1);
        const endDate = new Date(year, monthNum, 0, 23, 59, 59);

        const accounts = await this.accountRepository.findByUser(input.userId);
        const accountIds = accounts.map((a) => a.id);

        const movements = await Promise.all(
            accountIds.map((id) => this.movementRepository.findByAccount(id)),
        );
        const allMovements = movements.flat().filter(
            (m) => m.date >= startDate && m.date <= endDate,
        );

        let totalIncomeInCents = 0;
        let totalExpensesInCents = 0;
        const byCategory: Record<string, number> = {};
        const byAccount: Record<string, { accountId: string; name: string; totalInCents: number }> = {};

        for (const m of allMovements) {
            if (m.type === "INCOME") {
                totalIncomeInCents += m.amount.amountInCents;
            } else {
                totalExpensesInCents += m.amount.amountInCents;
            }

            const cat = m.category ?? "OTHER";
            byCategory[cat] = (byCategory[cat] ?? 0) + m.amount.amountInCents;

            const account = accounts.find((a) => a.id === m.accountId);
            if (account) {
                if (!byAccount[account.id]) {
                    byAccount[account.id] = { accountId: account.id, name: account.name, totalInCents: 0 };
                }
                byAccount[account.id].totalInCents += m.amount.amountInCents;
            }
        }

        const byPerson: Record<string, { userId: string; paidInCents: number; owedInCents: number }> = {};

        if (input.groupId) {
            const expenses = await this.sharedExpenseRepository.findByGroup(input.groupId);
            const filteredExpenses = expenses.filter(
                (e) => e.date >= startDate && e.date <= endDate,
            );

            for (const e of filteredExpenses) {
                if (!byPerson[e.paidBy]) {
                    byPerson[e.paidBy] = { userId: e.paidBy, paidInCents: 0, owedInCents: 0 };
                }
                byPerson[e.paidBy].paidInCents += e.amount.amountInCents;

                for (const split of e.split) {
                    if (!byPerson[split.userId]) {
                        byPerson[split.userId] = { userId: split.userId, paidInCents: 0, owedInCents: 0 };
                    }
                    byPerson[split.userId].owedInCents += split.assignedAmount.amountInCents;
                }
            }
        }

        return {
            month: input.month,
            totalIncomeInCents,
            totalExpensesInCents,
            byCategory,
            byAccount,
            byPerson,
        };
    }
}

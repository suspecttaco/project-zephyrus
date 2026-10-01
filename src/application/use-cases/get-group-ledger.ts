import type { ISharedExpenseRepository } from "../../domain/repositories/shared-expense-repository.js";
import type { ILoanRepository } from "../../domain/repositories/loan-repository.js";

export interface GroupLedgerEntry {
    type: "expense" | "loan";
    id: string;
    description: string;
    amountInCents: number;
    date: Date;
    involvedUserIds: string[];
}

export class GetGroupLedger {
    constructor(
        private readonly sharedExpenseRepository: ISharedExpenseRepository,
        private readonly loanRepository: ILoanRepository,
    ) {}

    async execute(groupId: string): Promise<GroupLedgerEntry[]> {
        const [expenses, loans] = await Promise.all([
            this.sharedExpenseRepository.findByGroup(groupId),
            this.loanRepository.findByGroup(groupId),
        ]);

        const expenseEntries: GroupLedgerEntry[] = expenses.map((e) => ({
            type: "expense",
            id: e.id,
            description: e.description,
            amountInCents: e.amount.amountInCents,
            date: e.date,
            involvedUserIds: [e.paidBy, ...e.split.map((s) => s.userId)],
        }));

        const loanEntries: GroupLedgerEntry[] = loans.map((l) => ({
            type: "loan",
            id: l.id,
            description: l.description,
            amountInCents: l.loanedAmount.amountInCents,
            date: l.date,
            involvedUserIds: [l.lenderId, l.borrowerId],
        }));

        return [...expenseEntries, ...loanEntries].sort(
            (a, b) => b.date.getTime() - a.date.getTime(),
        );
    }
}

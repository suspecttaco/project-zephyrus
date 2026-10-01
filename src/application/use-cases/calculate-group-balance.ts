import type { ISharedExpenseRepository } from "../../domain/repositories/shared-expense-repository.js";
import type { ILoanRepository } from "../../domain/repositories/loan-repository.js";
import { simplifyDebts, type PersonNet, type SimplifiedPayment } from "./simplify-debts.js";

export class CalculateGroupBalance {
    constructor(
        private readonly sharedExpenseRepository: ISharedExpenseRepository,
        private readonly loanRepository: ILoanRepository,
    ) {}

    async execute(groupId: string): Promise<{ nets: PersonNet[]; payments: SimplifiedPayment[] }> {
        const expenses = await this.sharedExpenseRepository.findByGroup(groupId);
        const loans = await this.loanRepository.findByGroup(groupId);

        const netByUser = new Map<string, number>();
        const addNet = (userId: string, deltaCents: number) => {
            netByUser.set(userId, (netByUser.get(userId) ?? 0) + deltaCents);
        };

        for (const expense of expenses) {
            addNet(expense.paidBy, expense.amount.amountInCents);
            for (const entry of expense.split) {
                addNet(entry.userId, -entry.assignedAmount.amountInCents);
            }
        }

        for (const loan of loans) {
            addNet(loan.lenderId, loan.remainingBalance.amountInCents);
            addNet(loan.borrowerId, -loan.remainingBalance.amountInCents);
        }

        const nets: PersonNet[] = Array.from(netByUser.entries()).map(([userId, net]) => ({ userId, net }));
        const payments = simplifyDebts(nets);

        return { nets, payments };
    }
}
import { Money } from "../value-objects/money.js";
import { InvalidSharedExpenseError, ExpenseSplitMismatchError } from "../errors.js";

export interface ExpenseSplitEntry {
    userId: string;
    assignedAmount: Money;
}

export class SharedExpense {
    readonly id: string;
    readonly groupId: string;
    readonly paidBy: string;
    readonly amount: Money;
    readonly description: string;
    readonly split: ExpenseSplitEntry[];
    readonly date: Date;

    private constructor(props: {
        id: string;
        groupId: string;
        paidBy: string;
        amount: Money;
        description: string;
        split: ExpenseSplitEntry[];
        date: Date;
    }) {
        this.id = props.id;
        this.groupId = props.groupId;
        this.paidBy = props.paidBy;
        this.amount = props.amount;
        this.description = props.description;
        this.split = props.split;
        this.date = props.date;
    }

    static create(props: {
        id: string;
        groupId: string;
        paidBy: string;
        amountInCents: number;
        description: string;
        split: { userId: string; assignedAmountInCents: number }[];
    }): SharedExpense {
        const amount = Money.fromCents(props.amountInCents);

        if (amount.isNegative() || amount.isZero()) {
            throw new InvalidSharedExpenseError("expense amount must be greater than zero");
        }

        if (props.split.length === 0) {
            throw new InvalidSharedExpenseError("expense must be split among at least one member");
        }

        if (props.split.some((s) => s.assignedAmountInCents < 0)) {
            throw new InvalidSharedExpenseError("assigned amounts cannot be negative");
        }

        const userIds = props.split.map((s) => s.userId);
        if (new Set(userIds).size !== userIds.length) {
            throw new InvalidSharedExpenseError("a member cannot appear twice in a split");
        }

        const split = props.split.map((s) => ({
            userId: s.userId,
            assignedAmount: Money.fromCents(s.assignedAmountInCents),
        }));

        const splitTotal = split.reduce((sum, s) => sum.add(s.assignedAmount), Money.zero());
        if (!splitTotal.equals(amount)) {
            throw new ExpenseSplitMismatchError(
                `split total (${splitTotal.toString()}) does not match expense amount (${amount.toString()})`,
            );
        }

        return new SharedExpense({
            id: props.id,
            groupId: props.groupId,
            paidBy: props.paidBy,
            amount,
            description: props.description,
            split,
            date: new Date(),
        });
    }
}

import { Money } from "../value-objects/money.js";
import { MovementCategory } from "../enums.js";
import { InvalidBudgetPeriodError } from "../errors.js";

export class Budget {
    readonly id: string;
    readonly groupId: string | null;
    readonly userId: string | null;
    readonly category: MovementCategory;
    readonly limitAmount: Money;
    readonly periodStart: Date;
    readonly periodEnd: Date;
    readonly createdAt: Date;

    private constructor(props: {
        id: string; groupId: string | null; userId: string | null; category: MovementCategory;
        limitAmount: Money; periodStart: Date; periodEnd: Date; createdAt: Date;
    }) {
        this.id = props.id;
        this.groupId = props.groupId;
        this.userId = props.userId;
        this.category = props.category;
        this.limitAmount = props.limitAmount;
        this.periodStart = props.periodStart;
        this.periodEnd = props.periodEnd;
        this.createdAt = props.createdAt;
    }

    static create(props: {
        id: string; groupId?: string | null; userId?: string | null; category: MovementCategory;
        limitAmountInCents: number; periodStart: Date; periodEnd: Date;
    }): Budget {
        if (props.periodEnd <= props.periodStart) {
            throw new InvalidBudgetPeriodError("periodEnd must be after periodStart");
        }
        if (props.limitAmountInCents <= 0) {
            throw new InvalidBudgetPeriodError("limitAmount must be greater than zero");
        }
        return new Budget({
            id: props.id, groupId: props.groupId ?? null, userId: props.userId ?? null,
            category: props.category, limitAmount: Money.fromCents(props.limitAmountInCents),
            periodStart: props.periodStart, periodEnd: props.periodEnd, createdAt: new Date(),
        });
    }
}
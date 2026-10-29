import { Money } from "../value-objects/money.js";
import { InvestmentStatus } from "../enums.js";
import { DomainValidationError } from "../errors.js";

export interface InvestmentContribution {
    userId: string;
    amount: Money;
    date: Date;
}

export class Investment {
    readonly id: string;
    readonly groupId: string;
    readonly name: string;
    private invested: Money;
    private readonly contributions: InvestmentContribution[];
    readonly expectedReturn: number | null;
    private status: InvestmentStatus;
    readonly date: Date;

    private constructor(props: {
        id: string;
        groupId: string;
        name: string;
        invested: Money;
        contributions: InvestmentContribution[];
        expectedReturn: number | null;
        status: InvestmentStatus;
        date: Date;
    }) {
        this.id = props.id;
        this.groupId = props.groupId;
        this.name = props.name;
        this.invested = props.invested;
        this.contributions = props.contributions;
        this.expectedReturn = props.expectedReturn;
        this.status = props.status;
        this.date = props.date;
    }

    static create(props: { id: string; groupId: string; name: string; expectedReturn?: number | null }): Investment {
        return new Investment({
            id: props.id,
            groupId: props.groupId,
            name: props.name,
            invested: Money.zero(),
            contributions: [],
            expectedReturn: props.expectedReturn ?? null,
            status: InvestmentStatus.ACTIVE,
            date: new Date(),
        });
    }

    get investedAmount(): Money {
        return this.invested;
    }

    get currentStatus(): InvestmentStatus {
        return this.status;
    }

    registerContribution(userId: string, amountInCents: number): void {
        if (amountInCents <= 0) throw new DomainValidationError("contribution amount must be greater than zero");
        const amount = Money.fromCents(amountInCents);
        this.contributions.push({ userId, amount, date: new Date() });
        this.invested = this.invested.add(amount);
    }

    liquidate(): void {
        this.status = InvestmentStatus.LIQUIDATED;
    }
}

import { Money } from "../value-objects/money.js";
import { LoanStatus } from "../enums.js";
import { InvalidLoanError } from "../errors.js";

export class Loan {
    readonly id: string;
    readonly groupId: string;
    readonly lenderId: string;
    readonly borrowerId: string;
    readonly loanedAmount: Money;
    private remaining: Money;
    readonly description: string;
    readonly date: Date;
    private status: LoanStatus;

    private constructor(props: {
        id: string;
        groupId: string;
        lenderId: string;
        borrowerId: string;
        loanedAmount: Money;
        remaining: Money;
        description: string;
        date: Date;
        status: LoanStatus;
    }) {
        this.id = props.id;
        this.groupId = props.groupId;
        this.lenderId = props.lenderId;
        this.borrowerId = props.borrowerId;
        this.loanedAmount = props.loanedAmount;
        this.remaining = props.remaining;
        this.description = props.description;
        this.date = props.date;
        this.status = props.status;
    }

    static create(props: {
        id: string;
        groupId: string;
        lenderId: string;
        borrowerId: string;
        loanedAmountInCents: number;
        description: string;
    }): Loan {
        if (props.lenderId === props.borrowerId) {
            throw new InvalidLoanError("lender and borrower must be different users");
        }

        const amount = Money.fromCents(props.loanedAmountInCents);
        if (amount.isNegative() || amount.isZero()) {
            throw new InvalidLoanError("loanedAmount must be greater than zero");
        }
        return new Loan({
            id: props.id,
            groupId: props.groupId,
            lenderId: props.lenderId,
            borrowerId: props.borrowerId,
            loanedAmount: amount,
            remaining: amount,
            description: props.description,
            date: new Date(),
            status: LoanStatus.ACTIVE,
        });
    }

    get remainingBalance(): Money {
        return this.remaining;
    }

    get currentStatus(): LoanStatus {
        return this.status;
    }

    settle(): void {
        if (this.status == LoanStatus.PAID) {
            throw new InvalidLoanError("loan is already settled");
        }
        this.remaining = Money.zero();
        this.status = LoanStatus.PAID;
    }
}

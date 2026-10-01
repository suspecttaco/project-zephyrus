import {Money} from "../value-objects/money.js";
import {AccountType, MovementType} from "../enums.js";
import {CreditLimitExceededError, NegativeBalanceError} from "../errors.js";

export class Account {
    readonly id: string;
    readonly userId: string;
    readonly name: string;
    readonly type: AccountType;
    private balance: Money;
    readonly creditLimit: Money | null;
    readonly cutOffDay: number | null;
    readonly createdAt: Date;

    private constructor(props: {
        id: string;
        userId: string;
        name: string;
        type: AccountType;
        balance: Money;
        creditLimit: Money | null;
        cutOffDay: number | null;
        createdAt: Date;
    }) {
        this.id = props.id;
        this.userId = props.userId;
        this.name = props.name;
        this.type = props.type;
        this.balance = props.balance;
        this.creditLimit = props.creditLimit;
        this.cutOffDay = props.cutOffDay;
        this.createdAt = props.createdAt;
        this.validateInvariants();
    }

    static create(props: {
        id: string;
        userId: string;
        name: string;
        type: AccountType;
        creditLimitInCents?: number | null;
        cutOffDay?: number | null;
    }): Account {
        if (props.type === AccountType.CREDIT && (!props.creditLimitInCents || props.creditLimitInCents <= 0)) {
            throw new Error("credit accounts require a positive creditLimit");
        }

        return new Account({
            id: props.id,
            userId: props.userId,
            name: props.name,
            type: props.type,
            balance: Money.zero(),
            creditLimit: props.creditLimitInCents ? Money.fromCents(props.creditLimitInCents) : null,
            cutOffDay: props.cutOffDay ?? null,
            createdAt: new Date(),
        });
    }

    get currentBalance(): Money {
        return this.balance;
    }

    get availableCredit(): Money | null {
        if (this.type !== AccountType.CREDIT || !this.creditLimit) return null;
        return this.creditLimit.substract(this.balance);
    }

    applyMovement(type: MovementType, amount: Money): void {
        const isCredit = this.type === AccountType.CREDIT;

        if (type === MovementType.EXPENSE) {
            this.balance = isCredit ? this.balance.add(amount) : this.balance.substract(amount);
        } else if (type === MovementType.INCOME) {
            this.balance = isCredit ? this.balance.substract(amount) : this.balance.add(amount);
        }

        this.validateInvariants();
    }

    private validateInvariants(): void {
        if (this.type !== AccountType.CREDIT && this.balance.isNegative()) {
            throw new NegativeBalanceError(`account ${this.id} cannot have a negative balance`);
        }

        if (this.type === AccountType.CREDIT && this.creditLimit &&  this.balance.isGreaterThan(this.creditLimit)) {
            throw new CreditLimitExceededError(`account ${this.id} exceeds its credit limit`);
        }
    }
}
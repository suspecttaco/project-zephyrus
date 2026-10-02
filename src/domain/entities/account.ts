import {Money} from "../value-objects/money.js";
import {AccountType, MovementType} from "../enums.js";
import {DomainValidationError, CreditLimitExceededError, InvalidTransferError, NegativeBalanceError} from "../errors.js";

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
        this.assertValidBalance(props.balance);
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
            throw new DomainValidationError("credit accounts require a positive creditLimit");
        }

        if (props.type !== AccountType.CREDIT && props.creditLimitInCents) {
            throw new DomainValidationError("only credit accounts can have a creditLimit");
        }

        if (props.cutOffDay != null && (!Number.isInteger(props.cutOffDay) || props.cutOffDay < 1 || props.cutOffDay > 31)) {
            throw new DomainValidationError("cutOffDay must be an integer between 1 and 31");
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
        return this.creditLimit.subtract(this.balance);
    }

    applyMovement(type: MovementType, amount: Money): void {
        switch (type) {
            case MovementType.EXPENSE:
                this.withdraw(amount);
                break;
            case MovementType.INCOME:
                this.deposit(amount);
                break;
            case MovementType.TRANSFER:
                throw new InvalidTransferError("a transfer needs a direction: use transferOut or transferIn");
        }
    }

    transferOut(amount: Money): void {
        this.withdraw(amount);
    }

    transferIn(amount: Money): void {
        this.deposit(amount);
    }

    private withdraw(amount: Money): void {
        this.setBalance(this.type === AccountType.CREDIT ? this.balance.add(amount) : this.balance.subtract(amount));
    }

    private deposit(amount: Money): void {
        this.setBalance(this.type === AccountType.CREDIT ? this.balance.subtract(amount) : this.balance.add(amount));
    }

    private setBalance(next: Money): void {
        this.assertValidBalance(next);
        this.balance = next;
    }

    private assertValidBalance(balance: Money): void {
        if (this.type !== AccountType.CREDIT && balance.isNegative()) {
            throw new NegativeBalanceError(`account ${this.id} cannot have a negative balance`);
        }

        if (this.type === AccountType.CREDIT && this.creditLimit && balance.isGreaterThan(this.creditLimit)) {
            throw new CreditLimitExceededError(`account ${this.id} exceeds its credit limit`);
        }
    }
}
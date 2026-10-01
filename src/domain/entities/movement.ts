import { Money } from "../value-objects/money.js";
import { MovementType, MovementCategory } from "../enums.js";
import { DomainValidationError, InvalidMovementAmountError } from "../errors.js";

export class Movement {
    readonly id: string;
    readonly accountId: string;
    readonly type: MovementType;
    readonly amount: Money;
    readonly category: MovementCategory | null;
    readonly description: string;
    readonly date: Date;
    readonly createdAt: Date;

    private constructor(props: {
        id: string,
        accountId: string;
        type: MovementType;
        amount: Money;
        category: MovementCategory | null;
        description: string;
        date: Date;
        createdAt: Date;
    }) {
        this.id = props.id;
        this.accountId = props.accountId;
        this.type = props.type;
        this.amount = props.amount;
        this.category = props.category;
        this.description = props.description;
        this.date = props.date;
        this.createdAt = props.createdAt;
    }

    static create(props: {
        id: string;
        accountId: string;
        type: MovementType;
        amountInCents: number;
        category?: MovementCategory | null;
        description: string;
        date?: Date;
    }): Movement {
        if (props.amountInCents <= 0) {
            throw new InvalidMovementAmountError("movement amount must be greater than zero");
        }

        if (props.category != null && !Object.values(MovementCategory).includes(props.category)) {
            throw new DomainValidationError(`invalid movement category ${props.category}`);
        }

        return new Movement({
            id: props.id,
            accountId: props.accountId,
            type: props.type,
            amount: Money.fromCents(props.amountInCents),
            category: props.category ?? null,
            description: props.description,
            date: props.date ?? new Date(),
            createdAt: new Date(),
        });
    }
}
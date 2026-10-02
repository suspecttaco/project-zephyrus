import { Money } from "../value-objects/money.js";
import { MovementCategory, MovementType } from "../enums.js";
import { DomainValidationError, InvalidMovementAmountError, InvalidTransferError } from "../errors.js";

export class Movement {
    readonly id: string;
    readonly accountId: string;
    readonly destinationAccountId: string | null; // solo TRANSFER: cuenta que recibe el dinero
    readonly type: MovementType;
    readonly amount: Money;
    readonly category: MovementCategory | null;
    readonly description: string;
    readonly date: Date;
    readonly createdAt: Date;

    private constructor(props: {
        id: string;
        accountId: string;
        destinationAccountId: string | null;
        type: MovementType;
        amount: Money;
        category: MovementCategory | null;
        description: string;
        date: Date;
        createdAt: Date;
    }) {
        this.id = props.id;
        this.accountId = props.accountId;
        this.destinationAccountId = props.destinationAccountId;
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
        destinationAccountId?: string | null;
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

        const destinationAccountId = props.destinationAccountId ?? null;
        if (props.type === MovementType.TRANSFER) {
            if (destinationAccountId === null) {
                throw new InvalidTransferError("a transfer requires a destination account");
            }
            if (destinationAccountId === props.accountId) {
                throw new InvalidTransferError("source and destination accounts must be different");
            }
            if (props.category != null) {
                throw new InvalidTransferError("a transfer cannot have a category");
            }
        } else if (destinationAccountId !== null) {
            throw new InvalidTransferError("only transfers can have a destination account");
        }

        return new Movement({
            id: props.id,
            accountId: props.accountId,
            destinationAccountId,
            type: props.type,
            amount: Money.fromCents(props.amountInCents),
            category: props.category ?? null,
            description: props.description,
            date: props.date ?? new Date(),
            createdAt: new Date(),
        });
    }
}

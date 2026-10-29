import { ShoppingListStatus } from "../enums.js";
import { DomainValidationError } from "../errors.js";

export class ShoppingList {
    readonly id: string;
    readonly groupId: string;
    readonly name: string;
    readonly createdBy: string;
    private status: ShoppingListStatus;
    readonly createdAt: Date;

    private constructor(props: {
        id: string;
        groupId: string;
        name: string;
        createdBy: string;
        status: ShoppingListStatus;
        createdAt: Date;
    }) {
        this.id = props.id;
        this.groupId = props.groupId;
        this.name = props.name;
        this.createdBy = props.createdBy;
        this.status = props.status;
        this.createdAt = props.createdAt;
    }

    static create(props: { id: string; groupId: string; name: string; createdBy: string }): ShoppingList {
        if (!props.name.trim()) throw new DomainValidationError("list name is required");
        return new ShoppingList({ ...props, status: ShoppingListStatus.OPEN, createdAt: new Date() });
    }

    get currentStatus(): ShoppingListStatus {
        return this.status;
    }

    close(): void {
        this.status = ShoppingListStatus.PURCHASED;
    }

    cancel(): void {
        this.status = ShoppingListStatus.CANCELLED;
    }
}

export class ShoppingListItem {
    readonly id: string;
    readonly listId: string;
    readonly name: string;
    readonly quantity: number;
    readonly estimatedPrice: number | null;
    private purchasedBy: string | null;
    readonly createdAt: Date;

    constructor(props: { id: string; listId: string; name: string; quantity: number; estimatedPrice?: number | null }) {
        if (props.quantity <= 0) throw new DomainValidationError("quantity must be > 0");
        this.id = props.id;
        this.listId = props.listId;
        this.name = props.name;
        this.quantity = props.quantity;
        this.estimatedPrice = props.estimatedPrice ?? null;
        this.purchasedBy = null;
        this.createdAt = new Date();
    }

    markPurchased(userId: string): void {
        this.purchasedBy = userId;
    }

    get purchasedByUserId(): string | null {
        return this.purchasedBy;
    }
}

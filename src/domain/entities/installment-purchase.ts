import { Money } from "../value-objects/money.js";
import { InvalidInstallmentPurchaseError } from "../errors.js";

export class InstallmentPurchase {
    readonly id: string;
    readonly accountId: string;
    readonly description: string;
    readonly totalAmount: Money;
    readonly totalInstallments: number;
    private paidInstallments: number;
    private advancedInstallments: number;
    readonly monthlyPayment: Money;
    private active: boolean;
    readonly startDate: Date;
    readonly createdAt: Date;

    private constructor(props: {
        id: string;
        accountId: string;
        description: string;
        totalAmount: Money;
        totalInstallments: number;
        paidInstallments: number;
        advancedInstallments: number;
        monthlyPayment: Money;
        active: boolean;
        startDate: Date;
        createdAt: Date;
    }) {
        this.id = props.id;
        this.accountId = props.accountId;
        this.description = props.description;
        this.totalAmount = props.totalAmount;
        this.totalInstallments = props.totalInstallments;
        this.paidInstallments = props.paidInstallments;
        this.advancedInstallments = props.advancedInstallments;
        this.monthlyPayment = props.monthlyPayment;
        this.active = props.active;
        this.startDate = props.startDate;
        this.createdAt = props.createdAt;
    }

    static create(props: {
        id: string;
        accountId: string;
        description: string;
        totalAmountInCents: number;
        totalInstallments: number;
        monthlyPaymentInCents: number;
    }): InstallmentPurchase {
        if (props.totalInstallments <= 0) throw new InvalidInstallmentPurchaseError("totalInstallments must be > 0");
        if (props.monthlyPaymentInCents <= 0) throw new InvalidInstallmentPurchaseError("monthlyPayment must be > 0");
        return new InstallmentPurchase({
            id: props.id,
            accountId: props.accountId,
            description: props.description,
            totalAmount: Money.fromCents(props.totalAmountInCents),
            totalInstallments: props.totalInstallments,
            paidInstallments: 0,
            advancedInstallments: 0,
            monthlyPayment: Money.fromCents(props.monthlyPaymentInCents),
            active: true,
            startDate: new Date(),
            createdAt: new Date(),
        });
    }

    get remainingInstallments(): number {
        return this.totalInstallments - this.paidInstallments - this.advancedInstallments;
    }

    get remainingDebt(): Money {
        return this.monthlyPayment.multiply(this.remainingInstallments);
    }

    get isActive(): boolean {
        return this.active;
    }

    get prepaidInstallments(): number {
        return this.advancedInstallments;
    }

    assertCanPayInstallment(): void {
        if (!this.active) throw new InvalidInstallmentPurchaseError("purchase is not active");
        if (this.remainingInstallments <= 0) {
            throw new InvalidInstallmentPurchaseError("all installments are already paid");
        }
    }

    // Paga la mensualidad del mes: avanza el contador "X/N"
    payInstallment(): void {
        this.assertCanPayInstallment();
        this.paidInstallments += 1;
        if (this.remainingInstallments === 0) this.active = false;
    }

    assertCanAdvance(count: number): void {
        if (!this.active) throw new InvalidInstallmentPurchaseError("purchase is not active");
        if (!Number.isInteger(count) || count < 1) {
            throw new InvalidInstallmentPurchaseError("installments to advance must be a positive integer");
        }
        if (count > this.remainingInstallments) {
            throw new InvalidInstallmentPurchaseError(
                `cannot advance ${String(count)} installments: only ${String(this.remainingInstallments)} remaining`,
            );
        }
    }

    // Adelanta mensualidades: se quitan las ULTIMAS del plan.
    // El pago del mes y el calendario proximo no cambian el plan solo termina antes
    advanceInstallments(count: number): void {
        this.assertCanAdvance(count);
        this.advancedInstallments += count;
        if (this.remainingInstallments === 0) this.active = false;
    }
}

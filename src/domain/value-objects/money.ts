export class Money {
    private readonly cents: number;

    private constructor(cents: number) {
        if (!Number.isInteger(cents)) {
            throw new Error("Money must be an integer amount in cents");
        }

        this.cents = cents;
    }

    static fromCents(cents: number): Money {
        return new Money(cents);
    }

    static zero(): Money {
        return new Money(0);
    }

    get amountInCents(): number {
        return this.cents;
    }

    add(other: Money): Money {
        return new Money(this.cents + other.cents);
    }

    subtract(other: Money): Money {
        return new Money(this.cents - other.cents);
    }

    multiply(factor: number): Money {
        return new Money(Math.round(this.cents * factor));
    }

    isNegative(): boolean {
        return this.cents < 0;
    }

    isZero(): boolean {
        return this.cents === 0;
    }

    isGreaterThan(other: Money): boolean {
        return this.cents > other.cents;
    }

    equals(other: Money): boolean {
        return this.cents === other.cents;
    }

    toString(): string {
        return `$${(this.cents / 100).toFixed(2)} MXN`
    }
}
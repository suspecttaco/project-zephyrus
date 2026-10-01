const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Email {
    private readonly value: string;

    private constructor(value: string) {
        this.value = value;
    }

    static create(raw: string): Email {
        const normalized = raw.trim().toLowerCase();
        if (!EMAIL_REGEX.test(normalized)) {
            throw new Error(`invalid email format: ${raw}`);
        }

        return new Email(normalized);
    }

    toString(): string {
        return this.value;
    }

    equals(other: Email): boolean {
        return this.value === other.value;
    }
}
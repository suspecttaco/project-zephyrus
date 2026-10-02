import { Email } from "../value-objects/email.js";
import { DomainValidationError } from "../errors.js";

export class User {
    readonly id: string;
    readonly email: Email;
    readonly passwordHash: string;
    readonly name: string;
    readonly createdAt: Date;

    private constructor(props: { id: string; email: Email; passwordHash: string; name: string; createdAt: Date }) {
        this.id = props.id;
        this.email = props.email;
        this.passwordHash = props.passwordHash;
        this.name = props.name;
        this.createdAt = props.createdAt;
    }

    static create(props: { id: string; email: string; passwordHash: string; name: string }): User {
        if (!props.name.trim()) {
            throw new DomainValidationError("name is required");
        }

        return new User({
            id: props.id,
            email: Email.create(props.email),
            passwordHash: props.passwordHash,
            name: props.name.trim(),
            createdAt: new Date(),
        });
    }
}

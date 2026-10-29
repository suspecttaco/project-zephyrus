import { DomainValidationError } from "../errors.js";

export class Group {
    readonly id: string;
    private groupName: string;
    readonly createdBy: string;
    readonly createdAt: Date;

    private constructor(props: { id: string; name: string; createdBy: string; createdAt: Date }) {
        this.id = props.id;
        this.groupName = props.name;
        this.createdBy = props.createdBy;
        this.createdAt = props.createdAt;
    }

    get name(): string {
        return this.groupName;
    }

    rename(newName: string): void {
        if (!newName.trim()) {
            throw new DomainValidationError("group name is required");
        }
        this.groupName = newName.trim();
    }

    static create(props: { id: string; name: string; createdBy: string }): Group {
        if (!props.name.trim()) {
            throw new DomainValidationError("group name is required");
        }

        return new Group({ ...props, createdAt: new Date() });
    }
}

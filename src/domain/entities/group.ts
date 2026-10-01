export class Group {
    readonly id: string;
    readonly name: string;
    readonly createdBy: string;
    readonly createdAt: Date;

    private constructor(props: {
        id: string;
        name: string;
        createdBy: string;
        createdAt: Date;
    }) {
        this.id = props.id;
        this.name = props.name;
        this.createdBy = props.createdBy;
        this.createdAt = props.createdAt;
    }

    static create(props: {
        id: string;
        name: string;
        createdBy: string;
    }): Group {
        if (!props.name.trim()) {
            throw new Error("group name is required");
        }

        return new Group({ ...props, createdAt: new Date() });
    }
}
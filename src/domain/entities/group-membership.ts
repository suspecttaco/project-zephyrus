import {GroupRole} from "../enums.js";

export class GroupMembership {
    readonly groupId: string;
    readonly userId: string;
    readonly role: GroupRole;
    readonly joinedAt: Date;

    constructor(props: {groupId: string; userId: string; role: GroupRole }) {
        this.groupId = props.groupId;
        this.userId = props.userId;
        this.role = props.role;
        this.joinedAt = new Date();
    }

    isAdmin(): boolean {
        return this.role === GroupRole.GROUP_ADMIN;
    }
}
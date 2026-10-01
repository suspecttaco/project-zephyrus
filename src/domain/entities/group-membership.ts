import {GroupRole} from "../enums.js";
import { UnauthorizedGroupActionError } from "../errors.js";

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

    assertAdmin(): void {
        if (!this.isAdmin()) {
            throw new UnauthorizedGroupActionError("only a group admin can perform this action");
        }
    }
}
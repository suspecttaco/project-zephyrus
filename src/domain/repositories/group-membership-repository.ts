import type { GroupMembership } from "../entities/group-membership.js";

export interface IGroupMembershipRepository {
    find(groupId: string, userId: string): Promise<GroupMembership | null>;
    findByGroup(groupId: string): Promise<GroupMembership[]>;
    save(membership: GroupMembership): Promise<void>;
    remove(groupId: string, userId: string): Promise<void>;
}

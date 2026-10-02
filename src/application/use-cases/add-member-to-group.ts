import { GroupMembership } from "../../domain/entities/group-membership.js";
import { DuplicateGroupMembershipError } from "../../domain/errors.js";
import { GroupRole } from "../../domain/enums.js";
import type { IGroupMembershipRepository } from "../../domain/repositories/group-membership-repository.js";

export class AddMemberToGroup {
    constructor(private readonly membershipRepository: IGroupMembershipRepository) {}

    async execute(input: { groupId: string; userId: string; role?: GroupRole }): Promise<GroupMembership> {
        const existing = await this.membershipRepository.find(input.groupId, input.userId);
        if (existing) throw new DuplicateGroupMembershipError("user already belongs to this group");

        const membership = new GroupMembership({
            groupId: input.groupId,
            userId: input.userId,
            role: input.role ?? GroupRole.MEMBER,
        });
        await this.membershipRepository.save(membership);
        return membership;
    }
}

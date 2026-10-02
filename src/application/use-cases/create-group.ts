import { randomUUID } from "node:crypto";
import { Group } from "../../domain/entities/group.js";
import { GroupMembership } from "../../domain/entities/group-membership.js";
import { GroupRole } from "../../domain/enums.js";
import type { IGroupRepository } from "../../domain/repositories/group-repository.js";
import type { IGroupMembershipRepository } from "../../domain/repositories/group-membership-repository.js";

export class CreateGroup {
    constructor(
        private readonly groupRepository: IGroupRepository,
        private readonly membershipRepository: IGroupMembershipRepository,
    ) {}

    async execute(input: { name: string; createdBy: string }): Promise<Group> {
        const group = Group.create({ id: randomUUID(), ...input });
        await this.groupRepository.save(group);

        // el creador entra como admin
        const membership = new GroupMembership({
            groupId: group.id,
            userId: input.createdBy,
            role: GroupRole.GROUP_ADMIN,
        });
        await this.membershipRepository.save(membership);

        return group;
    }
}

import { NotFoundError } from "../../domain/errors.js";
import type { Group } from "../../domain/entities/group.js";
import type { IGroupRepository } from "../../domain/repositories/group-repository.js";
import type { IGroupMembershipRepository } from "../../domain/repositories/group-membership-repository.js";
import { requireGroupAdmin } from "../guards/require-group-admin.js";

export class UpdateGroup {
    constructor(
        private readonly groupRepository: IGroupRepository,
        private readonly membershipRepository: IGroupMembershipRepository,
    ) {}

    async execute(input: { groupId: string; actorId: string; name: string }): Promise<Group> {
        await requireGroupAdmin(this.membershipRepository, input.groupId, input.actorId);

        const group = await this.groupRepository.findById(input.groupId);
        if (!group) throw new NotFoundError("group not found");

        group.rename(input.name);
        await this.groupRepository.save(group);
        return group;
    }
}

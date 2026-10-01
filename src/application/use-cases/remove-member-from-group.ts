import { NotFoundError } from "../../domain/errors.js";
import type { IGroupMembershipRepository } from "../../domain/repositories/group-membership-repository.js";
import { requireGroupAdmin } from "../guards/require-group-admin.js";

export class RemoveMemberFromGroup {
    constructor(private readonly membershipRepository: IGroupMembershipRepository) {}

    async execute(input: { groupId: string; actorId: string; userId: string }): Promise<void> {
        await requireGroupAdmin(this.membershipRepository, input.groupId, input.actorId);

        const target = await this.membershipRepository.find(input.groupId, input.userId);
        if (!target) throw new NotFoundError("member not found in this group");

        await this.membershipRepository.remove(input.groupId, input.userId);
    }
}
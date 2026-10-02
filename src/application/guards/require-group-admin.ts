import { UnauthorizedGroupActionError } from "../../domain/errors.js";
import type { IGroupMembershipRepository } from "../../domain/repositories/group-membership-repository.js";

export async function requireGroupAdmin(
    membershipRepository: IGroupMembershipRepository,
    groupId: string,
    actorId: string,
): Promise<void> {
    const membership = await membershipRepository.find(groupId, actorId);
    if (!membership) throw new UnauthorizedGroupActionError("user does not belong to this group");
    membership.assertAdmin();
}

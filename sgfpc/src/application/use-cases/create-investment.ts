import { randomUUID } from "node:crypto";
import { Investment } from "../../domain/entities/investment.js";
import type { IInvestmentRepository } from "../../domain/repositories/investment-repository.js";
import type { IGroupMembershipRepository } from "../../domain/repositories/group-membership-repository.js";
import { requireGroupAdmin } from "../guards/require-group-admin.js";

export class CreateInvestment {
    constructor(
        private readonly investmentRepository: IInvestmentRepository,
        private readonly membershipRepository: IGroupMembershipRepository,
    ) {}

    async execute(input: {
        groupId: string;
        actorId: string;
        name: string;
        expectedReturn?: number | null;
    }): Promise<Investment> {
        await requireGroupAdmin(this.membershipRepository, input.groupId, input.actorId);

        const investment = Investment.create({
            id: randomUUID(),
            groupId: input.groupId,
            name: input.name,
            expectedReturn: input.expectedReturn ?? null,
        });
        await this.investmentRepository.save(investment);
        return investment;
    }
}

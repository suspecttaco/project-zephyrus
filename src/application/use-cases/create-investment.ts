import { randomUUID } from "node:crypto";
import { Investment } from "../../domain/entities/investment.js";
import type { IInvestmentRepository } from "../../domain/repositories/investment-repository.js";

export class CreateInvestment {
    constructor(private readonly investmentRepository: IInvestmentRepository) {}

    async execute(input: {
        groupId: string;
        name: string;
        expectedReturn?: number | null;
    }): Promise<Investment> {
        const investment = Investment.create({
            id: randomUUID(),
            ...input,
        });
        await this.investmentRepository.save(investment);
        return investment;
    }
}

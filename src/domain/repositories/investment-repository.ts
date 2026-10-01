import type { Investment } from "../entities/investment.js";

export interface IInvestmentRepository {
    findById(id: string): Promise<Investment | null>;
    findByGroup(groupId: string): Promise<Investment[]>;
    save(investment: Investment): Promise<void>;
}
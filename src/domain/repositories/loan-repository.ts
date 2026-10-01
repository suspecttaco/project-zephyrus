import type { Loan } from "../entities/loan.js";

export interface ILoanRepository {
    findById(id: string): Promise<Loan | null>;
    findByGroup(groupId: string): Promise<Loan[]>;
    save(loan: Loan): Promise<void>;
}
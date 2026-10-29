import { randomUUID } from "node:crypto";
import { Loan } from "../../domain/entities/loan.js";
import type { ILoanRepository } from "../../domain/repositories/loan-repository.js";

export class RegisterLoan {
    constructor(private readonly loanRepository: ILoanRepository) {}

    async execute(input: {
        groupId: string;
        lenderId: string;
        borrowerId: string;
        loanedAmountInCents: number;
        description: string;
    }): Promise<Loan> {
        const loan = Loan.create({
            id: randomUUID(),
            ...input,
        });
        await this.loanRepository.save(loan);
        return loan;
    }
}

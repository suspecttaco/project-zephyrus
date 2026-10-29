import { NotFoundError } from "../../domain/errors.js";
import type { ILoanRepository } from "../../domain/repositories/loan-repository.js";

export class LiquidateLoan {
    constructor(private readonly loanRepository: ILoanRepository) {}

    async execute(input: { loanId: string }): Promise<void> {
        const loan = await this.loanRepository.findById(input.loanId);
        if (!loan) throw new NotFoundError("loan not found");

        loan.settle();
        await this.loanRepository.save(loan);
    }
}

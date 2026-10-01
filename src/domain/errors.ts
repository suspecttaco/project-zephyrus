export class DomainError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class NegativeBalanceError extends DomainError {}
export class CreditLimitExceededError extends DomainError {}
export class InvalidMovementAmountError extends DomainError {}
export class ExpenseSplitMismatchError extends DomainError {}
export class DuplicateGroupMembershipError extends DomainError {}
export class InvalidInstallmentPurchaseError extends DomainError {}
export class InvalidLoanError extends DomainError {}
export class InvalidBudgetPeriodError extends DomainError {}
export class UnauthorizedGroupActionError extends DomainError {}
export class NotFoundError extends DomainError {}
export class DomainValidationError extends DomainError {}
export class InvalidSharedExpenseError extends DomainError {}
export class EmailAlreadyRegisteredError extends DomainError {}
export class InvalidCredentialsError extends DomainError {}
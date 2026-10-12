import type { Account } from "../domain/entities/account.js";
import type { InstallmentPurchase } from "../domain/entities/installment-purchase.js";
import type { Movement } from "../domain/entities/movement.js";

export interface AccountDto {
    id: string;
    userId: string;
    name: string;
    type: string;
    balanceInCents: number;
    creditLimitInCents: number | null;
    availableCreditInCents: number | null;
    cutOffDay: number | null;
    createdAt: string;
}

export interface MovementDto {
    id: string;
    accountId: string;
    destinationAccountId: string | null;
    type: string;
    amountInCents: number;
    category: string | null;
    description: string;
    date: string;
    createdAt: string;
}

export interface InstallmentPurchaseDto {
    id: string;
    accountId: string;
    description: string;
    totalAmountInCents: number;
    totalInstallments: number;
    paidInstallments: number;
    advancedInstallments: number;
    monthlyPaymentInCents: number;
    remainingInstallments: number;
    remainingDebtInCents: number;
    active: boolean;
    startDate: string;
    createdAt: string;
}

export function serializeAccount(account: Account): AccountDto {
    return {
        id: account.id,
        userId: account.userId,
        name: account.name,
        type: account.type,
        balanceInCents: account.currentBalance.amountInCents,
        creditLimitInCents: account.creditLimit ? account.creditLimit.amountInCents : null,
        availableCreditInCents: account.availableCredit ? account.availableCredit.amountInCents : null,
        cutOffDay: account.cutOffDay,
        createdAt: account.createdAt.toISOString(),
    };
}

export function serializeMovement(movement: Movement): MovementDto {
    return {
        id: movement.id,
        accountId: movement.accountId,
        destinationAccountId: movement.destinationAccountId,
        type: movement.type,
        amountInCents: movement.amount.amountInCents,
        category: movement.category,
        description: movement.description,
        date: movement.date.toISOString(),
        createdAt: movement.createdAt.toISOString(),
    };
}

export function serializeInstallmentPurchase(purchase: InstallmentPurchase): InstallmentPurchaseDto {
    return {
        id: purchase.id,
        accountId: purchase.accountId,
        description: purchase.description,
        totalAmountInCents: purchase.totalAmount.amountInCents,
        totalInstallments: purchase.totalInstallments,
        paidInstallments: purchase.paidInstallments,
        advancedInstallments: purchase.advancedInstallments,
        monthlyPaymentInCents: purchase.monthlyPayment.amountInCents,
        remainingInstallments: purchase.remainingInstallments,
        remainingDebtInCents: purchase.remainingDebt.amountInCents,
        active: purchase.isActive,
        startDate: purchase.startDate.toISOString(),
        createdAt: purchase.createdAt.toISOString(),
    };
}

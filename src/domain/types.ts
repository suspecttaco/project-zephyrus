import type {
    AccountType,
    MovementType,
    GroupRole,
    MovementCategory,
    LoanStatus,
    ShoppingListStatus,
    InvestmentStatus,
} from "./enums.ts"

// Core
export interface User {
    id: string;
    email: string;
    passwordHash: string;
    name: string;
    createdAt: string;
}

export interface Account {
    id: string;
    userId: string;
    name: string;
    type: AccountType;
    balance: number; // cents
    creditLimit: number | null; // type === CREDIT
    cutOffDay: number | null;
    createdAt: string;
}

export interface Movement {
    id: string;
    accountId: string;
    destinationAccountId: string | null;
    type: MovementType;
    amount: number;
    category: MovementCategory | null;
    description: string;
    date: string;
    createdAt: string;
}

export interface Group {
    id: string;
    name: string;
    createdBy: string;
    createdAt: string;
}

export interface ExpenseSplit {
    userId: string;
    assignedAmount: number;
}

export interface SharedExpense {
    id: string;
    groupId: string;
    paidBy: string;
    amount: number;
    description: string;
    split: ExpenseSplit[];
    date: string;
}

// Extended entities

export interface GroupMembership {
    groupId: string;
    userId: string;
    role: GroupRole;
    joinedAt: string;
}

export interface InstallmentPurchase {
    id: string;
    accountId: string;
    description: string;
    totalAmount: number;
    totalInstallments: number;
    paidInstallments: number;
    monthlyPayment: number;
    active: boolean;
    startDate: string;
    createdAt: string;
}

export interface Loan {
    id: string;
    groupId: string;
    lenderId: string;
    borrowerId: string;
    loanedAmount: number;
    remainingBalance: number;
    description: string;
    date: string;
    status: LoanStatus;
}

export interface ShoppingListItem {
    id: string;
    listId: string;
    name: string;
    quantity: number;
    estimatedPrice: number | null;
    purchasedBy: string | null;
    createdAt: string;
}

export interface ShoppingList {
    id: string;
    groupId: string;
    name: string;
    createdBy: string;
    status: ShoppingListStatus;
    createdAt: string;
}

export interface Budget {
    id: string;
    groupId: string | null;
    userId: string | null;
    category: MovementCategory;
    limitAmount: number;
    periodStart: string;
    periodEnd: string;
    createdAt: string;
}

export interface InvestmentContribution {
    userId: string;
    amount: number;
    date: string;
}

export interface Investment {
    id: string;
    groupId: string;
    name: string;
    investedAmount: number;
    contributions: InvestmentContribution[];
    expectedReturn: number | null;
    status: InvestmentStatus;
    date: string;
}
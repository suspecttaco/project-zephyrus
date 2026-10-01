import { RegisterUser } from "../src/application/use-cases/register-user.js";
import { CreateAccount } from "../src/application/use-cases/create-account.js";
import { RegisterMovement } from "../src/application/use-cases/register-movement.js";
import { CreateGroup } from "../src/application/use-cases/create-group.js";
import { AddMemberToGroup } from "../src/application/use-cases/add-member-to-group.js";
import { CreateSharedExpense } from "../src/application/use-cases/create-shared-expense.js";
import { CalculateGroupBalance } from "../src/application/use-cases/calculate-group-balance.js";
import { CreateInvestment } from "../src/application/use-cases/create-investment.js";
import { UpdateGroup } from "../src/application/use-cases/update-group.js";
import { RemoveMemberFromGroup } from "../src/application/use-cases/remove-member-from-group.js";
import { RegisterLoan } from "../src/application/use-cases/register-loan.js";
import { LiquidateLoan } from "../src/application/use-cases/liquidate-loan.js";
import { Movement } from "../src/domain/entities/movement.js";
import { AccountType, MovementType } from "../src/domain/enums.js";
import {ExpenseSplitMismatchError, InvalidSharedExpenseError, InvalidLoanError, UnauthorizedGroupActionError, DomainValidationError, NegativeBalanceError,} from "../src/domain/errors.js";

async function expectThrows(label: string, fn: () => Promise<unknown>, errorClass: new (...a: any[]) => Error) {
    try {
        await fn();
    } catch (err) {
        if (err instanceof errorClass) { console.log(`ok   - ${label}`); return; }
        throw new Error(`FAIL - ${label}: threw ${(err as Error).name}, expected ${errorClass.name}`);
    }
    throw new Error(`FAIL - ${label}: did not throw`);
}

// testing en memoria
function inMemoryRepo<T extends { id?: string }>() {
    const store = new Map<string, T>();
    return {
        store,
        async save(entity: T & { id: string }) { store.set(entity.id, entity); },
        async findById(id: string) { return store.get(id) ?? null; },
    };
}

async function main() {
    const users = { ...inMemoryRepo<any>(), async findByEmail(email: string) {
            return [...users.store.values()].find((u: any) => u.email.toString() === email) ?? null;
        }};
    const accounts = inMemoryRepo<any>();
    const movements = { ...inMemoryRepo<any>(), async findByAccount() { return []; } };
    const groups = inMemoryRepo<any>();
    const memberships = { ...inMemoryRepo<any>(),
        async find(groupId: string, userId: string) {
            return [...memberships.store.values()].find((m: any) => m.groupId === groupId && m.userId === userId) ?? null;
        },
        async findByGroup() { return []; },
        async save(m: any) { memberships.store.set(`${m.groupId}:${m.userId}`, m); },
        async remove(groupId: string, userId: string) { memberships.store.delete(`${groupId}:${userId}`); },
    };
    const sharedExpenses = { ...inMemoryRepo<any>(), async findByGroup(groupId: string) {
            return [...sharedExpenses.store.values()].filter((e: any) => e.groupId === groupId);
        }};
    const loans = { ...inMemoryRepo<any>(), async findByGroup() { return []; } };
    const investments = inMemoryRepo<any>();

    const ana = await new RegisterUser(users as any).execute({ email: "ana@test.com", password: "x", name: "Ana" });
    const beto = await new RegisterUser(users as any).execute({ email: "beto@test.com", password: "x", name: "Beto" });

    const account = await new CreateAccount(accounts as any).execute({
        userId: ana.id, name: "Nu", type: AccountType.CREDIT, creditLimitInCents: 5_000_00,
    });

    await new RegisterMovement(movements as any, accounts as any).execute({
        accountId: account.id, type: MovementType.EXPENSE, amountInCents: 1_200_00, description: "Cena",
    });

    const group = await new CreateGroup(groups as any, memberships as any).execute({ name: "Depa", createdBy: ana.id });
    await new AddMemberToGroup(memberships as any).execute({ groupId: group.id, userId: beto.id });

    await new CreateSharedExpense(sharedExpenses as any).execute({
        groupId: group.id, paidBy: ana.id, amountInCents: 1_000_00, description: "Renta",
        split: [
            { userId: ana.id, assignedAmountInCents: 500_00 },
            { userId: beto.id, assignedAmountInCents: 500_00 },
        ],
    });

    const balance = await new CalculateGroupBalance(sharedExpenses as any, loans as any).execute(group.id);
    console.log("Balance:", balance);

    const expense = (amountInCents: number, split: { userId: string; assignedAmountInCents: number }[]) =>
        new CreateSharedExpense(sharedExpenses as any).execute({
            groupId: group.id, paidBy: ana.id, amountInCents, description: "x", split,
        });

    await expectThrows("inv4: split que no suma el total", () =>
            expense(100_00, [{ userId: ana.id, assignedAmountInCents: 40_00 }, { userId: beto.id, assignedAmountInCents: 40_00 }]),
        ExpenseSplitMismatchError);
    await expectThrows("inv4: division negativa que sí suma el total", () =>
            expense(100_00, [{ userId: ana.id, assignedAmountInCents: 150_00 }, { userId: beto.id, assignedAmountInCents: -50_00 }]),
        InvalidSharedExpenseError);
    await expectThrows("inv4: gasto con monto 0", () =>
        expense(0, [{ userId: ana.id, assignedAmountInCents: 0 }]), InvalidSharedExpenseError);

    await expectThrows("inv3: categoria invalida", () =>
        Promise.resolve(Movement.create({
            id: "m1", accountId: account.id, type: MovementType.EXPENSE, amountInCents: 100,
            category: "NOPE" as any, description: "x",
        })), DomainValidationError);

    const cash = await new CreateAccount(accounts as any).execute({ userId: ana.id, name: "Efectivo", type: AccountType.CASH });
    await expectThrows("inv1: efectivo no puede quedar en negativo", () =>
        new RegisterMovement(movements as any, accounts as any).execute({
            accountId: cash.id, type: MovementType.EXPENSE, amountInCents: 10_00, description: "x",
        }), NegativeBalanceError);

    const loan = await new RegisterLoan(loans as any).execute({
        groupId: group.id, lenderId: ana.id, borrowerId: beto.id, loanedAmountInCents: 200_00, description: "Prestamo",
    });
    await expectThrows("inv7: prestamo a si mismo", () =>
        new RegisterLoan(loans as any).execute({
            groupId: group.id, lenderId: ana.id, borrowerId: ana.id, loanedAmountInCents: 10_00, description: "x",
        }), InvalidLoanError);
    await new LiquidateLoan(loans as any).execute({ loanId: loan.id });
    await expectThrows("inv7: liquidar dos veces", () =>
        new LiquidateLoan(loans as any).execute({ loanId: loan.id }), InvalidLoanError);

    await expectThrows("inv9: miembro (no admin) no crea inversion", () =>
            new CreateInvestment(investments as any, memberships as any).execute({ groupId: group.id, actorId: beto.id, name: "CETES" }),
        UnauthorizedGroupActionError);
    await expectThrows("inv9: miembro no edita el grupo", () =>
            new UpdateGroup(groups as any, memberships as any).execute({ groupId: group.id, actorId: beto.id, name: "Otro" }),
        UnauthorizedGroupActionError);
    await expectThrows("inv9: miembro no expulsa", () =>
            new RemoveMemberFromGroup(memberships as any).execute({ groupId: group.id, actorId: beto.id, userId: ana.id }),
        UnauthorizedGroupActionError);

    await new CreateInvestment(investments as any, memberships as any).execute({ groupId: group.id, actorId: ana.id, name: "CETES" });
    await new UpdateGroup(groups as any, memberships as any).execute({ groupId: group.id, actorId: ana.id, name: "Depa 2" });
    await new RemoveMemberFromGroup(memberships as any).execute({ groupId: group.id, actorId: ana.id, userId: beto.id });
    console.log("ok   - inv9: admin crea inversion, edita grupo y expulsa");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
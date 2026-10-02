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
import { AccountType, MovementCategory, MovementType } from "../src/domain/enums.js";
import { GenerateMonthlyReport } from "../src/application/use-cases/generate-monthly-report.js";
import { Money } from "../src/domain/value-objects/money.js";
import { InvalidInstallmentPurchaseError, ExpenseSplitMismatchError, InvalidSharedExpenseError, InvalidLoanError, UnauthorizedGroupActionError, DomainValidationError, NegativeBalanceError, InvalidTransferError, NotFoundError, CreditLimitExceededError} from "../src/domain/errors.js";
import { CreateInstallmentPurchase } from "../src/application/use-cases/create-installment-purchase.js";
import { PayInstallment } from "../src/application/use-cases/pay-installment.js";
import { AdvanceInstallments } from "../src/application/use-cases/advance-installments.js";

async function expectThrows(label: string, fn: () => Promise<unknown>, errorClass: new (...a: any[]) => Error) {
    try {
        await fn();
    } catch (err) {
        if (err instanceof errorClass) { console.log(`ok   - ${label}`); return; }
        throw new Error(`FAIL - ${label}: threw ${(err as Error).name}, expected ${errorClass.name}`);
    }
    throw new Error(`FAIL - ${label}: did not throw`);
}

function assertEqual(label: string, actual: unknown, expected: unknown) {
    if (actual !== expected) {
        throw new Error(`FAIL - ${label}: got ${String(actual)}, expected ${String(expected)}`);
    }
    console.log(`ok   - ${label}`);
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
    const accounts = { ...inMemoryRepo<any>(), async findByUser(userId: string) {
            return [...accounts.store.values()].filter((a: any) => a.userId === userId);
        }};
    const movements = { ...inMemoryRepo<any>(), async findByAccount(accountId: string) {
            return [...movements.store.values()].filter(
                (m: any) => m.accountId === accountId || m.destinationAccountId === accountId,
            );
        }};
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
    const installmentPurchases = { ...inMemoryRepo<any>(), async findByAccount(accountId: string) {
            return [...installmentPurchases.store.values()].filter((p: any) => p.accountId === accountId);
        }};
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

    // --- Transferencias entre cuentas propias y reporte mensual ---
    const registerMovement = new RegisterMovement(movements as any, accounts as any);
    const balanceOf = async (id: string): Promise<number> => (await accounts.findById(id)).currentBalance.amountInCents;

    const debit = await new CreateAccount(accounts as any).execute({ userId: ana.id, name: "Debito", type: AccountType.DEBIT });
    const betoDebit = await new CreateAccount(accounts as any).execute({ userId: beto.id, name: "Beto debito", type: AccountType.DEBIT });

    await registerMovement.execute({ accountId: debit.id, type: MovementType.INCOME, amountInCents: 10_000_00, description: "Quincena" });
    await registerMovement.execute({
        accountId: debit.id, type: MovementType.EXPENSE, amountInCents: 2_000_00,
        category: MovementCategory.GROCERIES, description: "Despensa",
    });

    // Pagar la tarjeta Nu (debe 1,200) desde el debito: sale del debito y baja la deuda
    await registerMovement.execute({
        accountId: debit.id, destinationAccountId: account.id, type: MovementType.TRANSFER,
        amountInCents: 1_200_00, description: "Pago tarjeta Nu",
    });
    assertEqual("transfer: baja el saldo del debito", await balanceOf(debit.id), 6_800_00);
    assertEqual("transfer: baja la deuda de la tarjeta", await balanceOf(account.id), 0);

    await expectThrows("transfer: sin cuenta destino", () =>
            registerMovement.execute({ accountId: debit.id, type: MovementType.TRANSFER, amountInCents: 10_00, description: "x" }),
        InvalidTransferError);
    await expectThrows("transfer: origen y destino iguales", () =>
        registerMovement.execute({
            accountId: debit.id, destinationAccountId: debit.id, type: MovementType.TRANSFER, amountInCents: 10_00, description: "x",
        }), InvalidTransferError);
    await expectThrows("transfer: no admite categoria", () =>
        registerMovement.execute({
            accountId: debit.id, destinationAccountId: account.id, type: MovementType.TRANSFER, amountInCents: 10_00,
            category: MovementCategory.OTHER, description: "x",
        }), InvalidTransferError);
    await expectThrows("transfer: un gasto no puede tener cuenta destino", () =>
        registerMovement.execute({
            accountId: debit.id, destinationAccountId: account.id, type: MovementType.EXPENSE, amountInCents: 10_00, description: "x",
        }), InvalidTransferError);
    await expectThrows("transfer: solo entre cuentas del mismo usuario", () =>
        registerMovement.execute({
            accountId: debit.id, destinationAccountId: betoDebit.id, type: MovementType.TRANSFER, amountInCents: 10_00, description: "x",
        }), InvalidTransferError);
    await expectThrows("transfer: cuenta destino inexistente", () =>
        registerMovement.execute({
            accountId: debit.id, destinationAccountId: "no-existe", type: MovementType.TRANSFER, amountInCents: 10_00, description: "x",
        }), NotFoundError);
    await expectThrows("transfer: saldo insuficiente en el origen", () =>
        registerMovement.execute({
            accountId: debit.id, destinationAccountId: account.id, type: MovementType.TRANSFER, amountInCents: 100_000_00, description: "x",
        }), NegativeBalanceError);
    await expectThrows("transfer: avance de efectivo sobre el limite de credito", () =>
        registerMovement.execute({
            accountId: account.id, destinationAccountId: debit.id, type: MovementType.TRANSFER, amountInCents: 6_000_00, description: "x",
        }), CreditLimitExceededError);
    assertEqual("transfer fallida: el debito queda intacto", await balanceOf(debit.id), 6_800_00);
    assertEqual("transfer fallida: la tarjeta queda intacta", await balanceOf(account.id), 0);
    await expectThrows("account: applyMovement no acepta TRANSFER", async () => {
        const stored = await accounts.findById(debit.id);
        stored.applyMovement(MovementType.TRANSFER, Money.fromCents(1));
    }, InvalidTransferError);

    // Reporte: la transferencia no cuenta ni como ingreso ni como gasto
    const now = new Date();
    const month = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const report = await new GenerateMonthlyReport(movements as any, accounts as any, sharedExpenses as any)
        .execute({ userId: ana.id, month });
    assertEqual("reporte: ingresos", report.totalIncomeInCents, 10_000_00);
    assertEqual("reporte: gastos (sin la transferencia)", report.totalExpensesInCents, 3_200_00);
    assertEqual("reporte: categoria GROCERIES", report.byCategory.GROCERIES, 2_000_00);
    assertEqual("reporte: categoria OTHER (la cena sin categoria)", report.byCategory.OTHER, 1_200_00);
    assertEqual("reporte: gasto en la tarjeta", report.byAccount[account.id]?.totalInCents, 1_200_00);
    assertEqual("reporte: gasto en el debito", report.byAccount[debit.id]?.totalInCents, 2_000_00);

    // --- Compras a plazos (MSI): pagar la mensualidad, adelantar y atomicidad ---
    const payInstallment = new PayInstallment(installmentPurchases as any, movements as any, accounts as any);
    const advanceInstallments = new AdvanceInstallments(installmentPurchases as any, movements as any, accounts as any);
    const createPurchase = new CreateInstallmentPurchase(installmentPurchases as any);

    // Tablet: 1,200 a 12 mensualidades de 100 en la tarjeta Nu (limite 5,000, deuda actual 0)
    const tablet = await createPurchase.execute({
        accountId: account.id, description: "Tablet", totalAmountInCents: 1_200_00, totalInstallments: 12, monthlyPaymentInCents: 100_00,
    });
    await payInstallment.execute({ purchaseId: tablet.id });
    assertEqual("msi: pagar la mensualidad avanza el contador", tablet.remainingInstallments, 11);
    assertEqual("msi: la mensualidad se carga a la tarjeta", await balanceOf(account.id), 100_00);

    // Adelantar 3: se quitan las ultimas 3; el contador del mes no cambia
    await advanceInstallments.execute({ purchaseId: tablet.id, count: 3 });
    assertEqual("msi: adelantar descuenta desde el final del plan", tablet.remainingInstallments, 8);
    assertEqual("msi: adelantadas registradas", tablet.prepaidInstallments, 3);
    assertEqual("msi: la deuda restante baja", tablet.remainingDebt.amountInCents, 800_00);
    assertEqual("msi: adelantar cuesta 3 mensualidades", await balanceOf(account.id), 400_00);

    await expectThrows("msi: no se puede adelantar mas de lo que falta", () =>
        advanceInstallments.execute({ purchaseId: tablet.id, count: 9 }), InvalidInstallmentPurchaseError);
    await expectThrows("msi: adelantar 0 mensualidades", () =>
        advanceInstallments.execute({ purchaseId: tablet.id, count: 0 }), InvalidInstallmentPurchaseError);
    await expectThrows("msi: adelantar una cantidad no entera", () =>
        advanceInstallments.execute({ purchaseId: tablet.id, count: 1.5 }), InvalidInstallmentPurchaseError);
    assertEqual("msi: un intento invalido no toca la tarjeta", await balanceOf(account.id), 400_00);

    // Compra grande: adelantar 5 (5,000) rebasa el limite -> nada cambia
    const laptop = await createPurchase.execute({
        accountId: account.id, description: "Laptop", totalAmountInCents: 10_000_00, totalInstallments: 10, monthlyPaymentInCents: 1_000_00,
    });
    await expectThrows("msi: adelantar sobre el limite de credito", () =>
        advanceInstallments.execute({ purchaseId: laptop.id, count: 5 }), CreditLimitExceededError);
    assertEqual("msi: fallo por limite deja la compra intacta", laptop.remainingInstallments, 10);
    assertEqual("msi: fallo por limite deja la tarjeta intacta", await balanceOf(account.id), 400_00);

    // Adelantar todo lo restante liquida la compra
    await advanceInstallments.execute({ purchaseId: tablet.id, count: 8 });
    assertEqual("msi: adelantar todo deja 0 pendientes", tablet.remainingInstallments, 0);
    assertEqual("msi: la compra liquidada se desactiva", tablet.isActive, false);
    await expectThrows("msi: no se paga una compra liquidada", () =>
        payInstallment.execute({ purchaseId: tablet.id }), InvalidInstallmentPurchaseError);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
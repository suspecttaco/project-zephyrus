// T8 (R13, R10, R12): CancelInstallmentPurchase y su ruta candidata
// POST /api/installment-purchases/:id/cancel. Revierte saldos/deuda de
// mensualidades pagadas/adelantadas, elimina los movimientos generados
// y desactiva la compra conservando su registro. Rechazos sin cambios
// parciales.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    startTestApp,
    startTestAppWith,
    createMemoryRepositories,
    seedAccount,
    seedInstallmentPurchase,
    FailOnAccountSaveRepository,
    readJson,
} from "./helpers.js";
import { PayInstallment } from "../src/application/use-cases/pay-installment.js";
import { AdvanceInstallments } from "../src/application/use-cases/advance-installments.js";
import { RegisterMovement } from "../src/application/use-cases/register-movement.js";
import { AccountType, MovementType } from "../src/domain/enums.js";
import { demoContext } from "../src/application/request-context.js";

let ctx: Awaited<ReturnType<typeof startTestApp>>;

before(async () => {
    ctx = await startTestApp();
});

after(async () => {
    await ctx.close();
});

async function createAccount(body: Record<string, unknown>): Promise<{ id: string }> {
    const response = await fetch(`${ctx.baseURL}/api/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    assert.equal(response.status, 201);
    return (await response.json()) as { id: string };
}

void test("cancelar compra activa revierte saldos/deuda, elimina movimientos y desactiva conservando registro", async () => {
    // Cuenta DEBIT con saldo inicial de 100000.
    const account = await createAccount({ name: "MSI cancel", type: "DEBIT" });
    const income = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "INCOME",
            amountInCents: 100000,
            description: "saldo inicial",
        }),
    });
    assert.equal(income.status, 201);

    // Compra MSI: 12 mensualidades de 10000.
    const purchase = await seedInstallmentPurchase(ctx.repos, {
        accountId: account.id,
        description: "compra anulable",
        totalAmountInCents: 120000,
        totalInstallments: 12,
        monthlyPaymentInCents: 10000,
    });

    // Paga 2 mensualidades y adelanta 1: efectos = 30000 de gasto.
    const payer = new PayInstallment(
        ctx.repos.installmentPurchaseRepository,
        ctx.repos.movementRepository,
        ctx.repos.accountRepository,
    );
    await payer.execute({ purchaseId: purchase.id });
    await payer.execute({ purchaseId: purchase.id });
    const advancer = new AdvanceInstallments(
        ctx.repos.installmentPurchaseRepository,
        ctx.repos.movementRepository,
        ctx.repos.accountRepository,
    );
    await advancer.execute({ purchaseId: purchase.id, count: 1 });

    // Saldo antes de cancelar: 100000 - 30000 = 70000.
    let detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal((await readJson(detail)).balanceInCents, 70000);

    // 4 movimientos: el INCOME inicial y los 3 generados por la compra
    // (2 pagos + 1 adelanto).
    let movements = (await (await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements`)).json()) as Record<
        string,
        unknown
    >[];
    assert.equal(movements.length, 4);

    // Cancela vía HTTP.
    const cancel = await fetch(`${ctx.baseURL}/api/installment-purchases/${purchase.id}/cancel`, { method: "POST" });
    assert.equal(cancel.status, 200);
    const cancelled = await readJson(cancel);
    assert.equal(cancelled.active, false);
    // Historial conservado: 2 pagadas + 1 adelantada.
    assert.equal(cancelled.paidInstallments, 2);
    assert.equal(cancelled.advancedInstallments, 1);
    assert.equal(cancelled.remainingInstallments, 9);

    // Saldo revertido: 70000 + 30000 = 100000.
    detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal((await readJson(detail)).balanceInCents, 100000);

    // Los movimientos generados por la compra se eliminaron: solo queda el INCOME inicial.
    movements = (await (await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements`)).json()) as Record<
        string,
        unknown
    >[];
    assert.equal(movements.length, 1);
    assert.equal(movements[0]?.description, "saldo inicial");

    // La compra sigue existiendo (registro conservado) con estado cancelado.
    const list = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements`);
    assert.equal(list.status, 200);
});

void test("cancelar compra de tarjeta CREDIT revierte la deuda usada", async () => {
    const account = await createAccount({
        name: "MSI crédito",
        type: "CREDIT",
        creditLimitInCents: 500000,
    });
    const purchase = await seedInstallmentPurchase(ctx.repos, {
        accountId: account.id,
        description: "compra en tarjeta",
        totalAmountInCents: 120000,
        totalInstallments: 12,
        monthlyPaymentInCents: 10000,
    });

    const payer = new PayInstallment(
        ctx.repos.installmentPurchaseRepository,
        ctx.repos.movementRepository,
        ctx.repos.accountRepository,
    );
    await payer.execute({ purchaseId: purchase.id });

    // Deuda usada: 10000.
    let detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal((await readJson(detail)).balanceInCents, 10000);

    const cancel = await fetch(`${ctx.baseURL}/api/installment-purchases/${purchase.id}/cancel`, { method: "POST" });
    assert.equal(cancel.status, 200);

    // Deuda revertida a 0.
    detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal((await readJson(detail)).balanceInCents, 0);
});

void test("cancelar ya cancelada → 409; inexistente → 404; ajena → 404; sin cambios parciales", async () => {
    const account = await createAccount({ name: "MSI rechazos", type: "DEBIT" });
    const income = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "INCOME", amountInCents: 50000, description: "fondo" }),
    });
    assert.equal(income.status, 201);

    const purchase = await seedInstallmentPurchase(ctx.repos, {
        accountId: account.id,
        description: "compra rechazos",
        totalAmountInCents: 120000,
        totalInstallments: 12,
        monthlyPaymentInCents: 10000,
    });
    const payer = new PayInstallment(
        ctx.repos.installmentPurchaseRepository,
        ctx.repos.movementRepository,
        ctx.repos.accountRepository,
    );
    await payer.execute({ purchaseId: purchase.id });

    // Primera cancelación: 200.
    const first = await fetch(`${ctx.baseURL}/api/installment-purchases/${purchase.id}/cancel`, { method: "POST" });
    assert.equal(first.status, 200);

    // Segunda cancelación (ya cancelada): 409 sin cambios.
    const second = await fetch(`${ctx.baseURL}/api/installment-purchases/${purchase.id}/cancel`, { method: "POST" });
    assert.equal(second.status, 409);

    // Estado intacto tras el rechazo: saldo con la reversión aplicada una vez.
    const detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal((await readJson(detail)).balanceInCents, 50000);

    // Inexistente → 404.
    const missing = await fetch(
        `${ctx.baseURL}/api/installment-purchases/00000000-0000-4000-8000-000000000000/cancel`,
        { method: "POST" },
    );
    assert.equal(missing.status, 404);

    // Compra de cuenta ajena → 404.
    const foreignAccount = await seedAccount(ctx.repos, {
        userId: "otro-usuario",
        name: "Ajena MSI",
        type: AccountType.DEBIT,
    });
    const foreignPurchase = await seedInstallmentPurchase(ctx.repos, {
        accountId: foreignAccount.id,
        description: "compra ajena",
        totalAmountInCents: 120000,
        totalInstallments: 12,
        monthlyPaymentInCents: 10000,
    });
    const foreignCancel = await fetch(`${ctx.baseURL}/api/installment-purchases/${foreignPurchase.id}/cancel`, {
        method: "POST",
    });
    assert.equal(foreignCancel.status, 404);

    // La compra ajena sigue activa (sin cambios parciales).
    const foreignDetail = await ctx.repos.installmentPurchaseRepository.findById(foreignPurchase.id);
    assert.equal(foreignDetail?.isActive, true);
});

void test("fallo inyectado durante la cancelación conserva el snapshot previo", async () => {
    // Sembra cuenta, saldo, compra y pago; el repositorio falla al
    // guardar la cuenta durante la cancelación: el UnitOfWork restaura
    // la instantánea previa (compra activa, movimiento presente).
    const repos = createMemoryRepositories();
    const account = await seedAccount(repos, { name: "MSI fallo", type: AccountType.DEBIT });
    const register = new RegisterMovement(repos.movementRepository, repos.accountRepository);
    await register.execute({
        accountId: account.id,
        type: MovementType.INCOME,
        amountInCents: 100000,
        description: "fondo fallo",
        context: demoContext(),
    });

    const purchase = await seedInstallmentPurchase(repos, {
        accountId: account.id,
        description: "compra con fallo",
        totalAmountInCents: 120000,
        totalInstallments: 12,
        monthlyPaymentInCents: 10000,
    });
    const payer = new PayInstallment(
        repos.installmentPurchaseRepository,
        repos.movementRepository,
        repos.accountRepository,
    );
    await payer.execute({ purchaseId: purchase.id });

    const failing = await startTestAppWith(repos, {
        accountRepository: new FailOnAccountSaveRepository(repos.accountRepository, account.id),
    });
    try {
        // Cancelación con fallo inyectado en save → 500.
        const cancel = await fetch(`${failing.baseURL}/api/installment-purchases/${purchase.id}/cancel`, {
            method: "POST",
        });
        assert.equal(cancel.status, 500);

        // Sin cambios parciales: compra activa, movimiento presente, saldo intacto.
        const after = await repos.installmentPurchaseRepository.findById(purchase.id);
        assert.ok(after, "la compra sigue existiendo tras la cancelación");
        assert.equal(after.isActive, true);
        assert.equal(after.paidInstallments, 1);

        const movements = await repos.movementRepository.findByAccount(account.id);
        assert.equal(movements.length, 2, "el movimiento MSI no fue eliminado a medias");

        const accountDetail = await repos.accountRepository.findById(account.id);
        assert.equal(accountDetail?.currentBalance.amountInCents, 90000);
    } finally {
        await failing.close();
    }
});

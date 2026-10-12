// T4 (R1, R2, R12) y T5 (R3, R4, R10, R12): CRUD de cuentas sobre
// CreateAccount/UpdateAccount/DeleteAccount con serializador explícito,
// PUT completo con type inmutable y DELETE con rechazo estricto.
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
    DEMO_FIXTURE_USER_ID,
} from "./helpers.js";
import { PayInstallment } from "../src/application/use-cases/pay-installment.js";
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

async function createAccount(body: Record<string, unknown>): Promise<Response> {
    return fetch(`${ctx.baseURL}/api/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

void test("GET /api/accounts con contexto vacío responde 200 []", async () => {
    const response = await fetch(`${ctx.baseURL}/api/accounts`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
});

void test("POST débito/crédito/efectivo → 201 con balance 0 y representación completa", async () => {
    const debit = await createAccount({ name: "Débito", type: "DEBIT" });
    assert.equal(debit.status, 201);
    const debitAccount = await readJson(debit);
    assert.equal(debitAccount.balanceInCents, 0);
    assert.equal(debitAccount.userId, DEMO_FIXTURE_USER_ID);
    assert.equal(debitAccount.creditLimitInCents, null);
    assert.equal(debitAccount.availableCreditInCents, null);
    assert.equal(debitAccount.cutOffDay, null);
    assert.ok(debitAccount.id);
    assert.ok(debitAccount.createdAt);

    const credit = await createAccount({
        name: "Crédito",
        type: "CREDIT",
        creditLimitInCents: 100000,
        cutOffDay: 15,
    });
    assert.equal(credit.status, 201);
    const creditAccount = await readJson(credit);
    assert.equal(creditAccount.balanceInCents, 0);
    assert.equal(creditAccount.creditLimitInCents, 100000);
    assert.equal(creditAccount.availableCreditInCents, 100000);
    assert.equal(creditAccount.cutOffDay, 15);

    const cash = await createAccount({ name: "Efectivo", type: "CASH" });
    assert.equal(cash.status, 201);
    const cashAccount = await readJson(cash);
    assert.equal(cashAccount.type, "CASH");
    assert.equal(cashAccount.creditLimitInCents, null);

    // Recuperables vía GET con los mismos valores.
    const detail = await fetch(`${ctx.baseURL}/api/accounts/${String(creditAccount.id)}`);
    assert.equal(detail.status, 200);
    const detailAccount = await readJson(detail);
    assert.equal(detailAccount.balanceInCents, 0);
    assert.equal(detailAccount.creditLimitInCents, 100000);
});

void test("POST con datos inválidos rechaza sin persistir (lista intacta)", async () => {
    const before = (await (await fetch(`${ctx.baseURL}/api/accounts`)).json()) as unknown[];

    const invalidBodies: Record<string, unknown>[] = [
        { name: "", type: "DEBIT" }, // nombre vacío
        { name: "X", type: "INVALID" }, // tipo inválido
        { name: "X", type: "CREDIT" }, // crédito sin límite
        { name: "X", type: "CREDIT", creditLimitInCents: -5 }, // límite negativo
        { name: "X", type: "CREDIT", creditLimitInCents: 100.5 }, // límite no entero
        { name: "X", type: "DEBIT", creditLimitInCents: 100 }, // límite en no crédito
        { name: "X", type: "DEBIT", cutOffDay: 0 }, // corte fuera de rango
        { name: "X", type: "DEBIT", cutOffDay: 32 },
        { name: "X", type: "DEBIT", cutOffDay: 15.5 },
    ];

    for (const body of invalidBodies) {
        const response = await createAccount(body);
        assert.ok(
            response.status >= 400 && response.status < 500,
            `body ${JSON.stringify(body)} debería rechazar, llegó ${String(response.status)}`,
        );
    }

    const afterList = (await (await fetch(`${ctx.baseURL}/api/accounts`)).json()) as unknown[];
    assert.equal(afterList.length, before.length, "ninguna cuenta inválida se persistió");
});

void test("GET /api/accounts/:id inexistente → 404", async () => {
    const response = await fetch(`${ctx.baseURL}/api/accounts/00000000-0000-4000-8000-000000000000`);
    assert.equal(response.status, 404);
});

void test("PUT corrige por separado nombre, límite y corte; conserva id/owner/type/balance/createdAt", async () => {
    const created = await createAccount({
        name: "Original",
        type: "CREDIT",
        creditLimitInCents: 100000,
        cutOffDay: 10,
    });
    const original = await readJson(created);
    const id = original.id as string;

    // Nombre
    const rename = await fetch(`${ctx.baseURL}/api/accounts/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            name: "Renombrada",
            creditLimitInCents: 100000,
            cutOffDay: 10,
        }),
    });
    assert.equal(rename.status, 200);
    const renamed = await readJson(rename);
    assert.equal(renamed.name, "Renombrada");
    assert.equal(renamed.id, id);
    assert.equal(renamed.userId, DEMO_FIXTURE_USER_ID);
    assert.equal(renamed.type, "CREDIT");
    assert.equal(renamed.balanceInCents, 0);
    assert.equal(renamed.createdAt, original.createdAt);

    // Límite
    const limit = await fetch(`${ctx.baseURL}/api/accounts/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            name: "Renombrada",
            creditLimitInCents: 200000,
            cutOffDay: 10,
        }),
    });
    assert.equal(limit.status, 200);
    assert.equal((await readJson(limit)).creditLimitInCents, 200000);

    // Corte
    const cutOff = await fetch(`${ctx.baseURL}/api/accounts/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            name: "Renombrada",
            creditLimitInCents: 200000,
            cutOffDay: 25,
        }),
    });
    assert.equal(cutOff.status, 200);
    const cutOffAccount = await readJson(cutOff);
    assert.equal(cutOffAccount.cutOffDay, 25);

    // GET posterior coherente con el último PUT.
    const detail = await fetch(`${ctx.baseURL}/api/accounts/${id}`);
    const detailAccount = await readJson(detail);
    assert.equal(detailAccount.name, "Renombrada");
    assert.equal(detailAccount.creditLimitInCents, 200000);
    assert.equal(detailAccount.cutOffDay, 25);
});

void test("PUT rechaza type distinto, límite bajo deuda, límite en CASH y entrada inválida sin mutación", async () => {
    // Cuenta CREDIT con deuda usada.
    const credit = await createAccount({
        name: "Tarjeta",
        type: "CREDIT",
        creditLimitInCents: 100000,
    });
    const creditAccount = (await credit.json()) as { id: string };

    // Genera deuda: gasto de 40000 en la tarjeta.
    const expense = await fetch(`${ctx.baseURL}/api/accounts/${creditAccount.id}/movements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "EXPENSE",
            amountInCents: 40000,
            category: "GROCERIES",
            description: "deuda de prueba",
        }),
    });
    assert.equal(expense.status, 201);

    // type distinto → 409 sin cambios.
    const typeChange = await fetch(`${ctx.baseURL}/api/accounts/${creditAccount.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            name: "Tarjeta",
            type: "DEBIT",
            creditLimitInCents: 100000,
        }),
    });
    assert.equal(typeChange.status, 409);

    // Límite bajo la deuda usada → 409 sin cambios.
    const lowLimit = await fetch(`${ctx.baseURL}/api/accounts/${creditAccount.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            name: "Tarjeta",
            creditLimitInCents: 30000,
        }),
    });
    assert.equal(lowLimit.status, 409);

    // Entrada inválida (nombre vacío) → 400 sin cambios.
    const invalid = await fetch(`${ctx.baseURL}/api/accounts/${creditAccount.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            name: "   ",
            creditLimitInCents: 100000,
        }),
    });
    assert.equal(invalid.status, 400);

    // Estado intacto: nombre, límite, deuda y type sin cambios.
    const detail = await fetch(`${ctx.baseURL}/api/accounts/${creditAccount.id}`);
    const account = await readJson(detail);
    assert.equal(account.name, "Tarjeta");
    assert.equal(account.type, "CREDIT");
    assert.equal(account.creditLimitInCents, 100000);
    assert.equal(account.balanceInCents, 40000);

    // Límite en CASH → 409.
    const cash = await createAccount({ name: "Efectivo", type: "CASH" });
    const cashAccount = (await cash.json()) as { id: string };
    const cashLimit = await fetch(`${ctx.baseURL}/api/accounts/${cashAccount.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            name: "Efectivo",
            creditLimitInCents: 5000,
        }),
    });
    assert.equal(cashLimit.status, 409);
});

void test("DELETE elegible → 204 y GET posterior 404; inexistente → 404", async () => {
    const created = await createAccount({ name: "A borrar", type: "DEBIT" });
    const account = (await created.json()) as { id: string };

    const removed = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`, {
        method: "DELETE",
    });
    assert.equal(removed.status, 204);

    const afterDelete = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal(afterDelete.status, 404);

    const missing = await fetch(`${ctx.baseURL}/api/accounts/00000000-0000-4000-8000-000000000000`, {
        method: "DELETE",
    });
    assert.equal(missing.status, 404);
});

void test("DELETE rechaza 409 sin perder datos: movimiento origen, destino, MSI o saldo ≠ 0", async () => {
    // 1) Cuenta con movimiento como origen.
    const withExpense = await createAccount({ name: "Con gasto", type: "DEBIT" });
    const expenseAccount = (await withExpense.json()) as { id: string };
    const fund = await fetch(`${ctx.baseURL}/api/accounts/${expenseAccount.id}/movements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "INCOME",
            amountInCents: 5000,
            description: "fondo",
        }),
    });
    assert.equal(fund.status, 201);
    const expense = await fetch(`${ctx.baseURL}/api/accounts/${expenseAccount.id}/movements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "EXPENSE",
            amountInCents: 1000,
            description: "gasto",
        }),
    });
    assert.equal(expense.status, 201);

    const deleteWithExpense = await fetch(`${ctx.baseURL}/api/accounts/${expenseAccount.id}`, { method: "DELETE" });
    assert.equal(deleteWithExpense.status, 409);
    // Intacta: cuenta y movimiento siguen ahí.
    const expenseDetail = await fetch(`${ctx.baseURL}/api/accounts/${expenseAccount.id}`);
    assert.equal(expenseDetail.status, 200);
    const expenseMovements = await fetch(`${ctx.baseURL}/api/accounts/${expenseAccount.id}/movements`);
    assert.equal((await readJson(expenseMovements)).length, 2);

    // 2) Cuenta con movimiento como destino (transferencia entrante).
    const source = await createAccount({ name: "Origen t", type: "DEBIT" });
    const sourceAccount = (await source.json()) as { id: string };
    const target = await createAccount({ name: "Destino t", type: "DEBIT" });
    const targetAccount = (await target.json()) as { id: string };
    const fundSource = await fetch(`${ctx.baseURL}/api/accounts/${sourceAccount.id}/movements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "INCOME",
            amountInCents: 10000,
            description: "fondo origen",
        }),
    });
    assert.equal(fundSource.status, 201);
    const transfer = await fetch(`${ctx.baseURL}/api/accounts/${sourceAccount.id}/movements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "TRANSFER",
            amountInCents: 2000,
            description: "transferencia",
            destinationAccountId: targetAccount.id,
        }),
    });
    assert.equal(transfer.status, 201);

    const deleteTarget = await fetch(`${ctx.baseURL}/api/accounts/${targetAccount.id}`, {
        method: "DELETE",
    });
    assert.equal(deleteTarget.status, 409);
    const targetDetail = await fetch(`${ctx.baseURL}/api/accounts/${targetAccount.id}`);
    assert.equal(targetDetail.status, 200);

    // 3) Cuenta con compra MSI vinculada.
    const msiAccount = await createAccount({ name: "MSI", type: "CREDIT", creditLimitInCents: 500000 });
    const msiAccountData = (await msiAccount.json()) as { id: string };
    await seedInstallmentPurchase(ctx.repos, {
        accountId: msiAccountData.id,
        description: "compra MSI",
        totalAmountInCents: 120000,
        totalInstallments: 12,
        monthlyPaymentInCents: 10000,
    });
    const deleteMsi = await fetch(`${ctx.baseURL}/api/accounts/${msiAccountData.id}`, {
        method: "DELETE",
    });
    assert.equal(deleteMsi.status, 409);
    const msiDetail = await fetch(`${ctx.baseURL}/api/accounts/${msiAccountData.id}`);
    assert.equal(msiDetail.status, 200);

    // 4) Cuenta con saldo ≠ 0.
    const funded = await createAccount({ name: "Con saldo", type: "DEBIT" });
    const fundedAccount = (await funded.json()) as { id: string };
    const income = await fetch(`${ctx.baseURL}/api/accounts/${fundedAccount.id}/movements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "INCOME",
            amountInCents: 5000,
            description: "saldo",
        }),
    });
    assert.equal(income.status, 201);

    const deleteFunded = await fetch(`${ctx.baseURL}/api/accounts/${fundedAccount.id}`, {
        method: "DELETE",
    });
    assert.equal(deleteFunded.status, 409);
    const fundedDetail = await fetch(`${ctx.baseURL}/api/accounts/${fundedAccount.id}`);
    assert.equal(fundedDetail.status, 200);
    assert.equal((await readJson(fundedDetail)).balanceInCents, 5000);
});

void test("fallo injectado en save deja el snapshot previo intacto (rollback observable)", async () => {
    // Sembra las cuentas y el saldo del origen directamente, y usa un
    // repositorio que falla al guardar la destino: la transferencia
    // dispara movement.save + source.save + destination.save; el último
    // falla y el UnitOfWork restaura la instantánea previa completa.
    const repos = createMemoryRepositories();
    const source = await seedAccount(repos, { name: "Origen fallo", type: AccountType.DEBIT });
    const target = await seedAccount(repos, { name: "Destino fallo", type: AccountType.DEBIT });
    const register = new RegisterMovement(repos.movementRepository, repos.accountRepository);
    await register.execute({
        accountId: source.id,
        type: MovementType.INCOME,
        amountInCents: 5000,
        description: "fondo fallo",
        context: demoContext(),
    });
    const failing = await startTestAppWith(repos, {
        accountRepository: new FailOnAccountSaveRepository(repos.accountRepository, target.id),
    });
    try {
        const transfer = await fetch(`${failing.baseURL}/api/accounts/${source.id}/movements`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                type: "TRANSFER",
                amountInCents: 3000,
                description: "transferencia con fallo",
                destinationAccountId: target.id,
            }),
        });
        assert.equal(transfer.status, 500);

        // Sin movimiento nuevo y sin cambios de saldo en ninguna cuenta.
        const sourceMovements = (await (
            await fetch(`${failing.baseURL}/api/accounts/${source.id}/movements`)
        ).json()) as { description: string }[];
        assert.equal(sourceMovements.length, 1, "solo el fondo: la transferencia fallida no dejó asiento");
        assert.equal(sourceMovements[0]?.description, "fondo fallo");

        const targetMovements = await fetch(`${failing.baseURL}/api/accounts/${target.id}/movements`);
        assert.deepEqual(await targetMovements.json(), []);

        const sourceDetail = await fetch(`${failing.baseURL}/api/accounts/${source.id}`);
        assert.equal((await readJson(sourceDetail)).balanceInCents, 5000);
        const targetDetail = await fetch(`${failing.baseURL}/api/accounts/${target.id}`);
        assert.equal((await readJson(targetDetail)).balanceInCents, 0);
    } finally {
        await failing.close();
    }
});

void test("DELETE sobre cuenta con compra MSI ya cancelada también rechaza 409 (histórica)", async () => {
    const account = await seedAccount(ctx.repos, {
        name: "MSI cancelada",
        type: AccountType.CREDIT,
        creditLimitInCents: 500000,
    });
    const purchase = await seedInstallmentPurchase(ctx.repos, {
        accountId: account.id,
        description: "compra que se cancelará",
        totalAmountInCents: 120000,
        totalInstallments: 12,
        monthlyPaymentInCents: 10000,
    });

    // Paga una mensualidad (crea movimiento vinculado y deuda) y cancela.
    const payer = new PayInstallment(
        ctx.repos.installmentPurchaseRepository,
        ctx.repos.movementRepository,
        ctx.repos.accountRepository,
    );
    await payer.execute({ purchaseId: purchase.id });

    const cancel = await fetch(`${ctx.baseURL}/api/installment-purchases/${purchase.id}/cancel`, { method: "POST" });
    assert.equal(cancel.status, 200);

    // La cuenta sigue teniendo la compra MSI vinculada (histórica): 409.
    const removed = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`, {
        method: "DELETE",
    });
    assert.equal(removed.status, 409);
    const detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal(detail.status, 200);
});

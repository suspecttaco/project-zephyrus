// T6 (R5, R6, R10, R12) y T7 (R7, R8, R10, R12): lista/detalle/POST de
// movimientos con transferencias, PUT por reversión y reaplicación, y
// DELETE con política de dependencias.
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

async function createMovement(accountId: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`${ctx.baseURL}/api/accounts/${accountId}/movements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

void test("GET lista y detalle: 404 para cuenta o movimiento inexistente", async () => {
    const missingAccount = "00000000-0000-4000-8000-000000000000";
    const list = await fetch(`${ctx.baseURL}/api/accounts/${missingAccount}/movements`);
    assert.equal(list.status, 404);

    const account = await createAccount({ name: "Movimientos", type: "DEBIT" });
    const detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements/${missingAccount}`);
    assert.equal(detail.status, 404);

    // Movimiento que existe pero pertenece a otra cuenta → 404.
    const other = await createAccount({ name: "Otra", type: "DEBIT" });
    const income = await createMovement(account.id, {
        type: "INCOME",
        amountInCents: 1000,
        description: "ingreso",
    });
    const movement = (await income.json()) as { id: string };
    const foreign = await fetch(`${ctx.baseURL}/api/accounts/${other.id}/movements/${movement.id}`);
    assert.equal(foreign.status, 404);
});

void test("POST INCOME y EXPENSE válidos reflejan saldos correctos y date opcional", async () => {
    const account = await createAccount({ name: "Saldos", type: "DEBIT" });

    const income = await createMovement(account.id, {
        type: "INCOME",
        amountInCents: 10000,
        category: "OTHER",
        description: "nómina",
    });
    assert.equal(income.status, 201);
    const incomeBody = await readJson(income);
    assert.equal(incomeBody.balanceInCents ?? null, null); // el DTO no expone saldo
    assert.equal(incomeBody.type, "INCOME");
    assert.equal(incomeBody.category, "OTHER");
    assert.ok(incomeBody.date);

    // date por defecto ≈ hoy (día actual en ISO).
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((incomeBody.date as string).slice(0, 10), today);

    const detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements/${String(incomeBody.id)}`);
    assert.equal(detail.status, 200);

    const accountDetail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal((await readJson(accountDetail)).balanceInCents, 10000);

    const expense = await createMovement(account.id, {
        type: "EXPENSE",
        amountInCents: 4000,
        category: "GROCERIES",
        description: "super",
        date: "2026-01-15T10:00:00.000Z",
    });
    assert.equal(expense.status, 201);
    const expenseBody = await readJson(expense);
    assert.equal(expenseBody.date, "2026-01-15T10:00:00.000Z");

    const afterExpense = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal((await readJson(afterExpense)).balanceInCents, 6000);
});

void test("POST TRANSFER DEBIT→CREDIT paga deuda: un único asiento en ambas listas y saldos correctos", async () => {
    const debit = await createAccount({ name: "Débito t", type: "DEBIT" });
    const credit = await createAccount({
        name: "Crédito t",
        type: "CREDIT",
        creditLimitInCents: 100000,
    });

    // Saldo en el débito y deuda previa en la tarjeta.
    const fund = await createMovement(debit.id, {
        type: "INCOME",
        amountInCents: 50000,
        description: "fondo",
    });
    assert.equal(fund.status, 201);
    const expense = await createMovement(credit.id, {
        type: "EXPENSE",
        amountInCents: 50000,
        category: "RENT",
        description: "deuda previa",
    });
    assert.equal(expense.status, 201);

    const transfer = await createMovement(debit.id, {
        type: "TRANSFER",
        amountInCents: 20000,
        description: "pago de tarjeta",
        destinationAccountId: credit.id,
    });
    assert.equal(transfer.status, 201);
    const movement = await readJson(transfer);
    assert.equal(movement.destinationAccountId, credit.id);
    assert.equal(movement.category, null, "la transferencia no lleva categoría");

    // Cada lista lleva su asiento previo (fondo en el débito, deuda en el
    // crédito) MÁS la transferencia, que aparece exactamente una vez en
    // origen y en destino (R5).
    const debitMovements = (await (await fetch(`${ctx.baseURL}/api/accounts/${debit.id}/movements`)).json()) as {
        id: string;
    }[];
    assert.equal(debitMovements.length, 2);
    assert.equal(
        debitMovements.filter((m) => m.id === movement.id).length,
        1,
        "la transferencia no se duplica en origen",
    );

    const creditMovements = (await (await fetch(`${ctx.baseURL}/api/accounts/${credit.id}/movements`)).json()) as {
        id: string;
    }[];
    assert.equal(creditMovements.length, 2);
    assert.equal(
        creditMovements.filter((m) => m.id === movement.id).length,
        1,
        "la transferencia no se duplica en destino",
    );

    // Saldos: débito 50000-20000=30000, crédito (deuda) 50000-20000=30000.
    const debitDetail = await fetch(`${ctx.baseURL}/api/accounts/${debit.id}`);
    assert.equal((await readJson(debitDetail)).balanceInCents, 30000, "débito");
    const creditDetail = await fetch(`${ctx.baseURL}/api/accounts/${credit.id}`);
    const creditBody = (await creditDetail.json()) as { balanceInCents: number };
    assert.equal(creditBody.balanceInCents, 30000, "deuda restante en tarjeta");
});

void test("POST rechaza sin asientos ni cambios: sin destino, mismo destino, ajeno, insuficiente, límite y monto inválido", async () => {
    const account = await createAccount({ name: "Validaciones", type: "DEBIT" });
    const other = await createAccount({ name: "Otra v", type: "DEBIT" });
    const foreign = await seedAccount(ctx.repos, { userId: "ajeno", name: "Ajena v", type: AccountType.DEBIT });

    const invalidBodies: Record<string, unknown>[] = [
        { type: "TRANSFER", amountInCents: 1000, description: "sin destino" },
        { type: "TRANSFER", amountInCents: 1000, description: "mismo destino", destinationAccountId: account.id },
        { type: "TRANSFER", amountInCents: 1000, description: "destino ajeno", destinationAccountId: foreign.id },
        {
            type: "TRANSFER",
            amountInCents: 1000,
            description: "con categoría",
            destinationAccountId: other.id,
            category: "RENT",
        },
        { type: "INCOME", amountInCents: 1000, description: "ingreso con destino", destinationAccountId: other.id },
        { type: "EXPENSE", amountInCents: 1000, description: "gasto insuficiente" }, // saldo 0
        { type: "INCOME", amountInCents: 0, description: "monto cero" },
        { type: "INCOME", amountInCents: -100, description: "monto negativo" },
        { type: "INCOME", amountInCents: 10.5, description: "monto float" },
        { type: "INCOME", amountInCents: "100", description: "monto string" },
        { type: "INVALID", amountInCents: 100, description: "tipo inválido" },
    ];

    for (const body of invalidBodies) {
        const response = await createMovement(account.id, body);
        assert.ok(
            response.status >= 400 && response.status < 500,
            `body ${JSON.stringify(body)} debería rechazar, llegó ${String(response.status)}`,
        );
    }

    // Sin movimientos ni saldo.
    const movements = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements`);
    assert.deepEqual(await movements.json(), []);
    const detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal((await readJson(detail)).balanceInCents, 0);
});

void test("POST que excede el límite de crédito rechaza 409 sin cambios", async () => {
    const credit = await createAccount({
        name: "Límite",
        type: "CREDIT",
        creditLimitInCents: 10000,
    });
    const response = await createMovement(credit.id, {
        type: "EXPENSE",
        amountInCents: 15000,
        category: "RENT",
        description: "excede límite",
    });
    assert.equal(response.status, 409);

    const detail = await fetch(`${ctx.baseURL}/api/accounts/${credit.id}`);
    assert.equal((await readJson(detail)).balanceInCents, 0);
    const movements = await fetch(`${ctx.baseURL}/api/accounts/${credit.id}/movements`);
    assert.deepEqual(await movements.json(), []);
});

void test("PUT corrige importe, tipo, origen, destino, fecha, categoría y descripción; conserva id/createdAt", async () => {
    const a = await createAccount({ name: "Cuenta A", type: "DEBIT" });
    const b = await createAccount({ name: "Cuenta B", type: "DEBIT" });

    // Saldo inicial en ambas cuentas y gasto original de 5000 en A.
    const fund = await createMovement(a.id, {
        type: "INCOME",
        amountInCents: 10000,
        description: "fondo A",
    });
    assert.equal(fund.status, 201);
    const fundB = await createMovement(b.id, {
        type: "INCOME",
        amountInCents: 10000,
        description: "fondo B",
    });
    assert.equal(fundB.status, 201);
    const original = await createMovement(a.id, {
        type: "EXPENSE",
        amountInCents: 5000,
        category: "GROCERIES",
        description: "gasto original",
        date: "2026-02-01T00:00:00.000Z",
    });
    const originalBody = (await original.json()) as { id: string; createdAt: string };

    // 1) Corrige importe a 3000.
    const amountFix = await fetch(`${ctx.baseURL}/api/accounts/${a.id}/movements/${originalBody.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "EXPENSE",
            amountInCents: 3000,
            accountId: a.id,
            description: "gasto original",
            date: "2026-02-01T00:00:00.000Z",
            category: "GROCERIES",
        }),
    });
    assert.equal(amountFix.status, 200);
    assert.equal((await readJson(amountFix)).amountInCents, 3000);
    let detail = await fetch(`${ctx.baseURL}/api/accounts/${a.id}`);
    // Fondo 10000 - gasto corregido 3000.
    assert.equal((await readJson(detail)).balanceInCents, 7000);

    // 2) Corrige tipo a INCOME (reversión de gasto + ingreso).
    const typeFix = await fetch(`${ctx.baseURL}/api/accounts/${a.id}/movements/${originalBody.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "INCOME",
            amountInCents: 3000,
            accountId: a.id,
            description: "gasto original",
            date: "2026-02-01T00:00:00.000Z",
            category: "GROCERIES",
        }),
    });
    assert.equal(typeFix.status, 200);
    detail = await fetch(`${ctx.baseURL}/api/accounts/${a.id}`);
    // Revierte el gasto (+3000) y aplica el ingreso (+3000): 7000+3000+3000.
    assert.equal((await readJson(detail)).balanceInCents, 13000);

    // 3) Corrige origen a B (la corrección sale de A y entra en B).
    const sourceFix = await fetch(`${ctx.baseURL}/api/accounts/${a.id}/movements/${originalBody.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "INCOME",
            amountInCents: 3000,
            accountId: b.id,
            description: "gasto original",
            date: "2026-02-01T00:00:00.000Z",
            category: "GROCERIES",
        }),
    });
    assert.equal(sourceFix.status, 200);
    detail = await fetch(`${ctx.baseURL}/api/accounts/${a.id}`);
    // El ingreso sale de A (13000-3000): conserva solo el fondo.
    assert.equal((await readJson(detail)).balanceInCents, 10000, "A conserva su fondo tras cambiar el origen");
    detail = await fetch(`${ctx.baseURL}/api/accounts/${b.id}`);
    // Y entra en B (fondo 10000 + ingreso 3000).
    assert.equal((await readJson(detail)).balanceInCents, 13000, "B recibe el ingreso");

    // La URL antigua (origen A) responde 404; la nueva (origen B) funciona.
    const oldUrl = await fetch(`${ctx.baseURL}/api/accounts/${a.id}/movements/${originalBody.id}`);
    assert.equal(oldUrl.status, 404);
    const newUrl = await fetch(`${ctx.baseURL}/api/accounts/${b.id}/movements/${originalBody.id}`);
    assert.equal(newUrl.status, 200);

    // 4) Corrige destino: convierte en transferencia de B a A.
    const destFix = await fetch(`${ctx.baseURL}/api/accounts/${b.id}/movements/${originalBody.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "TRANSFER",
            amountInCents: 3000,
            accountId: b.id,
            destinationAccountId: a.id,
            description: "transferencia corregida",
            date: "2026-02-01T00:00:00.000Z",
        }),
    });
    assert.equal(destFix.status, 200);
    detail = await fetch(`${ctx.baseURL}/api/accounts/${b.id}`);
    // B revierte el ingreso (10000) y transfiere 3000.
    assert.equal((await readJson(detail)).balanceInCents, 7000, "B transfiere 3000");
    detail = await fetch(`${ctx.baseURL}/api/accounts/${a.id}`);
    assert.equal((await readJson(detail)).balanceInCents, 13000, "A recibe la transferencia");

    // 5) Corrige fecha, categoría y descripción.
    const finalFix = await fetch(`${ctx.baseURL}/api/accounts/${b.id}/movements/${originalBody.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "TRANSFER",
            amountInCents: 3000,
            accountId: b.id,
            destinationAccountId: a.id,
            description: "descripción final",
            date: "2026-03-10T00:00:00.000Z",
            category: null,
        }),
    });
    assert.equal(finalFix.status, 200);
    const finalBody = await readJson(finalFix);
    assert.equal(finalBody.date, "2026-03-10T00:00:00.000Z");
    assert.equal(finalBody.description, "descripción final");
    assert.equal(finalBody.category, null);

    // Conserva id y createdAt en todas las correcciones.
    assert.equal(finalBody.id, originalBody.id);
    assert.equal(finalBody.createdAt, originalBody.createdAt);

    // Las listas reflejan los nuevos datos.
    const bMovements = (await (await fetch(`${ctx.baseURL}/api/accounts/${b.id}/movements`)).json()) as Record<
        string,
        unknown
    >[];
    assert.equal(bMovements.length, 2, "fondo B + transferencia corregida");
    assert.equal(bMovements.find((m) => m.id === originalBody.id)?.destinationAccountId, a.id);
});

void test("PUT que violaría saldo negativo o límite rechaza 409 sin cambios", async () => {
    const account = await createAccount({ name: "Rechazo PUT", type: "DEBIT" });
    const income = await createMovement(account.id, {
        type: "INCOME",
        amountInCents: 5000,
        description: "ingreso",
    });
    const movement = (await income.json()) as { id: string };

    // Convertir ingreso de 5000 en gasto de 8000 → saldo -3000: rechazo.
    const response = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements/${movement.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "EXPENSE",
            amountInCents: 8000,
            accountId: account.id,
            description: "ingreso",
            date: "2026-01-01T00:00:00.000Z",
        }),
    });
    assert.equal(response.status, 409);

    // Sin cambios: sigue siendo INCOME de 5000 y el saldo es 5000.
    const detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements/${movement.id}`);
    const body = await readJson(detail);
    assert.equal(body.type, "INCOME");
    assert.equal(body.amountInCents, 5000);
    const accountDetail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal((await readJson(accountDetail)).balanceInCents, 5000);
});

void test("PUT de movimiento generado por MSI rechaza 409 sin cambios", async () => {
    const account = await createAccount({ name: "MSI PUT", type: "CREDIT", creditLimitInCents: 500000 });
    const purchase = await seedInstallmentPurchase(ctx.repos, {
        accountId: account.id,
        description: "compra para PUT",
        totalAmountInCents: 120000,
        totalInstallments: 12,
        monthlyPaymentInCents: 10000,
    });
    const payer = new PayInstallment(
        ctx.repos.installmentPurchaseRepository,
        ctx.repos.movementRepository,
        ctx.repos.accountRepository,
    );
    const msiMovement = await payer.execute({ purchaseId: purchase.id });

    const response = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements/${msiMovement.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "EXPENSE",
            amountInCents: 99999,
            accountId: account.id,
            description: "intento de edición MSI",
            date: "2026-01-01T00:00:00.000Z",
        }),
    });
    assert.equal(response.status, 409);

    // El movimiento MSI sigue intacto.
    const detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements/${msiMovement.id}`);
    assert.equal(detail.status, 200);
    assert.equal((await readJson(detail)).amountInCents, 10000);
});

void test("DELETE de movimiento simple → 204 con reversión de saldo; transferencia y MSI → 409", async () => {
    const account = await createAccount({ name: "Borrados", type: "DEBIT" });
    const income = await createMovement(account.id, {
        type: "INCOME",
        amountInCents: 7000,
        description: "ingreso borrable",
    });
    const incomeBody = (await income.json()) as { id: string };

    const removed = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements/${incomeBody.id}`, {
        method: "DELETE",
    });
    assert.equal(removed.status, 204);

    // Saldo revertido y movimiento eliminado.
    const detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal((await readJson(detail)).balanceInCents, 0);
    const afterDelete = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements/${incomeBody.id}`);
    assert.equal(afterDelete.status, 404);

    // Transferencia → 409 sin cambios.
    const other = await createAccount({ name: "Otra b", type: "DEBIT" });
    const fund = await createMovement(account.id, {
        type: "INCOME",
        amountInCents: 5000,
        description: "fondo para transferencia",
    });
    assert.equal(fund.status, 201);
    const transfer = await createMovement(account.id, {
        type: "TRANSFER",
        amountInCents: 1000,
        description: "transferencia borrable",
        destinationAccountId: other.id,
    });
    const transferBody = (await transfer.json()) as { id: string };
    const deleteTransfer = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements/${transferBody.id}`, {
        method: "DELETE",
    });
    assert.equal(deleteTransfer.status, 409);
    const transferDetail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements/${transferBody.id}`);
    assert.equal(transferDetail.status, 200);
    const accountDetail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    // Saldo intacto tras el rechazo: fondo 5000 - transferencia 1000.
    assert.equal((await readJson(accountDetail)).balanceInCents, 4000);

    // Movimiento MSI → 409 sin cambios.
    const msiAccount = await createAccount({ name: "MSI DELETE", type: "CREDIT", creditLimitInCents: 500000 });
    const purchase = await seedInstallmentPurchase(ctx.repos, {
        accountId: msiAccount.id,
        description: "compra para DELETE",
        totalAmountInCents: 120000,
        totalInstallments: 12,
        monthlyPaymentInCents: 10000,
    });
    const payer = new PayInstallment(
        ctx.repos.installmentPurchaseRepository,
        ctx.repos.movementRepository,
        ctx.repos.accountRepository,
    );
    const msiMovement = await payer.execute({ purchaseId: purchase.id });
    const deleteMsi = await fetch(`${ctx.baseURL}/api/accounts/${msiAccount.id}/movements/${msiMovement.id}`, {
        method: "DELETE",
    });
    assert.equal(deleteMsi.status, 409);
    const msiDetail = await fetch(`${ctx.baseURL}/api/accounts/${msiAccount.id}/movements/${msiMovement.id}`);
    assert.equal(msiDetail.status, 200);

    // DELETE inexistente → 404.
    const missing = await fetch(
        `${ctx.baseURL}/api/accounts/${account.id}/movements/00000000-0000-4000-8000-000000000000`,
        { method: "DELETE" },
    );
    assert.equal(missing.status, 404);
});

void test("fallo inyectado en save durante PUT deja el estado exactamente igual", async () => {
    // Sembra cuenta y movimiento directamente; el repositorio falla al
    // guardar la cuenta: PUT hace movement.save (ok) + account.save
    // (falla) y el UnitOfWork restaura la instantánea previa.
    const repos = createMemoryRepositories();
    const account = await seedAccount(repos, { name: "PUT con fallo", type: AccountType.DEBIT });
    const register = new RegisterMovement(repos.movementRepository, repos.accountRepository);
    const movement = await register.execute({
        accountId: account.id,
        type: MovementType.INCOME,
        amountInCents: 5000,
        description: "ingreso PUT con fallo",
        context: demoContext(),
    });

    const failing = await startTestAppWith(repos, {
        accountRepository: new FailOnAccountSaveRepository(repos.accountRepository, account.id),
    });
    try {
        const update = await fetch(`${failing.baseURL}/api/accounts/${account.id}/movements/${movement.id}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                type: "INCOME",
                amountInCents: 9000,
                accountId: account.id,
                description: "ingreso PUT con fallo",
                date: "2026-01-01T00:00:00.000Z",
            }),
        });
        assert.equal(update.status, 500);

        // Estado exactamente igual: movimiento original y saldo 5000.
        const detail = await fetch(`${failing.baseURL}/api/accounts/${account.id}/movements/${movement.id}`);
        const body = await readJson(detail);
        assert.equal(body.amountInCents, 5000);
        const accountDetail = await fetch(`${failing.baseURL}/api/accounts/${account.id}`);
        assert.equal((await readJson(accountDetail)).balanceInCents, 5000);
    } finally {
        await failing.close();
    }
});

// T3 (R1, R5, R10, R12): adaptadores de memoria aislados por app,
// consultas, transferencias una vez y contexto de dueño acordado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, seedAccount, DEMO_FIXTURE_USER_ID } from "./helpers.js";
import { AccountType } from "../src/domain/enums.js";

let ctx: Awaited<ReturnType<typeof startTestApp>>;

before(async () => {
    ctx = await startTestApp();
});

after(async () => {
    await ctx.close();
});

void test("dos apps con adaptadores de memoria están aisladas (sin estado compartido)", async () => {
    const other = await startTestApp();
    try {
        const created = await fetch(`${ctx.baseURL}/api/accounts`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Aislada", type: "DEBIT" }),
        });
        assert.equal(created.status, 201);
        const account = (await created.json()) as { id: string };

        // La otra app no la ve: mismo ID → 404 y lista vacía.
        const foreignDetail = await fetch(`${other.baseURL}/api/accounts/${account.id}`);
        assert.equal(foreignDetail.status, 404);

        const foreignList = await fetch(`${other.baseURL}/api/accounts`);
        assert.deepEqual(await foreignList.json(), []);
    } finally {
        await other.close();
    }
});

void test("find/list al crear: POST 201 → GET detalle 200 y GET lista lo incluye", async () => {
    const created = await fetch(`${ctx.baseURL}/api/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Cheques", type: "DEBIT" }),
    });
    assert.equal(created.status, 201);
    const account = (await created.json()) as { id: string; balanceInCents: number };
    assert.equal(account.balanceInCents, 0);

    const detail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}`);
    assert.equal(detail.status, 200);

    const list = await fetch(`${ctx.baseURL}/api/accounts`);
    const accounts = (await list.json()) as { id: string }[];
    assert.ok(accounts.some((a) => a.id === account.id));
});

void test("transferencia aparece UNA sola vez en la lista de origen y de destino", async () => {
    const source = await fetch(`${ctx.baseURL}/api/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Origen", type: "DEBIT" }),
    });
    const sourceAccount = (await source.json()) as { id: string };

    const target = await fetch(`${ctx.baseURL}/api/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Destino", type: "DEBIT" }),
    });
    const targetAccount = (await target.json()) as { id: string };

    // Saldo en el origen para que la transferencia sea válida.
    const fund = await fetch(`${ctx.baseURL}/api/accounts/${sourceAccount.id}/movements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "INCOME",
            amountInCents: 10000,
            description: "fondo",
        }),
    });
    assert.equal(fund.status, 201);

    const transfer = await fetch(`${ctx.baseURL}/api/accounts/${sourceAccount.id}/movements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "TRANSFER",
            amountInCents: 5000,
            description: "transferencia test",
            destinationAccountId: targetAccount.id,
        }),
    });
    assert.equal(transfer.status, 201);
    const movement = (await transfer.json()) as {
        id: string;
        destinationAccountId: string | null;
    };
    assert.equal(movement.destinationAccountId, targetAccount.id);

    const sourceMovements = (await (
        await fetch(`${ctx.baseURL}/api/accounts/${sourceAccount.id}/movements`)
    ).json()) as { id: string }[];
    // El origen lista el fondo Y la transferencia; ésta aparece una sola vez.
    assert.equal(sourceMovements.length, 2);
    assert.equal(sourceMovements.filter((m) => m.id === movement.id).length, 1);

    const targetMovements = (await (
        await fetch(`${ctx.baseURL}/api/accounts/${targetAccount.id}/movements`)
    ).json()) as { id: string }[];
    assert.equal(targetMovements.length, 1, "la transferencia no se duplica en destino");
    assert.equal(targetMovements[0]?.id, movement.id);
});

void test("cuenta ajena al contexto acordado no es visible (404 y fuera de listas)", async () => {
    const foreign = await seedAccount(ctx.repos, {
        userId: "otro-usuario",
        name: "Ajena",
        type: AccountType.DEBIT,
    });

    const detail = await fetch(`${ctx.baseURL}/api/accounts/${foreign.id}`);
    assert.equal(detail.status, 404);

    const list = await fetch(`${ctx.baseURL}/api/accounts`);
    const accounts = (await list.json()) as { id: string }[];
    assert.ok(!accounts.some((a) => a.id === foreign.id));
});

void test("findById: ID inexistente → 404 en detalle y en movimientos", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const detail = await fetch(`${ctx.baseURL}/api/accounts/${missing}`);
    assert.equal(detail.status, 404);

    const created = await fetch(`${ctx.baseURL}/api/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Con Movimientos", type: "DEBIT" }),
    });
    const account = (await created.json()) as { id: string };

    const movementDetail = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements/${missing}`);
    assert.equal(movementDetail.status, 404);

    const movementList = await fetch(`${ctx.baseURL}/api/accounts/${account.id}/movements`);
    assert.equal(movementList.status, 200);
    assert.deepEqual(await movementList.json(), []);
});

void test("el dueño de las cuentas creadas es el fixture acordado, no un userId de HTTP", async () => {
    const created = await fetch(`${ctx.baseURL}/api/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            name: "Fixture Owner",
            type: "DEBIT",
            userId: "usuario-malicioso",
        }),
    });
    assert.equal(created.status, 201);
    const account = (await created.json()) as { userId: string };
    assert.equal(account.userId, DEMO_FIXTURE_USER_ID);
});

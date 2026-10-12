// T2 (R9, R12): middlewares Express y continuidad legacy.
// health exacto, users legacy, CSV semilla, JSON malformado 4xx,
// CORS con origen específico, headers Helmet, gzip negociado,
// 500 sin secretos y arranque de cluster con almacenes aislados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startTestApp, ExplodingAccountRepository, readJson } from "./helpers.js";

// Puerto libre efímero para no chocar con ejecuciones concurrentes/previas
// (el puerto fijo 3977 causaba fallos intermitentes del test de cluster).
async function getFreePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address === null || typeof address === "string") {
                reject(new Error("no se pudo obtener un puerto libre"));
                return;
            }
            const { port } = address;
            server.close(() => {
                resolve(port);
            });
        });
    });
}

// Una conexión nueva por petición (agent:false) para que el round-robin del
// cluster reparta entre workers; con keep-alive las peticiones reutilizan el
// socket y todas caen en el mismo worker.
function getStatusCode(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const request = http.get(url, { agent: false }, (response) => {
            response.resume();
            response.on("end", () => {
                resolve(response.statusCode ?? 0);
            });
        });
        request.on("error", reject);
    });
}

let ctx: Awaited<ReturnType<typeof startTestApp>>;

before(async () => {
    ctx = await startTestApp();
});

after(async () => {
    await ctx.close();
});

void test("GET /api/health responde 200 con el cuerpo exacto {status:'ok'}", async () => {
    const response = await fetch(`${ctx.baseURL}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
});

void test("CRUD legacy /api/users sigue operativo sobre Express", async () => {
    const created = await fetch(`${ctx.baseURL}/api/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ana@example.com", name: "Ana" }),
    });
    assert.equal(created.status, 201);
    const user = (await created.json()) as { id: string };
    assert.ok(user.id);

    const list = await fetch(`${ctx.baseURL}/api/users`);
    assert.equal(list.status, 200);
    const users = (await list.json()) as { id: string }[];
    assert.ok(users.some((u) => u.id === user.id));

    const detail = await fetch(`${ctx.baseURL}/api/users/${user.id}`);
    assert.equal(detail.status, 200);

    const updated = await fetch(`${ctx.baseURL}/api/users/${user.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ana Updated" }),
    });
    assert.equal(updated.status, 200);

    const removed = await fetch(`${ctx.baseURL}/api/users/${user.id}`, {
        method: "DELETE",
    });
    assert.equal(removed.status, 204);

    const afterDelete = await fetch(`${ctx.baseURL}/api/users/${user.id}`);
    assert.equal(afterDelete.status, 404);
});

void test("GET /api/movements/export sirve el CSV de semilla heredada por stream", async () => {
    const response = await fetch(`${ctx.baseURL}/api/movements/export`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/csv/);
    const body = await response.text();
    // Cabecera CSV de la semilla heredada (no refleja el CRUD nuevo).
    assert.ok(body.length > 0);
    const firstLine = body.split("\n")[0] ?? "";
    assert.ok(firstLine.length > 0);
    // La semilla genera 500 movimientos: el CSV tiene muchas filas.
    assert.ok(body.split("\n").length > 100);
});

void test("JSON malformado responde 4xx sin modificar datos", async () => {
    const response = await fetch(`${ctx.baseURL}/api/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{invalid json",
    });
    assert.ok(response.status >= 400 && response.status < 500);

    // No se persistió nada: la lista sigue vacía.
    const list = await fetch(`${ctx.baseURL}/api/accounts`);
    assert.deepEqual(await list.json(), []);
});

void test("CORS permite el origen local http://localhost:3000 (específico, no *)", async () => {
    const allowed = await fetch(`${ctx.baseURL}/api/health`, {
        headers: { origin: "http://localhost:3000" },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:3000");

    const rejected = await fetch(`${ctx.baseURL}/api/health`, {
        headers: { origin: "http://evil.example.com" },
    });
    assert.equal(rejected.status, 200);
    // Origen no permitido: sin header de autorización CORS.
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
});

void test("Helmet añade headers de seguridad", async () => {
    const response = await fetch(`${ctx.baseURL}/api/health`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.ok(response.headers.get("x-frame-options"));
    assert.ok(response.headers.get("strict-transport-security"));
});

void test("gzip se negocia con Accept-Encoding y body suficiente; sin negociación no comprime", async () => {
    // El CSV de semilla (500 filas) supera el umbral de compresión.
    const compressed = await fetch(`${ctx.baseURL}/api/movements/export`, {
        headers: { "accept-encoding": "gzip" },
    });
    assert.equal(compressed.status, 200);
    assert.equal(compressed.headers.get("content-encoding"), "gzip");

    // http.get nativo NO envía accept-encoding: sin negociación, sin gzip.
    const encoding = await new Promise<string | undefined>((resolve, reject) => {
        const request = http.get(`${ctx.baseURL}/api/movements/export`, (res) => {
            resolve(res.headers["content-encoding"]);
            res.resume();
        });
        request.on("error", reject);
    });
    assert.equal(encoding, undefined);
});

void test("500 genérico no expone secretos ni trazas del error", async () => {
    const failing = await startTestApp({
        accountRepository: new ExplodingAccountRepository(),
    });
    try {
        const response = await fetch(`${failing.baseURL}/api/accounts/whatever`);
        assert.equal(response.status, 500);
        const body = await readJson(response);
        assert.deepEqual(body, { error: "internal_server_error" });
        const raw = JSON.stringify(body);
        assert.ok(!raw.includes("hunter2"), "la respuesta no expone el secreto inyectado");
        assert.ok(!raw.includes("secret"));
    } finally {
        await failing.close();
    }
});

void test("cluster arranca workers con health y CSV; cada worker con almacén aislado", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const port = await getFreePort();
    const child = spawn(process.execPath, ["--import", "tsx", "src/cluster.js"], {
        cwd: root,
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
    });
    try {
        // Espera a que health responda. Puerto efímero + margen amplio:
        // arrancar N workers (cada uno importando tsx) puede tardar bajo
        // carga, lo que antes provocaba fallos intermitentes con el puerto
        // fijo 3977 y solo 5 s de espera.
        let healthy = false;
        for (let i = 0; i < 300 && !healthy; i += 1) {
            try {
                const response = await fetch(`http://127.0.0.1:${String(port)}/api/health`);
                healthy = response.status === 200;
            } catch {
                // worker aún no listo
            }
            if (!healthy) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        assert.ok(healthy, "cluster health no respondió");

        const csv = await fetch(`http://127.0.0.1:${String(port)}/api/movements/export`);
        assert.equal(csv.status, 200);
        assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);

        // Cuenta creada por HTTP (queda en el worker que atendió la petición).
        const created = await fetch(`http://127.0.0.1:${String(port)}/api/accounts`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Cluster Probe", type: "DEBIT" }),
        });
        assert.equal(created.status, 201);
        const account = (await created.json()) as { id: string };

        // Aislamiento: cada worker tiene su propio almacén. Usamos conexiones
        // nuevas (getStatusCode) para forzar el reparto round-robin del
        // cluster; con keep-alive todas las peticiones irían al mismo worker
        // y el chequeo sería no determinista. Con 2×N intentos se cubre cada
        // worker al menos una vez (N = CPUs), así que se ven el 200 del worker
        // creador y algún 404 de un worker ajeno.
        const attempts = Math.max(os.cpus().length * 2, 8);
        let sawVisible = false;
        let sawNotFound = false;
        for (let i = 0; i < attempts; i += 1) {
            const status = await getStatusCode(`http://127.0.0.1:${String(port)}/api/accounts/${account.id}`);
            if (status === 200) {
                sawVisible = true;
            }
            if (status === 404) {
                sawNotFound = true;
            }
        }
        assert.ok(sawVisible, "la cuenta es visible en su worker");
        if (os.cpus().length > 1) {
            assert.ok(sawNotFound, "con varios workers, al menos uno no ve la cuenta (aislamiento)");
        }
    } finally {
        child.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
});

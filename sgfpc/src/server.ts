import { createApp } from "./presentation/app.js";
import { createMemoryRepositories } from "./infrastructure/memory/index.js";

const port = Number(process.env.PORT ?? 3000);

const { accountRepository, movementRepository, installmentPurchaseRepository, unitOfWork } = createMemoryRepositories();

const app = createApp({
    accountRepository,
    movementRepository,
    installmentPurchaseRepository,
    unitOfWork,
});

const server = app.listen(port, () => {
    console.log(`[server] API (Express) listening on http://localhost:${String(port)} (pid ${String(process.pid)})`);
});

function shutdown(signal: string): void {
    console.log(`[server] received ${signal}, closing gracefully (pid ${String(process.pid)})`);
    server.close(() => {
        console.log(`[server] closed (pid ${String(process.pid)})`);
        process.exit(0);
    });

    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => {
    shutdown("SIGTERM");
});
process.on("SIGINT", () => {
    shutdown("SIGINT");
});

export { server };

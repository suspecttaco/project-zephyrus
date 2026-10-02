import { createServer } from "http";
import { router } from "./router.js";
import { logRequest } from "./middlewares/logger.js";

const port = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
    const start = Date.now();
    res.on("finish", () => {
        logRequest(req, res, start);
    });
    router(req, res).catch((error: unknown) => {
        console.error("[server] unhandled router error:", error);
        if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
        }
        res.end(JSON.stringify({ error: "internal_server_error" }));
    });
});

server.listen(port, () => {
    console.log(`[server] API listening on http://localhost:${String(port)} (pid ${String(process.pid)})`);
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

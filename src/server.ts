import { createServer } from "http";
import { router } from "./router.js";
import { logRequest } from "./middlewares/logger.js";

const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (req, res) => {
    const start = Date.now();
    res.on("finish", () => logRequest(req, res, start));
    await router(req, res);
})


server.listen(port, () => {
    console.log(`[server] API listening on http://localhost:${port} (pid ${process.pid})`);
});

function shutdown(signal: string): void {
    console.log(`[server] received ${signal}, closing gracefully (pid ${process.pid})`);
    server.close(() => {
        console.log(`[server] closed (pid ${process.pid})`);
        process.exit(0);
    });

    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { server };

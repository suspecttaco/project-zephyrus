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
    console.log(`[server] API listening on http://localhost:${port}`);
});
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import { buildMovementsSeed } from "../../data/movements-seed.js";
import { createUser, deleteUser, getUser, listUsers, updateUser } from "../../handlers/users.js";
import { createCsvTransform, CSV_HEADER } from "../../streams/csv-transform.js";

export function createLegacyRouter(): Router {
    const router = Router();

    router.get("/api/health", (_req, res) => {
        res.status(200).json({ status: "ok" });
    });

    router.get("/api/users", (_req, res) => {
        res.status(200).json(listUsers());
    });

    router.get("/api/users/:id", (req, res) => {
        const user: unknown = getUser(req.params.id);
        if (!user) {
            res.status(404).json({ error: "user_not_found" });
            return;
        }
        res.status(200).json(user);
    });

    router.post("/api/users", (req, res) => {
        const result = createUser(req.body as Record<string, unknown>);
        if (result.error) {
            res.status(400).json({ errors: result.error });
            return;
        }
        res.status(201).json(result.data);
    });

    router.put("/api/users/:id", (req, res) => {
        const result = updateUser(req.params.id, req.body as Record<string, unknown>);
        if (result.notFound) {
            res.status(404).json({ error: "user_not_found" });
            return;
        }
        if (result.error) {
            res.status(400).json({ errors: result.error });
            return;
        }
        res.status(200).json(result.data);
    });

    router.delete("/api/users/:id", (req, res) => {
        const deleted = deleteUser(req.params.id);
        if (!deleted) {
            res.status(404).json({ error: "user_not_found" });
            return;
        }
        res.status(204).end();
    });

    router.get("/api/movements/export", async (_req, res, next) => {
        try {
            res.status(200);
            res.setHeader("content-type", "text/csv");
            res.setHeader("content-disposition", "attachment; filename=movements.csv");
            res.write(CSV_HEADER);

            const movements = buildMovementsSeed(500);
            const source = Readable.from(movements, { objectMode: true });
            const csv = createCsvTransform();
            await pipeline(source, csv, res);
        } catch (error) {
            next(error);
        }
    });

    return router;
}

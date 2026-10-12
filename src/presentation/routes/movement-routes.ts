import { Router } from "express";
import { MovementsController } from "../controllers/movements-controller.js";
import type { MovementsControllerDependencies } from "../controllers/movements-controller.js";

export function createMovementRouter(deps: MovementsControllerDependencies): Router {
    const controller = new MovementsController(deps);
    const router = Router();

    router.get("/api/accounts/:accountId/movements", controller.list);
    router.get("/api/accounts/:accountId/movements/:movementId", controller.get);
    router.post("/api/accounts/:accountId/movements", controller.create);
    router.put("/api/accounts/:accountId/movements/:movementId", controller.update);
    router.delete("/api/accounts/:accountId/movements/:movementId", controller.delete);

    return router;
}

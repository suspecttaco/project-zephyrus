import { Router } from "express";
import { AccountsController } from "../controllers/accounts-controller.js";
import type { AccountsControllerDependencies } from "../controllers/accounts-controller.js";

export function createAccountRouter(deps: AccountsControllerDependencies): Router {
    const controller = new AccountsController(deps);
    const router = Router();

    router.get("/api/accounts", controller.list);
    router.get("/api/accounts/:id", controller.get);
    router.post("/api/accounts", controller.create);
    router.put("/api/accounts/:id", controller.update);
    router.delete("/api/accounts/:id", controller.delete);

    return router;
}

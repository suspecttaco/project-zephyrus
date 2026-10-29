import { Router } from "express";
import { InstallmentPurchasesController } from "../controllers/installment-purchases-controller.js";
import type { InstallmentPurchasesControllerDependencies } from "../controllers/installment-purchases-controller.js";

export function createInstallmentPurchaseRouter(deps: InstallmentPurchasesControllerDependencies): Router {
    const controller = new InstallmentPurchasesController(deps);
    const router = Router();

    router.post("/api/installment-purchases/:id/cancel", controller.cancel);

    return router;
}

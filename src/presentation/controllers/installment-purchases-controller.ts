import type { Request, Response } from "express";
import type { CancelInstallmentPurchase } from "../../application/use-cases/cancel-installment-purchase.js";
import type { RequestContext } from "../../application/request-context.js";
import type { UnitOfWork } from "../../application/unit-of-work.js";
import { asyncHandler } from "../http.js";
import { serializeInstallmentPurchase } from "../serializers.js";
import { requireParam } from "../validation.js";

export interface InstallmentPurchasesControllerDependencies {
    cancelInstallmentPurchase: CancelInstallmentPurchase;
    unitOfWork: UnitOfWork;
    context: RequestContext;
}

export class InstallmentPurchasesController {
    private readonly cancelInstallmentPurchase: CancelInstallmentPurchase;

    constructor(private readonly deps: InstallmentPurchasesControllerDependencies) {
        this.cancelInstallmentPurchase = deps.cancelInstallmentPurchase;
    }

    cancel = asyncHandler(async (req: Request, res: Response) => {
        const purchase = await this.deps.unitOfWork.run(() =>
            this.cancelInstallmentPurchase.execute({
                purchaseId: requireParam(req, "id"),
                context: this.deps.context,
            }),
        );
        res.status(200).json(serializeInstallmentPurchase(purchase));
    });
}

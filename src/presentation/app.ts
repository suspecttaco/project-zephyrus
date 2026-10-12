import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import { logRequest } from "../middlewares/logger.js";
import { demoContext } from "../application/request-context.js";
import { directUnitOfWork } from "../application/unit-of-work.js";
import type { UnitOfWork } from "../application/unit-of-work.js";
import type { RequestContext } from "../application/request-context.js";
import type { IAccountRepository } from "../domain/repositories/account-repository.js";
import type { IInstallmentPurchaseRepository } from "../domain/repositories/installment-purchase-repository.js";
import type { IMovementRepository } from "../domain/repositories/movement-repository.js";
import { CancelInstallmentPurchase } from "../application/use-cases/cancel-installment-purchase.js";
import { CreateAccount } from "../application/use-cases/create-account.js";
import { DeleteAccount } from "../application/use-cases/delete-account.js";
import { DeleteMovement } from "../application/use-cases/delete-movement.js";
import { GetAccount } from "../application/use-cases/get-account.js";
import { GetMovement, ListAccountMovements } from "../application/use-cases/list-account-movements.js";
import { ListAccounts } from "../application/use-cases/list-accounts.js";
import { RegisterMovement } from "../application/use-cases/register-movement.js";
import { UpdateAccount } from "../application/use-cases/update-account.js";
import { UpdateMovement } from "../application/use-cases/update-movement.js";
import type { AccountsControllerDependencies } from "./controllers/accounts-controller.js";
import type { InstallmentPurchasesControllerDependencies } from "./controllers/installment-purchases-controller.js";
import type { MovementsControllerDependencies } from "./controllers/movements-controller.js";
import { errorToResponse } from "./http.js";
import { createAccountRouter } from "./routes/account-routes.js";
import { createInstallmentPurchaseRouter } from "./routes/installment-purchase-routes.js";
import { createLegacyRouter } from "./routes/legacy-routes.js";
import { createMovementRouter } from "./routes/movement-routes.js";

export const DEFAULT_CORS_ORIGIN = "http://localhost:3000";

export interface AppDependencies {
    accountRepository: IAccountRepository;
    movementRepository: IMovementRepository;
    installmentPurchaseRepository: IInstallmentPurchaseRepository;
    unitOfWork?: UnitOfWork;
    corsOrigin?: string;
    requestLogging?: boolean;
}

export function createApp(deps: AppDependencies): Express {
    const context: RequestContext = demoContext();
    const unitOfWork: UnitOfWork = deps.unitOfWork ?? directUnitOfWork;
    const requestLogging = deps.requestLogging ?? true;

    const app = express();

    if (requestLogging) {
        app.use((req: Request, res: Response, next: NextFunction) => {
            const start = Date.now();
            res.on("finish", () => {
                logRequest(req, res, start);
            });
            next();
        });
    }

    app.use(helmet());
    app.use(compression());

    const allowedOrigin = deps.corsOrigin ?? process.env.CORS_ORIGIN ?? DEFAULT_CORS_ORIGIN;
    app.use(
        cors({
            origin: (origin, callback) => {
                if (!origin || origin === allowedOrigin) {
                    callback(null, true);
                } else {
                    callback(null, false);
                }
            },
        }),
    );
    app.use(express.json());

    app.use(createLegacyRouter());

    const accountDeps: AccountsControllerDependencies = {
        listAccounts: new ListAccounts(deps.accountRepository),
        getAccount: new GetAccount(deps.accountRepository),
        createAccount: new CreateAccount(deps.accountRepository),
        updateAccount: new UpdateAccount(deps.accountRepository),
        deleteAccount: new DeleteAccount(
            deps.accountRepository,
            deps.movementRepository,
            deps.installmentPurchaseRepository,
        ),
        unitOfWork,
        context,
    };

    const movementDeps: MovementsControllerDependencies = {
        listAccountMovements: new ListAccountMovements(deps.movementRepository, deps.accountRepository),
        getMovement: new GetMovement(deps.movementRepository, deps.accountRepository),
        registerMovement: new RegisterMovement(deps.movementRepository, deps.accountRepository),
        updateMovement: new UpdateMovement(deps.movementRepository, deps.accountRepository),
        deleteMovement: new DeleteMovement(deps.movementRepository, deps.accountRepository),
        unitOfWork,
        context,
    };

    const installmentPurchaseDeps: InstallmentPurchasesControllerDependencies = {
        cancelInstallmentPurchase: new CancelInstallmentPurchase(
            deps.installmentPurchaseRepository,
            deps.movementRepository,
            deps.accountRepository,
        ),
        unitOfWork,
        context,
    };

    app.use(createAccountRouter(accountDeps));
    app.use(createMovementRouter(movementDeps));
    app.use(createInstallmentPurchaseRouter(installmentPurchaseDeps));

    app.use((_req: Request, res: Response) => {
        res.status(404).json({ error: "not_found" });
    });

    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        const { status, code } = errorToResponse(error);
        if (status >= 500) {
            console.error("[api] unhandled error:", error);
        }
        res.status(status).json({ error: code });
    });

    return app;
}

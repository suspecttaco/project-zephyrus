import type { Request, Response } from "express";
import type { CreateAccount } from "../../application/use-cases/create-account.js";
import type { DeleteAccount } from "../../application/use-cases/delete-account.js";
import type { GetAccount } from "../../application/use-cases/get-account.js";
import type { ListAccounts } from "../../application/use-cases/list-accounts.js";
import type { AccountChanges, UpdateAccount } from "../../application/use-cases/update-account.js";
import type { RequestContext } from "../../application/request-context.js";
import type { UnitOfWork } from "../../application/unit-of-work.js";
import { asyncHandler } from "../http.js";
import { serializeAccount } from "../serializers.js";
import {
    isObjectBody,
    optionalIntegerInRange,
    optionalPositiveInteger,
    requireAccountType,
    requireNonEmptyString,
    requireParam,
    requirePositiveInteger,
} from "../validation.js";

export interface AccountsControllerDependencies {
    listAccounts: ListAccounts;
    getAccount: GetAccount;
    createAccount: CreateAccount;
    updateAccount: UpdateAccount;
    deleteAccount: DeleteAccount;
    unitOfWork: UnitOfWork;
    context: RequestContext;
}

export class AccountsController {
    private readonly listAccounts: ListAccounts;
    private readonly getAccount: GetAccount;
    private readonly createAccount: CreateAccount;
    private readonly updateAccount: UpdateAccount;
    private readonly deleteAccount: DeleteAccount;

    constructor(private readonly deps: AccountsControllerDependencies) {
        this.listAccounts = deps.listAccounts;
        this.getAccount = deps.getAccount;
        this.createAccount = deps.createAccount;
        this.updateAccount = deps.updateAccount;
        this.deleteAccount = deps.deleteAccount;
    }

    list = asyncHandler(async (_req: Request, res: Response) => {
        const accounts = await this.listAccounts.execute(this.deps.context);
        res.status(200).json(accounts.map(serializeAccount));
    });

    get = asyncHandler(async (req: Request, res: Response) => {
        const account = await this.getAccount.execute({
            accountId: requireParam(req, "id"),
            context: this.deps.context,
        });
        res.status(200).json(serializeAccount(account));
    });

    create = asyncHandler(async (req: Request, res: Response) => {
        const body = isObjectBody(req.body);
        const name = requireNonEmptyString(body.name);
        const type = requireAccountType(body.type);
        const creditLimitInCents = optionalPositiveInteger(body.creditLimitInCents);
        const cutOffDay = optionalIntegerInRange(body.cutOffDay, 1, 31);

        const account = await this.deps.unitOfWork.run(() =>
            this.createAccount.execute({
                userId: this.deps.context.ownerUserId,
                name,
                type,
                creditLimitInCents,
                cutOffDay: cutOffDay ?? undefined,
            }),
        );

        res.status(201).json(serializeAccount(account));
    });

    update = asyncHandler(async (req: Request, res: Response) => {
        const body = isObjectBody(req.body);
        const name = requireNonEmptyString(body.name);

        const changes: AccountChanges = { name };
        if (body.creditLimitInCents !== undefined) {
            const limit = body.creditLimitInCents;
            changes.creditLimitInCents = limit === null ? null : requirePositiveInteger(limit);
        }
        if (body.cutOffDay !== undefined) {
            changes.cutOffDay = optionalIntegerInRange(body.cutOffDay, 1, 31) ?? null;
        }

        const requestedType = body.type === undefined ? undefined : requireAccountType(body.type);

        const account = await this.deps.unitOfWork.run(() =>
            this.updateAccount.execute({
                accountId: requireParam(req, "id"),
                context: this.deps.context,
                changes,
                requestedType,
            }),
        );

        res.status(200).json(serializeAccount(account));
    });

    delete = asyncHandler(async (req: Request, res: Response) => {
        await this.deps.unitOfWork.run(() =>
            this.deleteAccount.execute({
                accountId: requireParam(req, "id"),
                context: this.deps.context,
            }),
        );
        res.status(204).end();
    });
}

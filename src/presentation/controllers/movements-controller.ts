import type { Request, Response } from "express";
import type { DeleteMovement } from "../../application/use-cases/delete-movement.js";
import type { MovementEditInput, UpdateMovement } from "../../application/use-cases/update-movement.js";
import type { GetMovement, ListAccountMovements } from "../../application/use-cases/list-account-movements.js";
import type { RegisterMovement } from "../../application/use-cases/register-movement.js";
import type { RequestContext } from "../../application/request-context.js";
import type { UnitOfWork } from "../../application/unit-of-work.js";
import { asyncHandler } from "../http.js";
import { serializeMovement } from "../serializers.js";
import {
    isObjectBody,
    optionalMovementCategory,
    optionalString,
    parseIsoDate,
    parseOptionalIsoDate,
    requireMovementType,
    requireParam,
    requirePositiveInteger,
    requireString,
} from "../validation.js";

export interface MovementsControllerDependencies {
    listAccountMovements: ListAccountMovements;
    getMovement: GetMovement;
    registerMovement: RegisterMovement;
    updateMovement: UpdateMovement;
    deleteMovement: DeleteMovement;
    unitOfWork: UnitOfWork;
    context: RequestContext;
}

export class MovementsController {
    private readonly listAccountMovements: ListAccountMovements;
    private readonly getMovement: GetMovement;
    private readonly registerMovement: RegisterMovement;
    private readonly updateMovement: UpdateMovement;
    private readonly deleteMovement: DeleteMovement;

    constructor(private readonly deps: MovementsControllerDependencies) {
        this.listAccountMovements = deps.listAccountMovements;
        this.getMovement = deps.getMovement;
        this.registerMovement = deps.registerMovement;
        this.updateMovement = deps.updateMovement;
        this.deleteMovement = deps.deleteMovement;
    }

    list = asyncHandler(async (req: Request, res: Response) => {
        const movements = await this.listAccountMovements.execute({
            accountId: requireParam(req, "accountId"),
            context: this.deps.context,
        });
        res.status(200).json(movements.map(serializeMovement));
    });

    get = asyncHandler(async (req: Request, res: Response) => {
        const movement = await this.getMovement.execute({
            accountId: requireParam(req, "accountId"),
            movementId: requireParam(req, "movementId"),
            context: this.deps.context,
        });
        res.status(200).json(serializeMovement(movement));
    });

    create = asyncHandler(async (req: Request, res: Response) => {
        const body = isObjectBody(req.body);
        const type = requireMovementType(body.type);
        const amountInCents = requirePositiveInteger(body.amountInCents);
        const description = requireString(body.description);
        const category = optionalMovementCategory(body.category);
        const destinationAccountId = optionalString(body.destinationAccountId);
        const date = parseOptionalIsoDate(body.date);

        const movement = await this.deps.unitOfWork.run(() =>
            this.registerMovement.execute({
                accountId: requireParam(req, "accountId"),
                type,
                amountInCents,
                category,
                description,
                destinationAccountId,
                date,
                context: this.deps.context,
            }),
        );

        res.status(201).json(serializeMovement(movement));
    });

    update = asyncHandler(async (req: Request, res: Response) => {
        const body = isObjectBody(req.body);
        const amountInCents = requirePositiveInteger(body.amountInCents);
        const type = requireMovementType(body.type);
        const accountId = requireString(body.accountId);
        const description = requireString(body.description);
        const date = parseIsoDate(body.date);
        const category = optionalMovementCategory(body.category);
        const destinationAccountId = optionalString(body.destinationAccountId);

        const edit: MovementEditInput = {
            amountInCents,
            type,
            accountId,
            destinationAccountId,
            date,
            category,
            description,
        };

        const movement = await this.deps.unitOfWork.run(() =>
            this.updateMovement.execute({
                accountId: requireParam(req, "accountId"),
                movementId: requireParam(req, "movementId"),
                context: this.deps.context,
                edit,
            }),
        );

        res.status(200).json(serializeMovement(movement));
    });

    delete = asyncHandler(async (req: Request, res: Response) => {
        await this.deps.unitOfWork.run(() =>
            this.deleteMovement.execute({
                accountId: requireParam(req, "accountId"),
                movementId: requireParam(req, "movementId"),
                context: this.deps.context,
            }),
        );
        res.status(204).end();
    });
}

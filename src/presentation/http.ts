import type { Request, RequestHandler, Response } from "express";
import {
    BusinessConflictError,
    CreditLimitExceededError,
    DomainValidationError,
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    InvalidInstallmentPurchaseError,
    InvalidMovementAmountError,
    InvalidTransferError,
    NegativeBalanceError,
    NotFoundError,
} from "../domain/errors.js";

export class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
    ) {
        super(code);
        this.name = "HttpError";
    }
}

export interface ErrorResponse {
    status: number;
    code: string;
}

export function errorToResponse(error: unknown): ErrorResponse {
    if (error instanceof Error && "status" in error) {
        const status = (error as { status: unknown }).status;
        if (typeof status === "number" && status >= 400 && status < 500) {
            return { status, code: "invalid_request" };
        }
    }

    if (error instanceof NotFoundError) {
        return { status: 404, code: "not_found" };
    }

    if (
        error instanceof BusinessConflictError ||
        error instanceof NegativeBalanceError ||
        error instanceof CreditLimitExceededError ||
        error instanceof InvalidInstallmentPurchaseError ||
        error instanceof EmailAlreadyRegisteredError ||
        error instanceof InvalidCredentialsError
    ) {
        return { status: 409, code: "conflict" };
    }

    if (
        error instanceof DomainValidationError ||
        error instanceof InvalidMovementAmountError ||
        error instanceof InvalidTransferError
    ) {
        return { status: 400, code: "invalid_request" };
    }

    return { status: 500, code: "internal_server_error" };
}

export function asyncHandler(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
    return (req, res, next) => {
        Promise.resolve(handler(req, res)).catch(next);
    };
}

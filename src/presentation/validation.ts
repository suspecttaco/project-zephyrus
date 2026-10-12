import type { Request } from "express";
import type { AccountType, MovementCategory, MovementType } from "../domain/enums.js";
import {
    AccountType as AccountTypeEnum,
    MovementCategory as MovementCategoryEnum,
    MovementType as MovementTypeEnum,
} from "../domain/enums.js";
import { HttpError } from "./http.js";

export function isObjectBody(body: unknown): Record<string, unknown> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new HttpError(400, "invalid_request");
    }
    return body as Record<string, unknown>;
}

export function requireParam(req: Request, name: string): string {
    const value = req.params[name];
    if (typeof value !== "string" || value.length === 0) {
        throw new HttpError(400, "invalid_request");
    }
    return value;
}

export function requireNonEmptyString(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new HttpError(400, "invalid_request");
    }
    return value;
}

export function requireString(value: unknown): string {
    if (typeof value !== "string") {
        throw new HttpError(400, "invalid_request");
    }
    return value;
}

export function optionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    return requireString(value);
}

export function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function requirePositiveInteger(value: unknown): number {
    if (!isPositiveInteger(value)) {
        throw new HttpError(400, "invalid_request");
    }
    return value;
}

export function isIntegerInRange(value: unknown, min: number, max: number): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function parseEnum<T extends Record<string, string>>(enumObject: T, value: unknown): T[keyof T] {
    if (typeof value !== "string" || !Object.values(enumObject).includes(value)) {
        throw new HttpError(400, "invalid_request");
    }
    return value as T[keyof T];
}

export function parseOptionalIsoDate(value: unknown): Date | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
        throw new HttpError(400, "invalid_request");
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new HttpError(400, "invalid_request");
    }
    return parsed;
}

export function parseIsoDate(value: unknown): Date {
    const parsed = parseOptionalIsoDate(value);
    if (parsed === undefined) {
        throw new HttpError(400, "invalid_request");
    }
    return parsed;
}

export function requireAccountType(value: unknown): AccountType {
    return parseEnum(AccountTypeEnum, value);
}

export function requireMovementType(value: unknown): MovementType {
    return parseEnum(MovementTypeEnum, value);
}

export function optionalMovementCategory(value: unknown): MovementCategory | undefined {
    if (value === undefined || value === null) return undefined;
    return parseEnum(MovementCategoryEnum, value);
}

export function optionalPositiveInteger(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    return requirePositiveInteger(value);
}

export function optionalIntegerInRange(value: unknown, min: number, max: number): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (!isIntegerInRange(value, min, max)) {
        throw new HttpError(400, "invalid_request");
    }
    return value;
}

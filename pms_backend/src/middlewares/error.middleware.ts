import { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
    constructor(public readonly statusCode: number, message: string) {
        super(message);
    }
}

export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
    next(new HttpError(404, `Ruta no encontrada: ${req.method} ${req.originalUrl}`));
};

export const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
        next(err);
        return;
    }

    let statusCode: number = err.statusCode || err.status || 500;
    let message: string = err.message || 'Error interno del servidor';
    if (err.type === 'entity.parse.failed') {
        statusCode = 400;
        message = 'El cuerpo de la petición no es un JSON válido';
    } else if (err.type === 'entity.too.large') {
        statusCode = 413;
        message = 'El cuerpo de la petición es demasiado grande';
    }

    if (statusCode >= 500) {
        console.error(`[ERROR] ${req.method} ${req.originalUrl}: ${err.stack || err.message}`);
        if (process.env.NODE_ENV === 'production') message = 'Error interno del servidor';
    }

    res.status(statusCode).json({
        statusCode,
        status: 'error',
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

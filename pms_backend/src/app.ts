import express, { Express, Request, Response } from "express";
import bodyParser from "body-parser";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { Routes } from "./routes";
import { globalErrorHandler, notFoundHandler } from "./middlewares/error.middleware";

export interface AppOptions {
    rateLimit?: { windowMs?: number; max?: number; loginMax?: number };
    compressionThreshold?: number;
    extend?: (app: Express) => void;
}

const rateLimitMessage = { statusCode: 429, status: 'error', message: 'Demasiadas solicitudes desde esta IP, intente más tarde.' };

export function createApp(options: AppOptions = {}): Express {
    const app: Express = express();
    app.disable('x-powered-by');

    app.use(helmet());
    app.use(compression({ threshold: options.compressionThreshold ?? 1024 }));

    const limits = options.rateLimit;
    if (limits || process.env.RATE_LIMIT_DISABLED !== 'true') {
        const windowMs = limits?.windowMs ?? (Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000);
        app.use('/api/', rateLimit({
            windowMs, limit: limits?.max ?? (Number(process.env.RATE_LIMIT_MAX) || 1000),
            standardHeaders: true, legacyHeaders: false, message: rateLimitMessage
        }));
        const credentials = rateLimit({
            windowMs, limit: limits?.loginMax ?? (Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10),
            skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: rateLimitMessage
        });
        app.use(['/api/users/login', '/api/users/forgot-password', '/api/users/reset-password', '/api/users/refresh-token'], credentials);
    }

    app.use(bodyParser.urlencoded({ extended: false, limit: '50kb' }));
    app.use(bodyParser.json({ limit: '50kb' }));

    app.get('/ping', (req: Request, res: Response) => {
        res.send('pong');
    });

    new Routes(app);
    options.extend?.(app);

    app.use(notFoundHandler);
    app.use(globalErrorHandler);
    return app;
}

export const app: Express = createApp();

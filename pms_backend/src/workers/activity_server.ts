import express, { Express, NextFunction, Request, Response } from 'express';
import { ActivityStore } from '../engines/activity_store';

export function createActivityApp(store: ActivityStore, token = process.env.ACTIVITY_TOKEN): Express {
    const app = express();
    app.use(express.json({ limit: '100kb' }));

    app.use((req: Request, res: Response, next: NextFunction) => {
        if (token && req.headers['x-internal-token'] !== token) {
            res.status(401).json({ status: 'error', message: 'Token interno inválido' });
            return;
        }
        next();
    });

    app.post('/events', async (req: Request, res: Response) => {
        const { taskId, userId, action, details } = req.body ?? {};
        if (typeof taskId !== 'string' || !taskId || typeof action !== 'string' || !action) {
            res.status(400).json({ status: 'error', message: 'taskId y action son obligatorios' });
            return;
        }
        res.status(201).json({ status: 'success', data: await store.record(taskId, userId ?? null, action, details) });
    });

    app.get('/tasks/:taskId/events', async (req: Request, res: Response) => {
        const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 100, 1), 1000);
        const reverse = String(req.query.order).toLowerCase() === 'desc';
        res.json({ status: 'success', data: await store.getHistory(String(req.params.taskId), { limit, reverse }) });
    });

    app.get('/tasks/:taskId/last', async (req: Request, res: Response) => {
        const last = await store.getLast(String(req.params.taskId));
        if (!last) {
            res.status(404).json({ status: 'error', message: 'Sin actividad registrada' });
            return;
        }
        res.json({ status: 'success', data: last });
    });

    app.get('/stats', (req: Request, res: Response) => {
        res.json({ status: 'success', data: store.stats() });
    });

    return app;
}

import { Express } from "express";
import { param, query } from "express-validator";
import { AnalyticsController } from "./analytics_controller";
import { authorize } from "../../utils/auth_util";
import { validate } from "../../utils/validator";

export class AnalyticsRoutes {
    constructor(app: Express) {
        const c = new AnalyticsController();
        const id = param('id').isUUID().withMessage('El identificador debe ser un UUID válido');

        app.get('/api/analytics/projects/:id/metrics', authorize, validate([id]), c.metricsHandler);
        app.get('/api/analytics/projects/:id/risk', authorize, validate([id]), c.riskHandler);
        app.get('/api/analytics/throughput', authorize, validate([
            query('project_id').optional().isUUID().withMessage('project_id debe ser un UUID válido')
        ]), c.throughputHandler);
        app.get('/api/tasks/:id/history', authorize, validate([id]), c.historyHandler);
        app.get('/api/tasks/:id/at', authorize, validate([id]), c.stateAtHandler);
    }
}

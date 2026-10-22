import { Express, Request, Response } from "express";
import { dbConnection } from "../../config/database_connection";
import { CacheUtil } from "../../utils/cache_util";
import { RabbitMQConnection } from "../../messaging/rabbitmq_connection";
import { eventLoopSnapshot } from "../../utils/event_loop_monitor";
import { RiskAnalysisService } from "../../services/risk_service";

export class HealthRoutes {
    constructor(app: Express) {
        app.get('/api/health', async (req: Request, res: Response) => {
            let postgres = false;
            try {
                await dbConnection.getPool().query('SELECT 1');
                postgres = true;
            } catch {
                postgres = false;
            }
            const redis = CacheUtil.isAvailable();
            const rabbitmq = RabbitMQConnection.isEnabled() ? RabbitMQConnection.getInstance().isConnected() : null;
            res.status(postgres ? 200 : 503).json({
                status: postgres ? 'ok' : 'degraded', postgres, redis, rabbitmq,
                event_loop: eventLoopSnapshot(),
                worker_pool: RiskAnalysisService.poolStats()
            });
        });
    }
}

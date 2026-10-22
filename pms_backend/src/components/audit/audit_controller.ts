import { Request, Response } from "express";
import { DatabaseUtil } from "../../utils/db";
import { hasPermission } from "../../utils/auth_util";
import { AuditEvents } from "./audit_entity";

export class AuditController {
    public async listHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_audit_events')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar la auditoría' });
            return;
        }

        const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 500);
        const qb = new DatabaseUtil().getRepository(AuditEvents).createQueryBuilder('e')
            .orderBy('e.occurred_at', 'DESC')
            .addOrderBy('e.event_id', 'ASC')
            .take(limit);
        if (req.query.task_id) qb.andWhere('e.task_id = :taskId', { taskId: String(req.query.task_id) });
        if (req.query.type) qb.andWhere('e.routing_key = :type', { type: String(req.query.type) });
        if (req.query.user_id) qb.andWhere('e.user_id = :userId', { userId: String(req.query.user_id) });

        try {
            const events = await qb.getMany();
            res.status(200).json({ statusCode: 200, status: 'success', data: events });
        } catch (error: any) {
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }
}

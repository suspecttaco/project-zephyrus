import { Express } from "express";
import { query } from "express-validator";
import { AuditController } from "./audit_controller";
import { authorize } from "../../utils/auth_util";
import { validate } from "../../utils/validator";

export class AuditRoutes {
    private baseEndPoint = '/api/audit/events';

    constructor(app: Express) {
        const controller = new AuditController();
        app.get(this.baseEndPoint, authorize, validate([
            query('task_id').optional().isUUID().withMessage('task_id debe ser un UUID válido'),
            query('user_id').optional().isUUID().withMessage('user_id debe ser un UUID válido'),
            query('type').optional().matches(/^[a-z_.]{1,100}$/).withMessage('type debe ser una clave de enrutamiento como task.event.created')
        ]), controller.listHandler);
    }
}

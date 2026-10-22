import { Express } from "express";
import { TaskController } from "./tasks_controller";
import { TaskWorkflowController } from "./task_workflow_controller";
import { authorize } from "../../utils/auth_util";
import { validate } from "../../utils/validator";
import bodyParser from "body-parser";
import { body, param } from "express-validator";
import { Status, Priority } from "./tasks_entity";

const validTaskInput = [
    body('name').trim().notEmpty().withMessage('El nombre de la tarea es obligatorio')
        .isLength({ min: 3, max: 30 }).withMessage('El nombre debe contener entre 3 y 30 caracteres'),
    body('project_id').isUUID().withMessage('El proyecto es obligatorio y debe ser un UUID válido'),
    body('user_id').isUUID().withMessage('El usuario asignado es obligatorio y debe ser un UUID válido'),
    body('status').optional().isIn(Object.values(Status)).withMessage(`Estado inválido. Valores permitidos: ${Object.values(Status).join(', ')}`),
    body('priority').optional().isIn(Object.values(Priority)).withMessage(`Prioridad inválida. Valores permitidos: ${Object.values(Priority).join(', ')}`),
    body('estimated_start_time').optional().isISO8601().withMessage('Fecha de inicio estimada inválida'),
    body('estimated_end_time').optional().isISO8601().withMessage('Fecha de fin estimada inválida')
        .custom((end, { req }) => {
            if (end && req.body.estimated_start_time && new Date(end) <= new Date(req.body.estimated_start_time)) {
                throw new Error('La fecha de fin estimada debe ser estrictamente posterior a la de inicio');
            }
            return true;
        })
];

const validTaskUpdate = [
    body('name').optional().trim().notEmpty().withMessage('El nombre de la tarea no puede estar vacío')
        .isLength({ min: 3, max: 30 }).withMessage('El nombre debe contener entre 3 y 30 caracteres'),
    body('project_id').optional().isUUID().withMessage('El proyecto debe ser un UUID válido'),
    body('user_id').optional().isUUID().withMessage('El usuario asignado debe ser un UUID válido'),
    body('status').optional().isIn(Object.values(Status)).withMessage(`Estado inválido. Valores permitidos: ${Object.values(Status).join(', ')}`),
    body('priority').optional().isIn(Object.values(Priority)).withMessage(`Prioridad inválida. Valores permitidos: ${Object.values(Priority).join(', ')}`),
    body('estimated_start_time').optional().isISO8601().withMessage('Fecha de inicio estimada inválida'),
    body('estimated_end_time').optional().isISO8601().withMessage('Fecha de fin estimada inválida')
        .custom((end, { req }) => {
            if (end && req.body.estimated_start_time && new Date(end) <= new Date(req.body.estimated_start_time)) {
                throw new Error('La fecha de fin estimada debe ser estrictamente posterior a la de inicio');
            }
            return true;
        })
];

const validTaskId = [param('id').isUUID().withMessage('El identificador de la tarea no es un UUID válido')];

const validStatusInput = [
    ...validTaskId,
    body('status').isIn(Object.values(Status)).withMessage(`Estado inválido. Valores permitidos: ${Object.values(Status).join(', ')}`)
];

export class TaskRoutes {
    private baseEndPoint = '/api/tasks';

    constructor(app: Express) {
        const controller = new TaskController();
        const workflow = new TaskWorkflowController();

        app.get(`${this.baseEndPoint}/:id/activity/last`, authorize, validate(validTaskId), controller.lastActivityHandler);
        app.get(`${this.baseEndPoint}/:id/activity`, authorize, validate(validTaskId), controller.activityHandler);
        app.get(`${this.baseEndPoint}/:id/cost`, authorize, validate(validTaskId), controller.costHandler);

        const rawFile = bodyParser.raw({ type: () => true, limit: '10mb' });
        app.route(`${this.baseEndPoint}/:id/attachments`)
            .get(authorize, validate(validTaskId), controller.listAttachmentsHandler)
            .post(authorize, validate(validTaskId), rawFile, controller.addAttachmentHandler);
        app.delete(`${this.baseEndPoint}/:id/attachments/:name`, authorize, validate(validTaskId), controller.deleteAttachmentHandler);

        app.post(`${this.baseEndPoint}/:id/workflow/:action`, authorize,
            validate([...validTaskId, param('action').isIn(['start', 'submit', 'approve']).withMessage('La acción debe ser start, submit o approve')]),
            workflow.actionHandler.bind(workflow));

        app.put(`${this.baseEndPoint}/:id/assign`, authorize,
            validate([...validTaskId, body('user_id').isUUID().withMessage('user_id debe ser un UUID válido')]),
            workflow.assignHandler.bind(workflow));
        app.post(`${this.baseEndPoint}/:id/assign/undo`, authorize, validate(validTaskId), workflow.undoAssignHandler.bind(workflow));

        app.route(`${this.baseEndPoint}/:id/status`)
            .put(authorize, validate(validStatusInput), controller.updateStatus);

        app.route(this.baseEndPoint)
            .get(authorize, controller.getAllHandler)
            .post(authorize, validate(validTaskInput), controller.addHandler);

        app.route(`${this.baseEndPoint}/:id`)
            .get(authorize, validate(validTaskId), controller.getDetailsHandler)
            .put(authorize, validate([...validTaskId, ...validTaskUpdate]), controller.updateHandler)
            .delete(authorize, validate(validTaskId), controller.deleteHandler);
    }
}
import { Express } from "express";
import { body, param } from "express-validator";
import { CommentController } from "./comments_controller";
import { authorize } from "../../utils/auth_util";
import { validate } from "../../utils/validator";

const validCommentId = [param('id').isUUID().withMessage('El identificador del comentario no es un UUID válido')];

const validCommentInput = [
    body('comment').trim().notEmpty().withMessage('El comentario es obligatorio'),
    body('task_id').isUUID().withMessage('La tarea es obligatoria y debe ser un UUID válido')
];

const validCommentUpdate = [
    ...validCommentId,
    body('comment').trim().notEmpty().withMessage('El comentario es obligatorio')
];

export class CommentRoutes {
    private baseEndPoint = '/api/comments';

    constructor(app: Express) {
        const controller = new CommentController();

        app.route(this.baseEndPoint)
            .get(authorize, controller.getAllHandler)
            .post(authorize, validate(validCommentInput), controller.addHandler);

        app.route(`${this.baseEndPoint}/:id`)
            .get(authorize, validate(validCommentId), controller.getDetailsHandler)
            .put(authorize, validate(validCommentUpdate), controller.updateHandler)
            .delete(authorize, validate(validCommentId), controller.deleteHandler);
    }
}

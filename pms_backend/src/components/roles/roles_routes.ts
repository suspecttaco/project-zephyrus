import { Express } from "express";
import { RoleController, RoleUtil } from "./roles_controller";
import { validate } from "../../utils/validator";
import { authorize } from "../../utils/auth_util";
import { body } from "express-validator";

const validRoleInput = [
    body('name').trim().notEmpty().withMessage('El nombre es obligatorio'),
    body('description').isLength({ max: 200 }).withMessage('La descripción supera el límite de 200 caracteres'),
    body('rights').custom((value: string) => {
        if (!value) return true;
        const accessRights = value.split(',');
        const validRights = RoleUtil.getAllPermissionsFromRights();
        const areAllRightsValid = accessRights.every(right => validRights.includes(right));
        if (!areAllRightsValid) {
            throw new Error('Permisos o derechos inválidos');
        }
        return true;
    })
];

export class RoleRoutes {
    private baseEndPoint = '/api/roles';

    constructor(app: Express) {
        const controller = new RoleController();

        app.route(this.baseEndPoint)
            .get(authorize, controller.getAllHandler)
            .post(authorize, validate(validRoleInput), controller.addHandler);

        app.route(`${this.baseEndPoint}/:id`)
            .get(authorize, controller.getDetailsHandler)
            .put(authorize, validate(validRoleInput), controller.updateHandler)
            .delete(authorize, controller.deleteHandler);
    }
}
import { Express } from "express";
import { UserController } from "./users_controller";
import { validate } from "../../utils/validator";
import { authorize } from "../../utils/auth_util";
import { body } from "express-validator";

const passwordRule = (field: string) => body(field)
    .isLength({ min: 6, max: 12 }).withMessage('La contraseña debe tener entre 6 y 12 caracteres')
    .isStrongPassword({ minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 })
    .withMessage('La contraseña debe incluir al menos una mayúscula, una minúscula, un número y un símbolo especial');

export const validUserInput = [
    body('fullname').trim().notEmpty().withMessage('El nombre completo es obligatorio'),
    body('username').trim().notEmpty().isLength({ min: 4, max: 30 }).withMessage('El usuario debe tener entre 4 y 30 caracteres'),
    body('email').isEmail().withMessage('Debe proporcionar un correo electrónico válido'),
    passwordRule('password'),
    body('role_ids').isArray().withMessage('Debe proporcionar un arreglo de UUIDs de roles válidos')
];

const validUserUpdate = [
    body('fullname').optional().trim().notEmpty().withMessage('El nombre completo no puede estar vacío'),
    body('username').optional().trim().isLength({ min: 4, max: 30 }).withMessage('El usuario debe tener entre 4 y 30 caracteres'),
    body('email').optional().isEmail().withMessage('Debe proporcionar un correo electrónico válido'),
    body('role_ids').optional().isArray().withMessage('Debe proporcionar un arreglo de UUIDs de roles válidos')
];

const validResetInput = [
    body('token').notEmpty().withMessage('El token es obligatorio'),
    passwordRule('password')
];

const validChangePasswordInput = [
    body('current_password').notEmpty().withMessage('La contraseña actual es obligatoria'),
    passwordRule('new_password')
];

export class UserRoutes {
    private baseEndPoint = '/api/users';

    constructor(app: Express) {
        const controller = new UserController();

        app.route(`${this.baseEndPoint}/login`)
            .post(controller.login);

        app.route(`${this.baseEndPoint}/forgot-password`)
            .post(controller.forgotPassword);

        app.route(`${this.baseEndPoint}/reset-password`)
            .post(validate(validResetInput), controller.resetPassword);

        app.route(`${this.baseEndPoint}/refresh-token`)
            .post(validate([body('refreshToken').notEmpty().withMessage('El refresh token es obligatorio')]), controller.refreshToken);

        app.route(`${this.baseEndPoint}/change-password`)
            .post(authorize, validate(validChangePasswordInput), controller.changePassword);

        app.route(this.baseEndPoint)
            .get(authorize, controller.getAllHandler)
            .post(authorize, validate(validUserInput), controller.addHandler);

        app.route(`${this.baseEndPoint}/:id`)
            .get(authorize, controller.getDetailsHandler)
            .put(authorize, validate([...validUserUpdate, passwordRule('password').optional()]), controller.updateHandler)
            .delete(authorize, controller.deleteHandler);
    }
}
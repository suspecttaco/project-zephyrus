import { Request, Response } from "express";
import * as jwt from "jsonwebtoken";
import { Users } from "./users_entity";
import { bcryptCompare, encryptString, SERVER_CONST } from "../../utils/common";
import { UserService } from "./users_service";
import { DatabaseUtil } from "../../utils/db";
import { hasPermission } from "../../utils/auth_util";
import { sendMail } from "../../utils/email_util";
import { CacheUtil } from "../../utils/cache_util";

export class UserController {
    public async login(req: Request, res: Response): Promise<void> {
        const {email, password} = req.body;
        const service = new UserService();

        const result = await service.findAll({email});
        if (!result.data || (result.data as Users[]).length === 0) {
            res.status(404).json({statusCode: 404, status: 'error', message: 'Correo electrónico no encontrado'});
            return;
        }

        const user = (result.data as Users[])[0];
        const isPasswordValid = await bcryptCompare(password, user.password);
        if (!isPasswordValid) {
            res.status(400).json({statusCode: 400, status: 'error', message: 'Contraseña incorrecta'});
            return;
        }

        const accessToken = UsersUtil.signToken(user, 'access', SERVER_CONST.ACCESS_TOKEN_EXPIRY_TIME_SECONDS);
        const refreshToken = UsersUtil.signToken(user, 'refresh', SERVER_CONST.REFRESH_TOKEN_EXPIRY_TIME_SECONDS);

        res.status(200).json({
            statusCode: 200,
            status: 'success',
            data: {accessToken, refreshToken}
        });
    }

    public async refreshToken(req: Request, res: Response): Promise<void> {
        const { refreshToken } = req.body;
        let decoded: any;
        try {
            decoded = jwt.verify(refreshToken, SERVER_CONST.JWTSECRET);
        } catch (error) {
            res.status(401).json({ statusCode: 401, status: 'error', message: 'Refresh token inválido o expirado' });
            return;
        }

        const user = decoded.token_type === 'refresh' ? await UsersUtil.getUserFromUsername(decoded.username) : null;
        if (!user) {
            res.status(401).json({ statusCode: 401, status: 'error', message: 'Refresh token inválido o expirado' });
            return;
        }

        const accessToken = UsersUtil.signToken(user, 'access', SERVER_CONST.ACCESS_TOKEN_EXPIRY_TIME_SECONDS);
        res.status(200).json({ statusCode: 200, status: 'success', data: { accessToken } });
    }

    public async changePassword(req: Request, res: Response): Promise<void> {
        const { current_password, new_password } = req.body;
        const service = new UserService();

        const found = await service.findOne(String(req.user?.user_id));
        if (found.statusCode !== 200 || !found.data) {
            res.status(found.statusCode).json(found);
            return;
        }

        const user = found.data as Users;
        if (!(await bcryptCompare(current_password, user.password))) {
            res.status(400).json({ statusCode: 400, status: 'error', message: 'La contraseña actual es incorrecta' });
            return;
        }

        const result = await service.update(user.user_id, { password: await encryptString(new_password) });
        if (result.statusCode === 200) {
            delete (result.data as any).password;
        }
        res.status(result.statusCode).json(result);
    }

    public async addHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'add_user')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para crear usuarios' });
            return;
        }

        const service = new UserService();
        const data = { ...req.body };
        data.password = await encryptString(data.password);
        const result = await service.create(data);
        if (result.statusCode === 201 && result.data) {
            delete (result.data as any).password;
        }
        res.status(result.statusCode).json(result);
    }

    public async getAllHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_all_users')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar usuarios' });
            return;
        }

        const service = new UserService();
        const result = await service.findAll(req.query);
        if (result.statusCode === 200 && Array.isArray(result.data)) {
            result.data.forEach((user: any) => delete user.password);
        }
        res.status(result.statusCode).json(result);
    }

    public async getDetailsHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_user')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar el usuario' });
            return;
        }

        const userId = String(req.params.id);
        const userFromCache = await CacheUtil.get('User', userId);
        if (userFromCache) {
            res.status(200).json({ statusCode: 200, status: 'success', data: userFromCache });
            return;
        }

        const service = new UserService();
        const result = await service.findOne(userId);
        if (result.statusCode === 200 && result.data) {
            delete (result.data as any).password;
            CacheUtil.set('User', userId, result.data);
        }
        res.status(result.statusCode).json(result);
    }

    public async updateHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'edit_user')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para editar usuarios' });
            return;
        }

        const service = new UserService();
        const data = { ...req.body };
        if (data.password) {
            data.password = await encryptString(data.password);
        }
        const result = await service.update(String(req.params.id), data);
        if (result.statusCode === 200 && result.data) {
            delete (result.data as any).password;
            CacheUtil.remove('User', String(req.params.id));
        }
        res.status(result.statusCode).json(result);
    }

    public async deleteHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'delete_user')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para eliminar usuarios' });
            return;
        }

        const service = new UserService();
        const result = await service.delete(String(req.params.id));
        if (result.statusCode === 200) {
            CacheUtil.remove('User', String(req.params.id));
        }
        res.status(result.statusCode).json(result);
    }

    public async forgotPassword(req: Request, res: Response): Promise<void> {
        const { email } = req.body;
        const user = await UsersUtil.getUserByEmail(email);
        if (!user) {
            res.status(404).json({ statusCode: 404, status: 'error', message: 'Correo electrónico no registrado' });
            return;
        }

        const resetToken = jwt.sign({ email: user.email, token_type: 'reset' }, SERVER_CONST.JWTSECRET, { expiresIn: '1h' });
        const resetLink = `http://127.0.0.1:3000/reset-password?token=${resetToken}`;
        const html = `
            <h2>Hola ${user.fullname},</h2>
            <p>Hemos recibido una solicitud para restablecer tu contraseña.</p>
            <p>Haz clic en el siguiente enlace para continuar (válido por 1 hora):</p>
            <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Restablecer Contraseña</a>
            <p>Si no solicitaste este cambio, puedes ignorar este correo de forma segura.</p>
        `;
        const emailSent = await sendMail(email, 'Recuperación de Contraseña - Sistema PMS', html);
        if (emailSent) {
            res.status(200).json({ statusCode: 200, status: 'success', message: 'Enlace de recuperación enviado al correo electrónico' });
        } else {
            res.status(500).json({ statusCode: 500, status: 'error', message: 'Fallo al enviar el correo de recuperación' });
        }
    }

    public async resetPassword(req: Request, res: Response): Promise<void> {
        const { token, password } = req.body;
        let decoded: any;
        try {
            decoded = jwt.verify(token, SERVER_CONST.JWTSECRET);
        } catch (error) {
            res.status(401).json({ statusCode: 401, status: 'error', message: 'Token de recuperación inválido o expirado' });
            return;
        }

        const user = decoded.token_type === 'reset' ? await UsersUtil.getUserByEmail(decoded.email) : null;
        if (!user) {
            res.status(404).json({ statusCode: 404, status: 'error', message: 'Usuario no encontrado' });
            return;
        }

        const service = new UserService();
        const hashedPassword = await encryptString(password);
        const result = await service.update(user.user_id, { password: hashedPassword });
        if (result.statusCode === 200) {
            delete (result.data as any).password;
        }
        res.status(result.statusCode).json(result);
    }
}

export class UsersUtil {
    public static signToken(user: Users, tokenType: 'access' | 'refresh', expiresInSeconds: number): string {
        return jwt.sign(
            { user_id: user.user_id, email: user.email, username: user.username, token_type: tokenType },
            SERVER_CONST.JWTSECRET,
            { expiresIn: expiresInSeconds }
        );
    }

    public static async getUserFromUsername(username: string): Promise<Users | null> {
        if (!username) return null;
        const repo = new DatabaseUtil().getRepository(Users);
        return repo.findOne({ where: { username }, loadRelationIds: true });
    }

    public static async getUserByEmail(email: string): Promise<Users | null> {
        if (!email) return null;
        const repo = new DatabaseUtil().getRepository(Users);
        return repo.findOne({ where: { email } });
    }
}
import { Request, Response, NextFunction } from "express";
import * as jwt from "jsonwebtoken";
import { SERVER_CONST } from "./common";
import { RoleUtil } from "../components/roles/roles_controller";
import { UsersUtil } from "../components/users/users_controller";

export const authorize = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ statusCode: 401, status: 'error', message: 'Token de autorización ausente' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, SERVER_CONST.JWTSECRET) as any;
        if (decoded.token_type !== 'access' || !decoded.username) {
            return res.status(401).json({ statusCode: 401, status: 'error', message: 'Token de autorización inválido o expirado' });
        }

        const user = await UsersUtil.getUserFromUsername(decoded.username);
        if (!user) {
            return res.status(401).json({ statusCode: 401, status: 'error', message: 'Usuario del token no encontrado' });
        }

        const rights = await RoleUtil.getAllRightsFromRoles(user.role_ids);
        req.user = {
            user_id: user.user_id,
            username: user.username,
            email: user.email,
            rights
        };

        next();
    } catch (error) {
        return res.status(401).json({ statusCode: 401, status: 'error', message: 'Token de autorización inválido o expirado' });
    }
};

export const hasPermission = (userRights: string[] | undefined, requiredRight: string): boolean => {
    if (!userRights || !Array.isArray(userRights)) return false;
    return userRights.includes(requiredRight);
};


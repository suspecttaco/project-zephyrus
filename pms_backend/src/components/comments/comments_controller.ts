import { Request, Response } from "express";
import { CommentService } from "./comments_service";
import { hasPermission } from "../../utils/auth_util";

export class CommentController {
    public async addHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'add_comment')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para crear comentarios' });
            return;
        }

        const service = new CommentService();
        const result = await service.create({ ...req.body, user_id: req.user?.user_id });
        res.status(result.statusCode).json(result);
    }

    public async getAllHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_all_comments')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar comentarios' });
            return;
        }

        const service = new CommentService();
        const result = await service.findAll(req.query);
        res.status(result.statusCode).json(result);
    }

    public async getDetailsHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_comment')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar el comentario' });
            return;
        }

        const service = new CommentService();
        const result = await service.findOne(String(req.params.id));
        res.status(result.statusCode).json(result);
    }

    public async updateHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'edit_comment')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para editar comentarios' });
            return;
        }

        const { comment, supported_files } = req.body;
        const service = new CommentService();
        const result = await service.update(String(req.params.id), { comment, supported_files });
        res.status(result.statusCode).json(result);
    }

    public async deleteHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'delete_comment')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para eliminar comentarios' });
            return;
        }

        const service = new CommentService();
        const result = await service.delete(String(req.params.id));
        res.status(result.statusCode).json(result);
    }
}

import { Request, Response } from "express";
import { ProjectService } from "./projects_service";
import { hasPermission } from "../../utils/auth_util";
import { ProjectStatus } from "./projects_entity";
import { CacheUtil } from "../../utils/cache_util";
import { reportGeneratorFor, ReportNotFoundError } from "../../reports/project_report_generators";

export class ProjectController {
    public async addHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'add_project')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para crear proyectos' });
            return;
        }

        try {
            const service = new ProjectService();
            const project = await service.createProject(req.body, req.user?.user_id);
            res.status(201).json({ statusCode: 201, status: 'success', message: 'Proyecto creado exitosamente', data: project });
        } catch (error: any) {
            if (error.code === '23505') {
                res.status(409).json({ statusCode: 409, status: 'error', message: 'Conflicto: Ya existe un proyecto registrado con ese nombre' });
                return;
            }
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }

    public async getAllHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_all_projects')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar proyectos' });
            return;
        }

        const status = req.query.status;
        if (status && !Object.values(ProjectStatus).includes(status as ProjectStatus)) {
            res.status(400).json({ statusCode: 400, status: 'error', message: `Estado inválido. Valores permitidos: ${Object.values(ProjectStatus).join(', ')}` });
            return;
        }

        try {
            const service = new ProjectService();
            const projects = await service.getAllProjectsCustom(req.query);
            res.status(200).json({ statusCode: 200, status: 'success', data: projects });
        } catch (error: any) {
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }

    public async getDetailsHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_project')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar el proyecto' });
            return;
        }

        const projectId = String(req.params.id);
        const projectFromCache = await CacheUtil.get('Project', projectId);
        if (projectFromCache) {
            res.status(200).json({ statusCode: 200, status: 'success', data: projectFromCache });
            return;
        }

        const service = new ProjectService();
        const result = await service.findOne(projectId);
        if (result.statusCode === 200 && result.data) {
            CacheUtil.set('Project', projectId, result.data);
        }
        res.status(result.statusCode).json(result);
    }

    public async updateHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'edit_project')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para editar proyectos' });
            return;
        }

        try {
            const service = new ProjectService();
            const result = await service.update(String(req.params.id), req.body);
            if (result.statusCode === 200) {
                CacheUtil.remove('Project', String(req.params.id));
            }
            res.status(result.statusCode).json(result);
        } catch (error: any) {
            if (error.code === '23505') {
                res.status(409).json({ statusCode: 409, status: 'error', message: 'Conflicto: Ya existe un proyecto registrado con ese nombre' });
                return;
            }
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }

    public async deleteHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'delete_project')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para eliminar proyectos' });
            return;
        }

        const service = new ProjectService();
        const result = await service.delete(String(req.params.id));
        if (result.statusCode === 200) {
            CacheUtil.remove('Project', String(req.params.id));
        }
        res.status(result.statusCode).json(result);
    }

    public async createWithDefaultTask(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'add_project')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para crear proyectos' });
            return;
        }

        try {
            const ownerId = String(req.user?.user_id);
            const service = new ProjectService();
            const project = await service.createProjectWithDefaultTask(req.body, ownerId);
            res.status(201).json({
                statusCode: 201,
                status: 'success',
                message: 'Proyecto creado exitosamente con tarea por defecto',
                data: project
            });
        } catch (error: any) {
            if (error.code === '23505') {
                res.status(409).json({ statusCode: 409, status: 'error', message: 'Conflicto: Ya existe un proyecto registrado con ese nombre' });
                return;
            }
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }

    public async reportHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_project')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar el proyecto' });
            return;
        }

        const format = String(req.query.format || 'csv').toLowerCase();
        if (!['csv', 'json'].includes(format)) {
            res.status(400).json({ statusCode: 400, status: 'error', message: 'Formato no soportado. Valores permitidos: csv, json' });
            return;
        }

        try {
            const projectId = String(req.params.id);
            const generator = reportGeneratorFor(format);
            const report = await generator.generate(projectId);
            res.status(200)
                .set({ 'Content-Type': generator.contentType, 'Content-Disposition': `attachment; filename="proyecto-${projectId}.${generator.extension}"` })
                .send(report);
        } catch (error: any) {
            if (error instanceof ReportNotFoundError) {
                res.status(404).json({ statusCode: 404, status: 'error', message: error.message });
                return;
            }
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }
}

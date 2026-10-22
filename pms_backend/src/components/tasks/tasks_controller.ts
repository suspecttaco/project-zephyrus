import { Request, Response } from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { TaskService } from "./tasks_service";
import { hasPermission } from "../../utils/auth_util";
import { TaskNotifications } from "../../utils/task_notifications";
import * as composition from "../../infrastructure/composition";
import { Task } from "../../domain/entities/task";
import { DomainValidationError, NotFoundError } from "../../domain/errors";
import { TaskQueryService } from "../../domain/cost/task_cost";
import { ActivityClient, ActivityUnavailableError } from "../../utils/activity_client";
import { DomainEvents } from "../../messaging/domain_events";
import { TaskOrchestrator } from "./task_orchestrator";
import { WorkflowError } from "../../domain/task_workflow";
import { TaskTransactionService } from "./task_transaction_service";
import { isSerializationFailure } from "../../utils/serializable_retry";

export class TaskController {
    private static toApiTask(task: Task) {
        return {
            task_id: task.id,
            name: task.name,
            description: task.description ?? null,
            project_id: task.projectId,
            user_id: task.assignedUserId ?? null,
            priority: task.priority,
            status: task.status,
            estimated_start_time: task.estimatedStartTime ?? null,
            estimated_end_time: task.estimatedEndTime ?? null,
            actual_start_time: task.actualStartTime ?? null,
            actual_end_time: task.actualEndTime ?? null,
            supported_files: task.supportedFiles ?? null,
            created_at: task.createdAt,
            updated_at: task.updatedAt
        };
    }

    public async addHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'add_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para crear tareas' });
            return;
        }

        try {
            const b = req.body ?? {};
            const toDate = (v: any) => (v ? new Date(v) : undefined);
            const task = await composition.buildCreateTaskUseCase().execute({
                name: b.name,
                description: b.description,
                projectId: b.project_id,
                assignedUserId: b.user_id,
                priority: b.priority,
                status: b.status,
                estimatedStartTime: toDate(b.estimated_start_time),
                estimatedEndTime: toDate(b.estimated_end_time),
                supportedFiles: b.supported_files
            });
            DomainEvents.emit(task.id!, req.user?.user_id, 'task.created', { name: task.name, project_id: task.projectId, assigned_user_id: task.assignedUserId ?? null });
            res.status(201).json({ statusCode: 201, status: 'success', data: TaskController.toApiTask(task) });
        } catch (error: any) {
            if (error instanceof DomainValidationError) {
                res.status(400).json({ statusCode: 400, status: 'error', message: error.message });
            } else if (error instanceof NotFoundError) {
                res.status(404).json({ statusCode: 404, status: 'error', message: error.message });
            } else if (error.code === '23505') {
                res.status(409).json({ statusCode: 409, status: 'error', message: error.detail || 'Conflicto: Ya existe una tarea registrada con ese nombre' });
            } else {
                res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
            }
        }
    }

    public async costHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar la tarea' });
            return;
        }
        try {
            const type = String(req.query.type || 'standard').toLowerCase();
            const data = await new TaskQueryService(composition.buildTaskReader()).estimateCost(String(req.params.id), type);
            res.status(200).json({ statusCode: 200, status: 'success', data });
        } catch (error: any) {
            const status = error instanceof NotFoundError ? 404 : error instanceof DomainValidationError ? 400 : 500;
            res.status(status).json({ statusCode: status, status: 'error', message: error.message });
        }
    }

    public async getAllHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_all_tasks')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar tareas' });
            return;
        }

        const service = new TaskService();
        const result = await service.findAll(req.query);
        res.status(result.statusCode).json(result);
    }

    public async getDetailsHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar la tarea' });
            return;
        }

        const service = new TaskService();
        const result = await service.findOne(String(req.params.id));
        res.status(result.statusCode).json(result);
    }

    public async updateHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'edit_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para editar tareas' });
            return;
        }

        try {
            const service = new TaskService();
            const result = await service.update(String(req.params.id), req.body);
            res.status(result.statusCode).json(result);
        } catch (error: any) {
            if (error.code === '23505') {
                res.status(409).json({ statusCode: 409, status: 'error', message: 'Conflicto: Ya existe una tarea registrada con ese nombre' });
                return;
            }
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }

    public async deleteHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'delete_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para eliminar tareas' });
            return;
        }

        const service = new TaskService();
        const result = await service.delete(String(req.params.id));
        res.status(result.statusCode).json(result);
    }

    public async updateStatus(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'edit_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para editar tareas' });
            return;
        }

        try {
            const service = new TaskService();
            const task = await service.updateTaskStatus(String(req.params.id), req.body.status);
            if (!task) {
                res.status(404).json({ statusCode: 404, status: 'error', message: 'Tarea no encontrada' });
                return;
            }
            TaskNotifications.taskStatusChanged(task as any);
            DomainEvents.emit(String(req.params.id), req.user?.user_id, 'task.status_changed', { status: task.status });
            res.status(200).json({ statusCode: 200, status: 'success', data: task });
        } catch (error: any) {
            if (error instanceof WorkflowError) {
                res.status(409).json({ statusCode: 409, status: 'error', message: error.message });
                return;
            }
            if (isSerializationFailure(error)) {
                res.status(409).json({ statusCode: 409, status: 'error', message: 'Conflicto de concurrencia: vuelva a intentar la operación' });
                return;
            }
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }

    private static readonly FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;
    private static readonly PHONE = /^\+?[0-9]{8,15}$/;

    private static parseAttachments(raw: string | null | undefined): any[] {
        try {
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch {
            return [];
        }
    }

    public async addAttachmentHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'edit_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para editar tareas' });
            return;
        }

        const fileName = String(req.query.filename || '');
        const phone = req.query.phone ? String(req.query.phone) : undefined;
        if (!TaskController.FILE_NAME.test(fileName) || fileName.includes('..')) {
            res.status(400).json({ statusCode: 400, status: 'error', message: 'El parámetro filename es obligatorio (letras, números, espacios, punto, guion y guion bajo; máximo 100 caracteres)' });
            return;
        }
        if (phone && !TaskController.PHONE.test(phone)) {
            res.status(400).json({ statusCode: 400, status: 'error', message: 'El parámetro phone debe ser un teléfono válido (8 a 15 dígitos, con + opcional)' });
            return;
        }
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            res.status(400).json({ statusCode: 400, status: 'error', message: 'El cuerpo debe ser el contenido binario del archivo (Content-Type: application/octet-stream)' });
            return;
        }

        const taskId = String(req.params.id);
        const service = new TaskService();
        const found = await service.findOne(taskId);
        if (found.statusCode !== 200) {
            res.status(found.statusCode).json(found);
            return;
        }

        const tmpFile = path.join(os.tmpdir(), `pms-${randomUUID()}`);
        try {
            await fs.writeFile(tmpFile, req.body);
            const url = await new TaskOrchestrator().processTaskAttachment(taskId, tmpFile, fileName, phone);

            const attachment = { name: fileName, url, size: req.body.length, uploaded_at: new Date().toISOString(), uploaded_by: req.user?.user_id };
            const result = await new TaskTransactionService().addAttachment(taskId, attachment);
            if (result !== 'ok') {
                res.status(404).json({ statusCode: 404, status: 'error', message: 'Tarea no encontrada' });
                return;
            }
            DomainEvents.emit(taskId, req.user?.user_id, 'task.attachment_added', { name: fileName, size: attachment.size });
            res.status(201).json({ statusCode: 201, status: 'success', data: attachment });
        } catch (error: any) {
            res.status(500).json({ statusCode: 500, status: 'error', message: `No se pudo guardar el adjunto: ${error.message}` });
        } finally {
            await fs.rm(tmpFile, { force: true });
        }
    }

    public async listAttachmentsHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar la tarea' });
            return;
        }
        const found = await new TaskService().findOne(String(req.params.id));
        if (found.statusCode !== 200) {
            res.status(found.statusCode).json(found);
            return;
        }
        res.status(200).json({ statusCode: 200, status: 'success', data: TaskController.parseAttachments((found.data as any).supported_files) });
    }

    public async deleteAttachmentHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'edit_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para editar tareas' });
            return;
        }

        const taskId = String(req.params.id);
        const fileName = String(req.params.name);
        const service = new TaskService();
        const found = await service.findOne(taskId);
        if (found.statusCode !== 200) {
            res.status(found.statusCode).json(found);
            return;
        }

        try {
            const removed = await new TaskTransactionService().removeAttachment(taskId, fileName);
            if (removed === 'attachment_not_found' || removed === 'task_not_found') {
                res.status(404).json({ statusCode: 404, status: 'error', message: 'Adjunto no encontrado' });
                return;
            }
            await new TaskOrchestrator().removeTaskAttachment(taskId, fileName);
            DomainEvents.emit(taskId, req.user?.user_id, 'task.attachment_removed', { name: fileName });
            res.status(200).json({ statusCode: 200, status: 'success', message: 'Adjunto eliminado' });
        } catch (error: any) {
            res.status(500).json({ statusCode: 500, status: 'error', message: `No se pudo eliminar el adjunto: ${error.message}` });
        }
    }

    private static activityError(res: Response, error: any): void {
        const status = error instanceof ActivityUnavailableError ? 503 : 500;
        res.status(status).json({ statusCode: status, status: 'error', message: error.message });
    }

    public async activityHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar la tarea' });
            return;
        }
        const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 100, 1), 1000);
        const order = String(req.query.order).toLowerCase() === 'desc' ? 'desc' : 'asc';
        try {
            const data = await new ActivityClient().history(String(req.params.id), limit, order);
            res.status(200).json({ statusCode: 200, status: 'success', data });
        } catch (error: any) {
            TaskController.activityError(res, error);
        }
    }

    public async lastActivityHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para consultar la tarea' });
            return;
        }
        try {
            const last = await new ActivityClient().last(String(req.params.id));
            if (!last) {
                res.status(404).json({ statusCode: 404, status: 'error', message: 'Sin actividad registrada para esta tarea' });
                return;
            }
            res.status(200).json({ statusCode: 200, status: 'success', data: last });
        } catch (error: any) {
            TaskController.activityError(res, error);
        }
    }
}

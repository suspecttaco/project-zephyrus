import { Request, Response } from "express";
import { Pipeline, Context } from "../../core/middleware_pipeline";
import { hasPermission } from "../../utils/auth_util";
import { TaskService } from "./tasks_service";
import { TaskNotifications } from "../../utils/task_notifications";
import { WorkflowAction, WorkflowError } from "../../domain/task_workflow";
import { Status } from "./tasks_entity";
import { buildAssignmentCommandManager, AssignmentError, TaskAssignmentService } from "./task_assignment_service";
import { AssignUserCommand } from "../../commands/task_commands";
import { DomainEvents } from "../../messaging/domain_events";
import { isSerializationFailure } from "../../utils/serializable_retry";

const respond = (ctx: Context, statusCode: number, body: object) => {
    ctx.response = { statusCode, body: { statusCode, status: statusCode < 400 ? 'success' : 'error', ...body } };
};

export class TaskWorkflowController {
    private buildPipeline(): Pipeline {
        return new Pipeline()
            .use(async (ctx, next) => {
                const start = Date.now();
                await next();
                console.log(`[Workflow] ${ctx.action} sobre tarea ${ctx.taskId} -> ${ctx.response?.statusCode} en ${Date.now() - start}ms`);
            })
            .use(async (ctx, next) => {
                if (!hasPermission(ctx.user?.rights, 'edit_task')) {
                    return respond(ctx, 403, { message: 'No tiene permisos para editar tareas' });
                }
                await next();
            })
            .use(async (ctx, next) => {
                try {
                    const task = await new TaskService().performWorkflowAction(ctx.taskId, ctx.action as WorkflowAction);
                    if (!task) {
                        return respond(ctx, 404, { message: 'Tarea no encontrada' });
                    }
                    ctx.task = task;
                    respond(ctx, 200, { data: { task_id: ctx.taskId, status: task.status, actual_start_time: task.actual_start_time, actual_end_time: task.actual_end_time } });
                    await next();
                } catch (error: any) {
                    if (error instanceof WorkflowError) {
                        return respond(ctx, 409, { message: error.message });
                    }
                    if (isSerializationFailure(error)) {
                        return respond(ctx, 409, { message: 'Conflicto de concurrencia: vuelva a intentar la operación' });
                    }
                    throw error;
                }
            })
            .use(async (ctx, next) => {
                TaskNotifications.taskStatusChanged(ctx.task);
                DomainEvents.emit(ctx.taskId, ctx.user?.user_id, `task.${ctx.action}`, { status: ctx.task.status });
                await next();
            });
    }

    public async actionHandler(req: Request, res: Response): Promise<void> {
        const ctx: Context = { taskId: String(req.params.id), action: String(req.params.action), user: req.user };
        try {
            await this.buildPipeline().execute(ctx);
            res.status(ctx.response.statusCode).json(ctx.response.body);
        } catch (error: any) {
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }

    public async assignHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'edit_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para editar tareas' });
            return;
        }
        const taskId = String(req.params.id);
        const found = await new TaskService().findOne(taskId);
        if (found.statusCode !== 200) {
            res.status(found.statusCode).json(found);
            return;
        }
        const previous = ((found.data as any).user_id as string | undefined) ?? null;
        const command = new AssignUserCommand(taskId, String(req.body.user_id), previous, new TaskAssignmentService());
        try {
            await buildAssignmentCommandManager().run(taskId, command);
            DomainEvents.emit(taskId, req.user?.user_id, 'task.assigned', { user_id: req.body.user_id, previous_user_id: previous });
            res.status(200).json({ statusCode: 200, status: 'success', data: { task_id: taskId, user_id: req.body.user_id, previous_user_id: previous } });
        } catch (error: any) {
            const status = error instanceof AssignmentError ? error.statusCode : 500;
            res.status(status).json({ statusCode: status, status: 'error', message: error.message });
        }
    }

    public async undoAssignHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'edit_task')) {
            res.status(403).json({ statusCode: 403, status: 'error', message: 'No tiene permisos para editar tareas' });
            return;
        }
        const taskId = String(req.params.id);
        try {
            const undone = await buildAssignmentCommandManager().undoLast(taskId);
            if (!undone) {
                res.status(404).json({ statusCode: 404, status: 'error', message: 'No hay asignaciones que deshacer en esta tarea' });
                return;
            }
            const task = await new TaskService().findOne(taskId);
            DomainEvents.emit(taskId, req.user?.user_id, 'task.assignment_undone', { user_id: (task.data as any)?.user_id ?? null });
            res.status(200).json({ statusCode: 200, status: 'success', data: { task_id: taskId, user_id: (task.data as any)?.user_id ?? null } });
        } catch (error: any) {
            const status = error instanceof AssignmentError ? error.statusCode : 500;
            res.status(status).json({ statusCode: status, status: 'error', message: error.message });
        }
    }
}

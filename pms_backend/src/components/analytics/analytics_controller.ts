import { Request, Response } from "express";
import { DatabaseUtil } from "../../utils/db";
import { hasPermission } from "../../utils/auth_util";
import { CdcEventStore } from "../../events/event_store";
import { ChangeRow, deriveEvents, replay } from "../../events/stream_events";
import { sessionWindows, slidingWindows, tumblingWindows } from "../../events/windowing";
import { StreamProcessor } from "../../events/stream_processor";
import { ProjectMetrics, TaskChanges } from "../../events/entities";
import { RiskAnalysisService, RiskMode } from "../../services/risk_service";
import { MAX_SAMPLES } from "../../utils/risk_simulation";
import { Projects } from "../projects/projects_entity";
import { Tasks, Status } from "../tasks/tasks_entity";
import { TaskTimeoutError } from "../../utils/worker_pool";

const forbidden = (res: Response, message: string): void => {
    res.status(403).json({ statusCode: 403, status: 'error', message });
};

export class AnalyticsController {
    public async metricsHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_project')) return forbidden(res, 'No tiene permisos para consultar el proyecto');
        try {
            const projectId = String(req.params.id);
            const row = await new DatabaseUtil().getRepository(ProjectMetrics).findOneBy({ project_id: projectId });
            res.status(200).json({
                statusCode: 200, status: 'success',
                data: {
                    project_id: projectId,
                    total: row?.total ?? 0,
                    by_status: {
                        'Not-Started': row?.not_started ?? 0, 'In-Progress': row?.in_progress ?? 0,
                        'In-Review': row?.in_review ?? 0, 'Completed': row?.completed ?? 0
                    },
                    updated_at: row?.updated_at ?? null,
                    lag: await new StreamProcessor().lag()
                }
            });
        } catch (error: any) {
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }

    public async historyHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_task')) return forbidden(res, 'No tiene permisos para consultar la tarea');
        try {
            const events = await new CdcEventStore().getEventStream(String(req.params.id));
            if (events.length === 0) {
                res.status(404).json({ statusCode: 404, status: 'error', message: 'No hay historial para esta tarea' });
                return;
            }
            res.status(200).json({ statusCode: 200, status: 'success', data: events.map((e) => ({ eventId: e.eventId, eventType: e.eventType, timestamp: e.timestamp, payload: e.payload })) });
        } catch (error: any) {
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }

    public async stateAtHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_task')) return forbidden(res, 'No tiene permisos para consultar la tarea');
        const at = req.query.time ? new Date(String(req.query.time)) : undefined;
        if (at && isNaN(at.getTime())) {
            res.status(400).json({ statusCode: 400, status: 'error', message: 'time debe ser una fecha ISO 8601 válida' });
            return;
        }
        try {
            const events = await new CdcEventStore().getEventStream(String(req.params.id), at);
            const state = replay(events, at);
            if (!state) {
                res.status(404).json({ statusCode: 404, status: 'error', message: 'La tarea no existía en ese instante' });
                return;
            }
            res.status(200).json({ statusCode: 200, status: 'success', data: { at: at ?? null, events_replayed: events.length, state } });
        } catch (error: any) {
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }

    public async throughputHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_all_tasks')) return forbidden(res, 'No tiene permisos para consultar tareas');
        const windowType = String(req.query.window || 'tumbling');
        const sizeMs = (parseInt(String(req.query.size)) || 60) * 1000;
        const slideMs = (parseInt(String(req.query.slide)) || 10) * 1000;
        const gapMs = (parseInt(String(req.query.gap)) || 30) * 1000;
        const metric = String(req.query.metric || 'created');
        const to = req.query.to ? new Date(String(req.query.to)) : new Date();
        const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - 3600_000);

        if (!['tumbling', 'sliding', 'session'].includes(windowType)) {
            res.status(400).json({ statusCode: 400, status: 'error', message: 'window debe ser tumbling, sliding o session' });
            return;
        }
        if (!['created', 'completed'].includes(metric)) {
            res.status(400).json({ statusCode: 400, status: 'error', message: 'metric debe ser created o completed' });
            return;
        }
        if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to || to.getTime() - from.getTime() > 24 * 3600_000) {
            res.status(400).json({ statusCode: 400, status: 'error', message: 'El rango from/to debe ser válido y no superar 24 horas' });
            return;
        }

        try {
            const qb = new DatabaseUtil().getRepository(TaskChanges).createQueryBuilder('c')
                .where('c.changed_at >= :from AND c.changed_at < :to', { from, to })
                .orderBy('c.seq', 'ASC').take(50_000);
            if (req.query.project_id) {
                qb.andWhere(`(c.new_row->>'project_id' = :p OR c.old_row->>'project_id' = :p)`, { p: String(req.query.project_id) });
            }
            const wanted = metric === 'created' ? 'TaskCreated' : 'TaskCompleted';
            const timestamps = (await qb.getMany())
                .flatMap((c) => deriveEvents(c as unknown as ChangeRow))
                .filter((e) => e.eventType === wanted)
                .map((e) => e.timestamp.getTime());

            const windows = windowType === 'tumbling' ? tumblingWindows(timestamps, sizeMs)
                : windowType === 'sliding' ? slidingWindows(timestamps, sizeMs, slideMs)
                : sessionWindows(timestamps, gapMs);
            res.status(200).json({
                statusCode: 200, status: 'success',
                data: {
                    window: windowType, metric, events: timestamps.length,
                    windows: windows.map((w) => ({ start: new Date(w.start), end: new Date(w.end), count: w.count }))
                }
            });
        } catch (error: any) {
            res.status(500).json({ statusCode: 500, status: 'error', message: error.message });
        }
    }

    public async riskHandler(req: Request, res: Response): Promise<void> {
        if (!hasPermission(req.user?.rights, 'get_details_project')) return forbidden(res, 'No tiene permisos para consultar el proyecto');

        const mode = String(req.query.mode || 'thread') as RiskMode;
        const samples = parseInt(String(req.query.samples)) || 200_000;
        if (!['thread', 'process', 'inline'].includes(mode)) {
            res.status(400).json({ statusCode: 400, status: 'error', message: 'mode debe ser thread, process o inline' });
            return;
        }
        if (mode === 'inline' && process.env.ANALYTICS_ALLOW_INLINE !== 'true') {
            res.status(400).json({ statusCode: 400, status: 'error', message: 'El modo inline bloquea el servidor y está deshabilitado (ANALYTICS_ALLOW_INLINE=true para compararlo)' });
            return;
        }
        if (samples < 1 || samples > MAX_SAMPLES) {
            res.status(400).json({ statusCode: 400, status: 'error', message: `samples debe estar entre 1 y ${MAX_SAMPLES}` });
            return;
        }

        try {
            const db = new DatabaseUtil();
            const projectId = String(req.params.id);
            const project = await db.getRepository(Projects).findOneBy({ project_id: projectId });
            if (!project) {
                res.status(404).json({ statusCode: 404, status: 'error', message: 'Proyecto no encontrado' });
                return;
            }

            const pending = (await db.getRepository(Tasks).find({ where: { project_id: projectId } as any, loadRelationIds: true }))
                .filter((t) => t.status !== Status.Completed);
            const loads = new Map<string, number[]>();
            let unestimated = 0;
            for (const task of pending) {
                if (!task.estimated_start_time || !task.estimated_end_time) { unestimated++; continue; }
                const hours = (new Date(task.estimated_end_time).getTime() - new Date(task.estimated_start_time).getTime()) / 3_600_000;
                const key = String(task.user_id ?? 'sin-asignar');
                loads.set(key, [...(loads.get(key) ?? []), hours]);
            }
            if (loads.size === 0) {
                res.status(400).json({ statusCode: 400, status: 'error', message: 'El proyecto no tiene tareas pendientes con fechas estimadas' });
                return;
            }

            const deadlineHours = project.end_time ? Math.max(0, (new Date(project.end_time).getTime() - Date.now()) / 3_600_000) : null;
            const started = Date.now();
            const result = await RiskAnalysisService.run(mode, {
                assigneeLoads: [...loads.values()], samples,
                seed: req.query.seed ? parseInt(String(req.query.seed)) : undefined, deadlineHours
            });
            res.status(200).json({
                statusCode: 200, status: 'success',
                data: {
                    project_id: projectId, mode, compute_ms: Date.now() - started,
                    pending_tasks: pending.length - unestimated, unestimated_tasks: unestimated, assignees: loads.size,
                    deadline_hours: deadlineHours === null ? null : Math.round(deadlineHours * 100) / 100,
                    hours: { mean: result.mean, p50: result.p50, p80: result.p80, p90: result.p90, p95: result.p95 },
                    on_time_probability: result.onTimeProbability, samples: result.samples
                }
            });
        } catch (error: any) {
            const status = error instanceof TaskTimeoutError ? 504 : 500;
            res.status(status).json({ statusCode: status, status: 'error', message: error.message });
        }
    }
}

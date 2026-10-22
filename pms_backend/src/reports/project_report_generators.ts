import { BaseReportGenerator } from './base_report_generator';
import { fetchInBatches, pagedFetcher } from '../utils/async_iterator';
import { DatabaseUtil } from '../utils/db';
import { Projects } from '../components/projects/projects_entity';
import { Tasks } from '../components/tasks/tasks_entity';

export class ReportNotFoundError extends Error {}

export interface ReportDataSource {
    getProject(projectId: string): Promise<any | null>;
    taskBatches(projectId: string): AsyncGenerator<any[], void, unknown>;
}

export class DbReportDataSource implements ReportDataSource {
    public async getProject(projectId: string): Promise<any | null> {
        return new DatabaseUtil().getRepository(Projects).findOneBy({ project_id: projectId });
    }

    public taskBatches(projectId: string): AsyncGenerator<any[], void, unknown> {
        const repo = new DatabaseUtil().getRepository(Tasks);
        return fetchInBatches(pagedFetcher((skip, take) => repo.find({
            where: { project_id: projectId } as any,
            loadRelationIds: true,
            order: { created_at: 'ASC', task_id: 'ASC' },
            skip,
            take
        }), 100));
    }
}

export interface ProjectReportData {
    project: any;
    tasks: any[];
    summary: Record<string, number>;
}

abstract class ProjectReportGenerator extends BaseReportGenerator {
    constructor(private readonly source: ReportDataSource = new DbReportDataSource()) {
        super();
    }

    protected async fetchData(projectId: string): Promise<ProjectReportData> {
        const project = await this.source.getProject(projectId);
        if (!project) {
            throw new ReportNotFoundError('Proyecto no encontrado');
        }
        const tasks: any[] = [];
        const summary: Record<string, number> = {};
        for await (const batch of this.source.taskBatches(projectId)) {
            for (const task of batch) {
                tasks.push(task);
                summary[task.status] = (summary[task.status] ?? 0) + 1;
            }
        }
        return { project, tasks, summary };
    }
}

const iso = (value: any): string => (value ? new Date(value).toISOString() : '');

export function csvCell(value: any): string {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) {
        text = `'${text}`;
    }
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export class CsvReportGenerator extends ProjectReportGenerator {
    public readonly contentType = 'text/csv; charset=utf-8';
    public readonly extension = 'csv';

    protected formatData(data: ProjectReportData): string {
        const header = ['task_id', 'tarea', 'estado', 'prioridad', 'usuario_asignado', 'inicio_estimado', 'fin_estimado', 'inicio_real', 'fin_real'];
        const rows = data.tasks.map((t) => [
            t.task_id, t.name, t.status, t.priority, t.user_id,
            iso(t.estimated_start_time), iso(t.estimated_end_time), iso(t.actual_start_time), iso(t.actual_end_time)
        ].map(csvCell).join(','));
        return [header.join(','), ...rows].join('\n') + '\n';
    }

    protected async exportFile(formatted: string): Promise<Buffer> {
        return Buffer.from(formatted, 'utf-8');
    }
}

export class JsonReportGenerator extends ProjectReportGenerator {
    public readonly contentType = 'application/json; charset=utf-8';
    public readonly extension = 'json';

    protected formatData(data: ProjectReportData): string {
        return JSON.stringify({
            project: { project_id: data.project.project_id, name: data.project.name, status: data.project.status },
            generated_at: new Date().toISOString(),
            total_tasks: data.tasks.length,
            summary: data.summary,
            tasks: data.tasks
        }, null, 2);
    }

    protected async exportFile(formatted: string): Promise<Buffer> {
        return Buffer.from(formatted, 'utf-8');
    }
}

export type ReportFormat = 'csv' | 'json';
export function reportGeneratorFor(format: string, source?: ReportDataSource): BaseReportGenerator {
    switch (format) {
        case 'csv': return new CsvReportGenerator(source);
        case 'json': return new JsonReportGenerator(source);
        default: throw new Error(`Formato de reporte no soportado: ${format}`);
    }
}

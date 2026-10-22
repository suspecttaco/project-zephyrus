import { StreamEvent } from './stream_events';

export const STATUS_COLUMN: Record<string, string> = {
    'Not-Started': 'not_started',
    'In-Progress': 'in_progress',
    'In-Review': 'in_review',
    'Completed': 'completed'
};

export interface MetricsDelta {
    total: number;
    not_started: number;
    in_progress: number;
    in_review: number;
    completed: number;
}

const empty = (): MetricsDelta => ({ total: 0, not_started: 0, in_progress: 0, in_review: 0, completed: 0 });

export class ProjectMetricsProjector {
    private readonly deltas = new Map<string, MetricsDelta>();

    private bucket(projectId: string | null | undefined): MetricsDelta | null {
        if (!projectId) return null;
        if (!this.deltas.has(projectId)) this.deltas.set(projectId, empty());
        return this.deltas.get(projectId)!;
    }

    private bump(projectId: string | null | undefined, status: string | null | undefined, sign: 1 | -1, total = false): void {
        const delta = this.bucket(projectId);
        if (!delta) return;
        if (total) delta.total += sign;
        const column = status ? STATUS_COLUMN[status] : undefined;
        if (column) (delta as any)[column] += sign;
    }

    public handleEvent(event: StreamEvent): void {
        const p = event.payload;
        switch (event.eventType) {
            case 'TaskCreated':
                this.bump(p.project_id, p.status, 1, true);
                break;
            case 'TaskStatusChanged':
                this.bump(event.context.projectId, p.oldStatus, -1);
                this.bump(event.context.projectId, p.newStatus, 1);
                break;
            case 'TaskMoved':
                this.bump(p.from, event.context.status, -1, true);
                this.bump(p.to, event.context.status, 1, true);
                break;
            case 'TaskDeleted':
                this.bump(p.projectId, p.status, -1, true);
                break;
            default:
                break;
        }
    }

    public getDeltas(): Map<string, MetricsDelta> {
        return this.deltas;
    }
}

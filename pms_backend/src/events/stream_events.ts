export interface StreamEvent<T = any> {
    eventId: string;
    eventType: string;
    aggregateId: string;
    timestamp: Date;
    payload: T;
    context: { projectId: string | null; status: string | null; seq: string };
}

export interface ChangeRow {
    seq: string;
    op: 'I' | 'U' | 'D';
    task_id: string;
    old_row: Record<string, any> | null;
    new_row: Record<string, any> | null;
    changed_at: Date | string;
}

export const TRACKED_FIELDS = [
    'name', 'description', 'project_id', 'user_id', 'status', 'priority',
    'estimated_start_time', 'estimated_end_time', 'actual_start_time', 'actual_end_time', 'supported_files'
] as const;

const SPECIFIC = new Set(['status', 'user_id', 'name', 'project_id']);

export function deriveEvents(change: ChangeRow): StreamEvent[] {
    const timestamp = new Date(change.changed_at);
    const events: StreamEvent[] = [];
    const push = (eventType: string, payload: any, row: Record<string, any>) =>
        events.push({
            eventId: `${change.seq}-${events.length}`, eventType, aggregateId: change.task_id, timestamp, payload,
            context: { projectId: row.project_id ?? null, status: row.status ?? null, seq: String(change.seq) }
        });

    if (change.op === 'I' && change.new_row) {
        const fields: Record<string, any> = {};
        TRACKED_FIELDS.forEach((f) => { fields[f] = change.new_row![f] ?? null; });
        push('TaskCreated', fields, change.new_row);
    } else if (change.op === 'D' && change.old_row) {
        push('TaskDeleted', { projectId: change.old_row.project_id, status: change.old_row.status }, change.old_row);
    } else if (change.op === 'U' && change.old_row && change.new_row) {
        const before = change.old_row;
        const after = change.new_row;
        if (before.status !== after.status) {
            const origin = { ...after, project_id: before.project_id };
            push('TaskStatusChanged', { oldStatus: before.status, newStatus: after.status }, origin);
            if (after.status === 'Completed') push('TaskCompleted', { oldStatus: before.status, newStatus: after.status }, origin);
        }
        if (before.user_id !== after.user_id) push('TaskAssigned', { from: before.user_id, to: after.user_id }, after);
        if (before.name !== after.name) push('TaskRenamed', { from: before.name, to: after.name }, after);
        if (before.project_id !== after.project_id) push('TaskMoved', { from: before.project_id, to: after.project_id }, after);

        const others: Record<string, { from: any; to: any }> = {};
        for (const field of TRACKED_FIELDS) {
            if (!SPECIFIC.has(field) && JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)) {
                others[field] = { from: before[field] ?? null, to: after[field] ?? null };
            }
        }
        if (Object.keys(others).length > 0) push('TaskFieldsChanged', { changes: others }, after);
    }
    return events;
}

export type TaskState = Record<string, any> & { deleted?: boolean };

export function applyEvent(state: TaskState | null, event: StreamEvent): TaskState | null {
    const p = event.payload;
    switch (event.eventType) {
        case 'TaskCreated': return { task_id: event.aggregateId, ...p };
        case 'TaskStatusChanged': return state && { ...state, status: p.newStatus };
        case 'TaskAssigned': return state && { ...state, user_id: p.to };
        case 'TaskRenamed': return state && { ...state, name: p.to };
        case 'TaskMoved': return state && { ...state, project_id: p.to };
        case 'TaskFieldsChanged': {
            if (!state) return state;
            const next = { ...state };
            for (const [field, change] of Object.entries<any>(p.changes)) next[field] = change.to;
            return next;
        }
        case 'TaskDeleted': return state && { ...state, deleted: true };
        default: return state;
    }
}

export function replay(events: StreamEvent[], at?: Date): TaskState | null {
    return events
        .filter((e) => !at || e.timestamp.getTime() <= at.getTime())
        .reduce<TaskState | null>((state, event) => applyEvent(state, event), null);
}

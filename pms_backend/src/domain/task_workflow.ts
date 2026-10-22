import { Status } from './task_status';

export class WorkflowError extends Error {}

export class TaskLimitError extends WorkflowError {}

export interface TaskContext {
    setState(state: TaskState): void;
    getTaskId(): string;
}

export interface TaskState {
    startWork(context: TaskContext): void;
    submitForReview(context: TaskContext): void;
    approve(context: TaskContext): void;
    getStatus(): Status;
}

export class NotStartedTaskState implements TaskState {
    startWork(context: TaskContext): void {
        console.log(`[PMS] Tarea ${context.getTaskId()}: Iniciando desarrollo.`);
        context.setState(new InProgressTaskState());
    }
    submitForReview(): void {
        throw new WorkflowError('La tarea aún no se ha iniciado: no puede enviarse a revisión.');
    }
    approve(): void {
        throw new WorkflowError('La tarea aún no se ha iniciado: no puede aprobarse.');
    }
    getStatus(): Status { return Status.NotStarted; }
}

export class InProgressTaskState implements TaskState {
    startWork(context: TaskContext): void {
        console.log(`[PMS] Tarea ${context.getTaskId()} ya está en progreso.`);
    }
    submitForReview(context: TaskContext): void {
        console.log(`[PMS] Tarea ${context.getTaskId()}: Enviada a revisión.`);
        context.setState(new InReviewTaskState());
    }
    approve(): void {
        throw new WorkflowError('Debe pasar por revisión antes de aprobar.');
    }
    getStatus(): Status { return Status.InProgress; }
}

export class InReviewTaskState implements TaskState {
    startWork(): void {
        throw new WorkflowError('Tarea en revisión no puede reiniciarse directamente.');
    }
    submitForReview(context: TaskContext): void {
        console.log(`[PMS] Tarea ${context.getTaskId()} ya está en revisión.`);
    }
    approve(context: TaskContext): void {
        console.log(`[PMS] Tarea ${context.getTaskId()}: Aprobada exitosamente.`);
        context.setState(new CompletedTaskState());
    }
    getStatus(): Status { return Status.InReview; }
}

export class CompletedTaskState implements TaskState {
    startWork(): void { throw new WorkflowError('Tarea completada no admite cambios.'); }
    submitForReview(): void { throw new WorkflowError('Tarea ya completada.'); }
    approve(): void { throw new WorkflowError('Tarea ya completada.'); }
    getStatus(): Status { return Status.Completed; }
}

const STATE_BY_STATUS: Record<Status, () => TaskState> = {
    [Status.NotStarted]: () => new NotStartedTaskState(),
    [Status.InProgress]: () => new InProgressTaskState(),
    [Status.InReview]: () => new InReviewTaskState(),
    [Status.Completed]: () => new CompletedTaskState()
};

export type WorkflowAction = 'start' | 'submit' | 'approve';

export class TaskWorkflow implements TaskContext {
    private state: TaskState;

    constructor(private readonly id: string, status: Status = Status.NotStarted) {
        this.state = STATE_BY_STATUS[status]();
    }

    setState(state: TaskState): void { this.state = state; }
    getTaskId(): string { return this.id; }
    getStatus(): Status { return this.state.getStatus(); }

    startWork(): void { this.state.startWork(this); }
    submitForReview(): void { this.state.submitForReview(this); }
    approve(): void { this.state.approve(this); }

    perform(action: WorkflowAction): void {
        if (action === 'start') this.startWork();
        else if (action === 'submit') this.submitForReview();
        else this.approve();
    }

    moveTo(target: Status): void {
        if (target === this.getStatus()) return;
        switch (target) {
            case Status.InProgress: return this.startWork();
            case Status.InReview: return this.submitForReview();
            case Status.Completed: return this.approve();
            default:
                throw new WorkflowError(`No se puede regresar una tarea al estado ${target}.`);
        }
    }
}

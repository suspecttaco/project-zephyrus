import { DomainValidationError } from '../errors';
import { Priority, Status } from '../task_status';
import { TaskWorkflow } from '../task_workflow';

export interface TaskProps {
    id?: string;
    name: string;
    description?: string;
    projectId: string;
    assignedUserId?: string;
    priority?: Priority;
    status?: Status;
    estimatedStartTime?: Date;
    estimatedEndTime?: Date;
    actualStartTime?: Date;
    actualEndTime?: Date;
    supportedFiles?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

export class Task {
    public static readonly MIN_NAME = 3;
    public static readonly MAX_NAME = 30;

    public readonly id?: string;
    public readonly name: string;
    public readonly description?: string;
    public readonly projectId: string;
    public readonly assignedUserId?: string;
    public readonly priority: Priority;
    public readonly estimatedStartTime?: Date;
    public readonly estimatedEndTime?: Date;
    public readonly actualStartTime?: Date;
    public readonly actualEndTime?: Date;
    public readonly supportedFiles?: string;
    public readonly createdAt?: Date;
    public readonly updatedAt?: Date;
    private readonly workflow: TaskWorkflow;

    constructor(props: TaskProps) {
        const name = (props.name ?? '').trim();
        if (name.length < Task.MIN_NAME || name.length > Task.MAX_NAME) {
            throw new DomainValidationError(`El nombre de la tarea debe tener entre ${Task.MIN_NAME} y ${Task.MAX_NAME} caracteres.`);
        }
        if (!props.projectId) {
            throw new DomainValidationError('La tarea debe estar asociada a un proyecto válido.');
        }
        if (props.priority && !Object.values(Priority).includes(props.priority)) {
            throw new DomainValidationError(`Prioridad inválida. Valores permitidos: ${Object.values(Priority).join(', ')}`);
        }
        if (props.estimatedStartTime && props.estimatedEndTime && props.estimatedEndTime <= props.estimatedStartTime) {
            throw new DomainValidationError('La fecha de fin estimada debe ser estrictamente posterior a la de inicio.');
        }
        this.id = props.id;
        this.name = name;
        this.description = props.description;
        this.projectId = props.projectId;
        this.assignedUserId = props.assignedUserId;
        this.priority = props.priority ?? Priority.Medium;
        this.estimatedStartTime = props.estimatedStartTime;
        this.estimatedEndTime = props.estimatedEndTime;
        this.actualStartTime = props.actualStartTime;
        this.actualEndTime = props.actualEndTime;
        this.supportedFiles = props.supportedFiles;
        this.createdAt = props.createdAt;
        this.updatedAt = props.updatedAt;
        this.workflow = new TaskWorkflow(props.id ?? 'nueva', props.status ?? Status.NotStarted);
    }

    get status(): Status {
        return this.workflow.getStatus();
    }

    public estimatedHours(): number | null {
        if (!this.estimatedStartTime || !this.estimatedEndTime) return null;
        return (this.estimatedEndTime.getTime() - this.estimatedStartTime.getTime()) / 3_600_000;
    }

    public toProps(): TaskProps {
        return {
            id: this.id, name: this.name, description: this.description, projectId: this.projectId,
            assignedUserId: this.assignedUserId, priority: this.priority, status: this.status,
            estimatedStartTime: this.estimatedStartTime, estimatedEndTime: this.estimatedEndTime,
            actualStartTime: this.actualStartTime, actualEndTime: this.actualEndTime,
            supportedFiles: this.supportedFiles, createdAt: this.createdAt, updatedAt: this.updatedAt
        };
    }
}

import { Task } from '../entities/task';
import { ITaskReader } from '../repositories/task_repository';
import { DomainValidationError, NotFoundError } from '../errors';

export interface ICostCalculator {
    calculateCost(task: Task): number;
}

const HOURLY_RATE = 50;

export class StandardCostCalculator implements ICostCalculator {
    calculateCost(task: Task): number {
        return (task.estimatedHours() ?? 0) * HOURLY_RATE;
    }
}

export class UrgentCostCalculator implements ICostCalculator {
    calculateCost(task: Task): number {
        return (task.estimatedHours() ?? 0) * HOURLY_RATE * 1.5;
    }
}

export const COST_CALCULATORS: Record<string, () => ICostCalculator> = {
    standard: () => new StandardCostCalculator(),
    urgent: () => new UrgentCostCalculator()
};

export class TaskCostService {
    constructor(private readonly calculator: ICostCalculator) {}

    processCost(task: Task): number {
        return this.calculator.calculateCost(task);
    }
}

export class TaskQueryService {
    constructor(private readonly reader: ITaskReader) {}

    async estimateCost(taskId: string, type: string) {
        const factory = COST_CALCULATORS[type];
        if (!factory) {
            throw new DomainValidationError(`Tipo de costo no soportado. Valores permitidos: ${Object.keys(COST_CALCULATORS).join(', ')}`);
        }
        const task = await this.reader.findById(taskId);
        if (!task) throw new NotFoundError('La tarea no existe');
        const hours = task.estimatedHours();
        if (hours === null) throw new DomainValidationError('La tarea no tiene fechas estimadas de inicio y fin.');
        return { task_id: taskId, type, hours, rate_per_hour: HOURLY_RATE, cost: new TaskCostService(factory()).processCost(task) };
    }
}

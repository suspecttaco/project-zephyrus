import sinon from 'sinon';
import { expect } from 'chai';
import { Task } from '../../src/domain/entities/task';
import { DomainValidationError, NotFoundError } from '../../src/domain/errors';
import { Priority, Status } from '../../src/domain/task_status';
import { CreateTaskUseCase } from '../../src/use-cases/create_task_use_case';
import { InMemoryReferenceLookup, InMemoryTaskRepository } from '../../src/adapters/repositories/in_memory_task_repository';
import { ITaskReader } from '../../src/domain/repositories/task_repository';
import { COST_CALCULATORS, StandardCostCalculator, TaskCostService, TaskQueryService, UrgentCostCalculator } from '../../src/domain/cost/task_cost';
import { taskRepositoryContract } from '../helpers/task_repository_contract';

const PROJECT = 'p-1';
const USER = 'u-1';
const at = (h: number) => new Date(Date.UTC(2026, 10, 1, h));

describe('Capa 1: entidad Task (reglas de negocio puras)', () => {
    it('crea una tarea válida con valores por defecto', () => {
        const task = new Task({ name: '  Diseñar API  ', projectId: PROJECT });
        expect(task.name).to.equal('Diseñar API');
        expect(task.status).to.equal(Status.NotStarted);
        expect(task.priority).to.equal(Priority.Medium);
    });

    it('rechaza nombres demasiado cortos o largos', () => {
        expect(() => new Task({ name: 'ab', projectId: PROJECT })).to.throw(DomainValidationError, 'entre 3 y 30');
        expect(() => new Task({ name: 'x'.repeat(31), projectId: PROJECT })).to.throw(DomainValidationError);
        expect(() => new Task({ name: '   ', projectId: PROJECT })).to.throw(DomainValidationError);
    });

    it('exige un proyecto, una prioridad válida y fechas coherentes', () => {
        expect(() => new Task({ name: 'Tarea', projectId: '' })).to.throw('proyecto válido');
        expect(() => new Task({ name: 'Tarea', projectId: PROJECT, priority: 'Urgente' as any })).to.throw('Prioridad inválida');
        expect(() => new Task({ name: 'Tarea', projectId: PROJECT, estimatedStartTime: at(10), estimatedEndTime: at(10) })).to.throw('posterior');
        expect(() => new Task({ name: 'Tarea', projectId: PROJECT, estimatedStartTime: at(10), estimatedEndTime: at(9) })).to.throw(DomainValidationError);
    });

    it('calcula las horas estimadas, o null si no hay fechas', () => {
        expect(new Task({ name: 'Tarea', projectId: PROJECT, estimatedStartTime: at(8), estimatedEndTime: at(14) }).estimatedHours()).to.equal(6);
        expect(new Task({ name: 'Tarea', projectId: PROJECT }).estimatedHours()).to.equal(null);
    });

    it('reutiliza la máquina de estados del flujo de trabajo', () => {
        expect(new Task({ name: 'Tarea', projectId: PROJECT, status: Status.InReview }).status).to.equal(Status.InReview);
    });
});

describe('Capa 2: CreateTaskUseCase (SRP + DIP)', () => {
    const build = (projects = [PROJECT], users = [USER]) => {
        const repo = new InMemoryTaskRepository();
        const notifier = { notifyTaskCreated: sinon.spy() };
        return { repo, notifier, useCase: new CreateTaskUseCase(repo, new InMemoryReferenceLookup(projects, users), notifier) };
    };

    it('crea y guarda la tarea, y avisa al notificador con la tarea ya guardada', async () => {
        const { useCase, repo, notifier } = build();
        const task = await useCase.execute({ name: 'Nueva tarea', projectId: PROJECT, assignedUserId: USER });
        expect(task.id).to.be.a('string');
        expect(repo.items.size).to.equal(1);
        expect(notifier.notifyTaskCreated.calledOnce).to.be.true;
        expect(notifier.notifyTaskCreated.firstCall.args[0].id).to.equal(task.id);
    });

    it('responde NotFoundError si el proyecto o el usuario no existen, sin guardar ni notificar', async () => {
        const noProject = build([], [USER]);
        let error: any;
        try { await noProject.useCase.execute({ name: 'Nueva tarea', projectId: PROJECT, assignedUserId: USER }); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(NotFoundError);
        expect(error.message).to.contain('proyecto');

        const noUser = build([PROJECT], []);
        try { await noUser.useCase.execute({ name: 'Nueva tarea', projectId: PROJECT, assignedUserId: USER }); } catch (e) { error = e; }
        expect(error.message).to.contain('usuario');
        expect(noUser.repo.items.size).to.equal(0);
        expect(noUser.notifier.notifyTaskCreated.called).to.be.false;
    });

    it('valida con la entidad antes de consultar cualquier dependencia', async () => {
        const references = { projectExists: sinon.stub().resolves(true), userExists: sinon.stub().resolves(true) };
        const useCase = new CreateTaskUseCase(new InMemoryTaskRepository(), references);
        let error: any;
        try { await useCase.execute({ name: 'x', projectId: PROJECT }); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(DomainValidationError);
        expect(references.projectExists.called).to.be.false;
    });

    it('una tarea nueva siempre inicia en Not-Started: no se puede crear ya completada', async () => {
        const { useCase } = build();
        let error: any;
        try { await useCase.execute({ name: 'Nueva tarea', projectId: PROJECT, status: Status.Completed }); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(DomainValidationError);
        expect((await useCase.execute({ name: 'Otra tarea', projectId: PROJECT, status: Status.NotStarted })).status).to.equal(Status.NotStarted);
    });

    it('el usuario asignado es opcional y el notificador también', async () => {
        const repo = new InMemoryTaskRepository();
        const task = await new CreateTaskUseCase(repo, new InMemoryReferenceLookup([PROJECT])).execute({ name: 'Sin asignar', projectId: PROJECT });
        expect(task.assignedUserId).to.equal(undefined);
    });

    it('es independiente del framework: ni Express ni TypeORM aparecen en las capas internas', () => {
        const fs = require('fs');
        const inner = ['src/domain/entities/task.ts', 'src/domain/errors.ts', 'src/domain/task_status.ts', 'src/domain/task_workflow.ts',
            'src/domain/repositories/task_repository.ts', 'src/domain/cost/task_cost.ts', 'src/use-cases/create_task_use_case.ts'];
        for (const file of inner) {
            const imports: string[] = (fs.readFileSync(file, 'utf8').match(/from '[^']+'/g) ?? []);
            for (const imp of imports) {
                expect(imp, `${file} importa ${imp}`).to.not.match(/typeorm|express|pg|redis|bull|\/adapters\/|\/components\/|\/utils\//);
            }
        }
    });
});

taskRepositoryContract('en memoria', async () => {
    let n = 0;
    return { repo: new InMemoryTaskRepository(), projectId: 'proj-a', otherProjectId: 'proj-b', userId: 'user-1', uniqueName: () => `Tarea ${n++}` };
});

describe('OCP: calculadoras de costo intercambiables', () => {
    const task = new Task({ name: 'Tarea', projectId: PROJECT, estimatedStartTime: at(8), estimatedEndTime: at(18) });

    it('cada tarifa calcula su costo sin modificar el servicio', () => {
        expect(new TaskCostService(new StandardCostCalculator()).processCost(task)).to.equal(500);
        expect(new TaskCostService(new UrgentCostCalculator()).processCost(task)).to.equal(750);
    });

    it('una tarifa nueva se agrega como clase sin tocar el código existente', () => {
        class FreeCalculator { calculateCost() { return 0; } }
        expect(new TaskCostService(new FreeCalculator()).processCost(task)).to.equal(0);
        expect(Object.keys(COST_CALCULATORS)).to.have.members(['standard', 'urgent']);
    });
});

describe('ISP: TaskQueryService depende solo de la interfaz de lectura', () => {
    const readerOnly = (task: Task | null): ITaskReader => ({
        findById: async () => task,
        findByProjectId: async () => []
    });

    it('estima el costo leyendo la tarea', async () => {
        const task = new Task({ name: 'Tarea', projectId: PROJECT, estimatedStartTime: at(8), estimatedEndTime: at(10) });
        const result = await new TaskQueryService(readerOnly(task)).estimateCost('t', 'urgent');
        expect(result).to.deep.equal({ task_id: 't', type: 'urgent', hours: 2, rate_per_hour: 50, cost: 150 });
    });

    it('falla con NotFoundError, tarifa desconocida o tarea sin fechas', async () => {
        let error: any;
        try { await new TaskQueryService(readerOnly(null)).estimateCost('t', 'standard'); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(NotFoundError);
        try { await new TaskQueryService(readerOnly(new Task({ name: 'Tarea', projectId: PROJECT }))).estimateCost('t', 'standard'); } catch (e) { error = e; }
        expect(error.message).to.contain('fechas estimadas');
        try { await new TaskQueryService(readerOnly(null)).estimateCost('t', 'gratis'); } catch (e) { error = e; }
        expect(error.message).to.contain('standard, urgent');
    });
});

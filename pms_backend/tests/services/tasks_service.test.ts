import sinon from 'sinon';
import { expect } from 'chai';
import { DatabaseUtil } from '../../src/utils/db';
import { TaskService } from '../../src/components/tasks/tasks_service';
import { Projects } from '../../src/components/projects/projects_entity';
import { Users } from '../../src/components/users/users_entity';
import { Status } from '../../src/components/tasks/tasks_entity';
import { WorkflowError } from '../../src/domain/task_workflow';
import { TaskTransactionService } from '../../src/components/tasks/task_transaction_service';

const stubRepos = (repos: Map<any, any>) =>
    sinon.stub(DatabaseUtil.prototype, 'getRepository').callsFake(((entity: any) => repos.get(entity) ?? {}) as any);

describe('Pruebas unitarias: TaskService', () => {
    afterEach(() => sinon.restore());

    it('create retorna 404 si el proyecto no existe', async () => {
        stubRepos(new Map([[Projects, { findOneBy: sinon.stub().resolves(null) }]]));
        const result = await new TaskService().create({ project_id: 'p', user_id: 'u' });
        expect(result.statusCode).to.equal(404);
        expect(result.message).to.contain('proyecto');
    });

    it('create retorna 404 si el usuario asignado no existe', async () => {
        stubRepos(new Map<any, any>([
            [Projects, { findOneBy: sinon.stub().resolves({}) }],
            [Users, { findOneBy: sinon.stub().resolves(null) }]
        ]));
        const result = await new TaskService().create({ project_id: 'p', user_id: 'u' });
        expect(result.statusCode).to.equal(404);
        expect(result.message).to.contain('usuario');
    });

    it('iniciar una tarea delega en la transacción SERIALIZABLE con límite de tareas en progreso', async () => {
        const task: any = { task_id: 't', status: Status.NotStarted };
        sinon.stub(DatabaseUtil.prototype, 'getRepository').returns({ findOne: sinon.stub().resolves(task), save: sinon.stub() } as any);
        const started = sinon.stub(TaskTransactionService.prototype, 'startTaskWithLimit').resolves({ task_id: 't', status: Status.InProgress } as any);

        expect((await new TaskService().updateTaskStatus('t', Status.InProgress) as any).status).to.equal(Status.InProgress);
        await new TaskService().performWorkflowAction('t', 'start');
        expect(started.callCount).to.equal(2);
        expect(started.alwaysCalledWith('t')).to.be.true;
    });

    it('las demás transiciones (revisión, aprobación) no pasan por la transacción del límite', async () => {
        const repo = { findOne: sinon.stub().resolves({ task_id: 't', status: Status.InProgress }), save: sinon.stub().callsFake(async (t: any) => t) };
        sinon.stub(DatabaseUtil.prototype, 'getRepository').returns(repo as any);
        const started = sinon.stub(TaskTransactionService.prototype, 'startTaskWithLimit');
        const updated: any = await new TaskService().updateTaskStatus('t', Status.InReview);
        expect(updated.status).to.equal(Status.InReview);
        expect(started.called).to.be.false;
    });

    it('updateTaskStatus registra inicio y fin reales al completar (aprobar desde revisión)', async () => {
        const task: any = { task_id: 't', status: Status.InReview };
        const repo = { findOne: sinon.stub().resolves(task), save: sinon.stub().callsFake(async (t: any) => t) };
        sinon.stub(DatabaseUtil.prototype, 'getRepository').returns(repo as any);

        const updated: any = await new TaskService().updateTaskStatus('t', Status.Completed);

        expect(updated.actual_start_time).to.be.instanceOf(Date);
        expect(updated.actual_end_time).to.be.instanceOf(Date);
    });

    it('updateTaskStatus rechaza saltarse la revisión (patrón State)', async () => {
        const repo = { findOne: sinon.stub().resolves({ task_id: 't', status: Status.InProgress }), save: sinon.stub() };
        sinon.stub(DatabaseUtil.prototype, 'getRepository').returns(repo as any);
        let error: any;
        try { await new TaskService().updateTaskStatus('t', Status.Completed); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(WorkflowError);
        expect(repo.save.called).to.be.false;
    });

    it('updateTaskStatus retorna null si la tarea no existe', async () => {
        sinon.stub(DatabaseUtil.prototype, 'getRepository').returns({ findOne: sinon.stub().resolves(null) } as any);
        expect(await new TaskService().updateTaskStatus('x', Status.Completed)).to.equal(null);
    });

    describe('update', () => {
        it('retorna 404 si se mueve la tarea a un proyecto inexistente', async () => {
            stubRepos(new Map([[Projects, { findOneBy: sinon.stub().resolves(null) }]]));
            const result = await new TaskService().update('t', { project_id: '00000000-0000-4000-8000-000000000000' });
            expect(result.statusCode).to.equal(404);
        });

        it('nunca consulta con un valor vacío (TypeORM devolvería el primer registro)', async () => {
            const findOneBy = sinon.stub().resolves({ project_id: 'primero' });
            stubRepos(new Map([[Projects, { findOneBy }]]));
            const result = await new TaskService().update('t', { project_id: '' });
            expect(result.statusCode).to.equal(404);
            expect(findOneBy.called).to.be.false;
        });

        it('sin project_id ni user_id no valida referencias y delega en la actualización', async () => {
            const repo = { findOne: sinon.stub().resolves({ task_id: 't' }), merge: sinon.stub(), save: sinon.stub().resolves({ task_id: 't' }) };
            sinon.stub(DatabaseUtil.prototype, 'getRepository').returns(repo as any);
            const result = await new TaskService().update('t', { description: 'nueva' });
            expect(result.statusCode).to.equal(200);
        });
    });
});

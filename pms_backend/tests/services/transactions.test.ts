import sinon from 'sinon';
import { expect } from 'chai';
import { executeSerializableTransaction, isSerializationFailure } from '../../src/utils/serializable_retry';
import { TaskTransactionService } from '../../src/components/tasks/task_transaction_service';
import { Tasks, Status } from '../../src/components/tasks/tasks_entity';
import { TaskLimitError, WorkflowError } from '../../src/domain/task_workflow';

const serializationError = () => Object.assign(new Error('could not serialize access due to read/write dependencies'), { code: '40001' });

describe('executeSerializableTransaction: reintento con backoff exponencial y jitter', () => {
    beforeEach(() => { sinon.stub(console, 'warn'); });
    afterEach(() => sinon.restore());

    it('reconoce el error 40001 de PostgreSQL (también envuelto por TypeORM)', () => {
        expect(isSerializationFailure({ code: '40001' })).to.be.true;
        expect(isSerializationFailure({ driverError: { code: '40001' } })).to.be.true;
        expect(isSerializationFailure(new Error('ERROR: could not serialize access due to concurrent update'))).to.be.true;
        expect(isSerializationFailure({ code: '23505' })).to.be.false;
        expect(isSerializationFailure(undefined)).to.be.false;
    });

    it('devuelve el resultado sin reintentar si la operación funciona', async () => {
        const op = sinon.stub().resolves('listo');
        expect(await executeSerializableTransaction(op)).to.equal('listo');
        expect(op.calledOnce).to.be.true;
    });

    it('reintenta tras un conflicto de serialización y termina con éxito', async () => {
        const op = sinon.stub();
        op.onFirstCall().rejects(serializationError());
        op.onSecondCall().resolves('éxito en el intento 2');
        const onRetry = sinon.spy();
        expect(await executeSerializableTransaction(op, { maxRetries: 3, initialDelayMs: 1, onRetry })).to.equal('éxito en el intento 2');
        expect(op.callCount).to.equal(2);
        expect(onRetry.calledOnce).to.be.true;
    });

    it('la espera crece exponencialmente (con jitter de hasta 50 ms)', async () => {
        const delays: number[] = [];
        const op = sinon.stub().rejects(serializationError());
        op.onCall(3).resolves('ok');
        await executeSerializableTransaction(op, { maxRetries: 5, initialDelayMs: 10, onRetry: (_a, d) => delays.push(d) });
        expect(delays).to.have.lengthOf(3);
        [10, 20, 40].forEach((base, i) => expect(delays[i]).to.be.within(base, base + 49));
    });

    it('se rinde al agotar los reintentos y relanza el error original', async () => {
        const op = sinon.stub().rejects(serializationError());
        let error: any;
        try { await executeSerializableTransaction(op, { maxRetries: 2, initialDelayMs: 1 }); } catch (e) { error = e; }
        expect(error.code).to.equal('40001');
        expect(op.callCount).to.equal(3);
    });

    it('no reintenta otros errores (reglas de negocio, claves duplicadas...)', async () => {
        const op = sinon.stub().rejects(new TaskLimitError('límite'));
        let error: any;
        try { await executeSerializableTransaction(op, { maxRetries: 3, initialDelayMs: 1 }); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(TaskLimitError);
        expect(op.calledOnce).to.be.true;
    });
});

describe('TaskTransactionService con una conexión simulada', () => {
    const build = (task: any, counts: number[] = [0]) => {
        const manager = {
            findOne: sinon.stub().resolves(task),
            count: sinon.stub(),
            save: sinon.stub().callsFake(async (t: any) => t)
        };
        counts.forEach((c, i) => manager.count.onCall(i).resolves(c));
        const runner = {
            connect: sinon.stub().resolves(),
            startTransaction: sinon.stub().resolves(),
            commitTransaction: sinon.stub().resolves(),
            rollbackTransaction: sinon.stub().resolves(),
            release: sinon.stub().resolves(),
            manager
        };
        const ds = { createQueryRunner: () => runner } as any;
        return { runner, manager, service: (opts = {}) => new TaskTransactionService({ maxRetries: 2, ...opts }, () => ds) };
    };
    beforeEach(() => { sinon.stub(console, 'warn'); });
    afterEach(() => sinon.restore());

    it('abre la transacción en SERIALIZABLE, confirma y libera la conexión', async () => {
        const { runner, service } = build({ task_id: 't', project_id: 'p', status: Status.NotStarted });
        const task: any = await service().startTaskWithLimit('t');
        expect(runner.startTransaction.calledOnceWith('SERIALIZABLE')).to.be.true;
        expect(task.status).to.equal(Status.InProgress);
        expect(task.actual_start_time).to.be.instanceOf(Date);
        expect(runner.commitTransaction.calledOnce).to.be.true;
        expect(runner.rollbackTransaction.called).to.be.false;
        expect(runner.release.calledOnce).to.be.true;
    });

    it('rechaza iniciar cuando el proyecto ya alcanzó el límite, con rollback y sin escribir', async () => {
        const { runner, manager, service } = build({ task_id: 't', project_id: 'p', status: Status.NotStarted }, [5]);
        let error: any;
        try { await service({ limit: 5 }).startTaskWithLimit('t'); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(TaskLimitError);
        expect(error.message).to.contain('5 tareas en progreso');
        expect(manager.save.called).to.be.false;
        expect(runner.rollbackTransaction.calledOnce).to.be.true;
        expect(runner.commitTransaction.called).to.be.false;
        expect(runner.release.calledOnce).to.be.true;
    });

    it('permite iniciar mientras haya cupo (4 de 5)', async () => {
        const { service } = build({ task_id: 't', project_id: 'p', status: Status.NotStarted }, [4]);
        expect(((await service({ limit: 5 }).startTaskWithLimit('t')) as any).status).to.equal(Status.InProgress);
    });

    it('no consume cupo ni consulta el conteo si la tarea ya estaba en progreso', async () => {
        const { manager, service } = build({ task_id: 't', project_id: 'p', status: Status.InProgress }, [99]);
        await service().startTaskWithLimit('t');
        expect(manager.count.called).to.be.false;
        expect(manager.save.called).to.be.false;
    });

    it('rechaza las transiciones ilegales y devuelve null si la tarea no existe', async () => {
        let error: any;
        try { await build({ task_id: 't', project_id: 'p', status: Status.Completed }).service().startTaskWithLimit('t'); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(WorkflowError);
        expect(await build(null).service().startTaskWithLimit('t')).to.equal(null);
    });

    it('un conflicto de serialización hace rollback y reintenta toda la transacción', async () => {
        const { runner, manager, service } = build({ task_id: 't', project_id: 'p', status: Status.NotStarted });
        manager.save.onFirstCall().rejects(serializationError());
        const retries: number[] = [];
        const task: any = await service({ onRetry: (a: number) => retries.push(a) }).startTaskWithLimit('t');
        expect(task.status).to.equal(Status.InProgress);
        expect(retries).to.deep.equal([1]);
        expect(runner.rollbackTransaction.calledOnce).to.be.true;
        expect(runner.commitTransaction.calledOnce).to.be.true;
        expect(runner.release.calledTwice).to.be.true;
    });

    it('los adjuntos se leen con bloqueo de fila (SELECT ... FOR UPDATE)', async () => {
        const { manager, service } = build({ task_id: 't', supported_files: JSON.stringify([{ name: 'a.txt' }]) });
        expect(await service().addAttachment('t', { name: 'b.txt' })).to.equal('ok');
        expect(manager.findOne.firstCall.args[1]).to.deep.include({ lock: { mode: 'pessimistic_write' } });
        expect(JSON.parse(manager.save.firstCall.args[0].supported_files).map((a: any) => a.name)).to.deep.equal(['a.txt', 'b.txt']);
    });

    it('agregar un adjunto con un nombre existente lo reemplaza; eliminar uno inexistente informa', async () => {
        const task = { task_id: 't', supported_files: JSON.stringify([{ name: 'a.txt', size: 1 }]) };
        const { manager, service } = build(task);
        await service().addAttachment('t', { name: 'a.txt', size: 2 });
        expect(JSON.parse(manager.save.firstCall.args[0].supported_files)).to.deep.equal([{ name: 'a.txt', size: 2 }]);
        expect(await service().removeAttachment('t', 'nada.txt')).to.equal('attachment_not_found');
        expect(await build(null).service().addAttachment('t', { name: 'x' })).to.equal('task_not_found');
    });
});

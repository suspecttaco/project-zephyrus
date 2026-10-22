import sinon from 'sinon';
import { expect } from 'chai';
import { Status } from '../../src/components/tasks/tasks_entity';
import { TaskWorkflow, WorkflowError } from '../../src/domain/task_workflow';
import { Pipeline, Context } from '../../src/core/middleware_pipeline';
import { fetchInBatches, pagedFetcher } from '../../src/utils/async_iterator';
import { BaseReportGenerator } from '../../src/reports/base_report_generator';
import { CsvReportGenerator, JsonReportGenerator, ReportDataSource, ReportNotFoundError, csvCell, reportGeneratorFor } from '../../src/reports/project_report_generators';
import { AssignUserCommand, CommandManager, CommandHistoryStore, SerializedCommand, IAssignmentService, SerializableCommand } from '../../src/commands/task_commands';

describe('Patrón State: TaskWorkflow', () => {
    beforeEach(() => sinon.stub(console, 'log'));
    afterEach(() => sinon.restore());

    it('recorre el ciclo completo: Not-Started -> In-Progress -> In-Review -> Completed', () => {
        const wf = new TaskWorkflow('t1');
        expect(wf.getStatus()).to.equal(Status.NotStarted);
        wf.startWork();
        expect(wf.getStatus()).to.equal(Status.InProgress);
        wf.submitForReview();
        expect(wf.getStatus()).to.equal(Status.InReview);
        wf.approve();
        expect(wf.getStatus()).to.equal(Status.Completed);
    });

    const illegal: [Status, 'startWork' | 'submitForReview' | 'approve', string][] = [
        [Status.NotStarted, 'submitForReview', 'no se ha iniciado'],
        [Status.NotStarted, 'approve', 'no se ha iniciado'],
        [Status.InProgress, 'approve', 'revisión antes de aprobar'],
        [Status.InReview, 'startWork', 'revisión no puede reiniciarse'],
        [Status.Completed, 'startWork', 'no admite cambios'],
        [Status.Completed, 'submitForReview', 'ya completada'],
        [Status.Completed, 'approve', 'ya completada']
    ];
    illegal.forEach(([from, action, text]) => {
        it(`desde ${from}, ${action}() es una transición no permitida`, () => {
            const wf = new TaskWorkflow('t', from);
            expect(() => wf[action]()).to.throw(WorkflowError, text);
            expect(wf.getStatus()).to.equal(from);
        });
    });

    it('las acciones repetidas en el mismo estado son idempotentes', () => {
        const wf = new TaskWorkflow('t', Status.InProgress);
        wf.startWork();
        expect(wf.getStatus()).to.equal(Status.InProgress);
    });

    it('moveTo traduce un estado destino a la transición correspondiente', () => {
        const wf = new TaskWorkflow('t');
        wf.moveTo(Status.InProgress);
        wf.moveTo(Status.InReview);
        wf.moveTo(Status.InReview);
        expect(wf.getStatus()).to.equal(Status.InReview);
        expect(() => wf.moveTo(Status.NotStarted)).to.throw(WorkflowError, 'No se puede regresar');
        expect(() => new TaskWorkflow('t').moveTo(Status.Completed)).to.throw(WorkflowError);
    });

    it('perform ejecuta la acción nombrada', () => {
        const wf = new TaskWorkflow('t');
        wf.perform('start'); wf.perform('submit'); wf.perform('approve');
        expect(wf.getStatus()).to.equal(Status.Completed);
    });
});

describe('Patrón Middleware: Pipeline (modelo cebolla)', () => {
    it('ejecuta en orden de entrada y en orden inverso de salida', async () => {
        const trace: string[] = [];
        const pipeline = new Pipeline()
            .use(async (_c, next) => { trace.push('A entra'); await next(); trace.push('A sale'); })
            .use(async (_c, next) => { trace.push('B entra'); await next(); trace.push('B sale'); })
            .use(async () => { trace.push('núcleo'); });
        await pipeline.execute({});
        expect(trace).to.deep.equal(['A entra', 'B entra', 'núcleo', 'B sale', 'A sale']);
    });

    it('comparte el contexto entre middlewares', async () => {
        const ctx: Context = {};
        await new Pipeline().use(async (c, next) => { c.user = 'ana'; await next(); }).use(async (c) => { c.response = `hola ${c.user}`; }).execute(ctx);
        expect(ctx.response).to.equal('hola ana');
    });

    it('un middleware puede cortar la cadena sin llamar a next()', async () => {
        const reached = sinon.spy();
        await new Pipeline().use(async () => undefined).use(reached).execute({});
        expect(reached.called).to.be.false;
    });

    it('propaga los errores a quien ejecuta el pipeline', async () => {
        const pipeline = new Pipeline().use(async (_c, next) => { await next(); }).use(async () => { throw new Error('boom'); });
        let error: any;
        try { await pipeline.execute({}); } catch (e) { error = e; }
        expect(error.message).to.equal('boom');
    });

    it('next(err) lanza el error recibido', async () => {
        let error: any;
        try { await new Pipeline().use(async (_c, next) => { await next(new Error('fallo')); }).execute({}); } catch (e) { error = e; }
        expect(error.message).to.equal('fallo');
    });

    it('detecta next() llamado más de una vez', async () => {
        let error: any;
        try { await new Pipeline().use(async (_c, next) => { await next(); await next(); }).use(async () => undefined).execute({}); } catch (e) { error = e; }
        expect(error.message).to.contain('múltiples veces');
    });
});

describe('Iteradores asíncronos', () => {
    it('fetchInBatches entrega los lotes en orden y se detiene al terminar', async () => {
        const fetcher = async (p: number) => (p > 3 ? { items: [], nextPage: null } : { items: [`a${p}`, `b${p}`], nextPage: p + 1 });
        const batches: string[][] = [];
        for await (const batch of fetchInBatches(fetcher)) batches.push(batch);
        expect(batches).to.deep.equal([['a1', 'b1'], ['a2', 'b2'], ['a3', 'b3']]);
    });

    it('pagedFetcher convierte skip/take en páginas y termina con la primera página incompleta', async () => {
        const data = Array.from({ length: 25 }, (_, i) => i);
        const query = sinon.spy(async (skip: number, take: number) => data.slice(skip, skip + take));
        const all: number[] = [];
        for await (const batch of fetchInBatches(pagedFetcher(query, 10))) all.push(...batch);
        expect(all).to.deep.equal(data);
        expect(query.args.map((a) => [a[0], a[1]])).to.deep.equal([[0, 10], [10, 10], [20, 10]]);
    });

    it('una consulta vacía no produce lotes', async () => {
        const out: any[] = [];
        for await (const batch of fetchInBatches(pagedFetcher(async () => [], 10))) out.push(batch);
        expect(out).to.have.lengthOf(0);
    });
});

describe('Patrón Template Method + Strategy: reportes de proyecto', () => {
    const source = (tasks: any[], project: any = { project_id: 'p1', name: 'Proyecto, "uno"', status: 'Planning' }): ReportDataSource => ({
        getProject: async () => project,
        taskBatches: async function* () { yield tasks.slice(0, 2); yield tasks.slice(2); }
    });
    const tasks = [
        { task_id: 't1', name: 'Diseño', status: 'Completed', priority: 'High', user_id: 'u1', actual_start_time: '2026-10-01T10:00:00Z' },
        { task_id: 't2', name: 'Código, con coma', status: 'In-Progress', priority: 'Low', user_id: 'u2' },
        { task_id: 't3', name: '=HYPERLINK("http://x")', status: 'In-Progress', priority: 'Medium', user_id: null }
    ];
    beforeEach(() => sinon.stub(console, 'log'));
    afterEach(() => sinon.restore());

    it('generate() ejecuta los pasos en el orden del esqueleto', async () => {
        const order: string[] = [];
        class Probe extends BaseReportGenerator {
            contentType = 'x'; extension = 'x';
            protected async fetchData() { order.push('fetch'); return 1; }
            protected formatData(d: number) { order.push('format'); return d; }
            protected async exportFile() { order.push('export'); return Buffer.from(''); }
            protected async auditLog() { order.push('audit'); }
        }
        await new Probe().generate('p');
        expect(order).to.deep.equal(['fetch', 'format', 'export', 'audit']);
    });

    it('CSV: una fila por tarea, leyendo todos los lotes, con encabezado', async () => {
        const csv = (await new CsvReportGenerator(source(tasks)).generate('p1')).toString();
        const lines = csv.trim().split('\n');
        expect(lines[0]).to.equal('task_id,tarea,estado,prioridad,usuario_asignado,inicio_estimado,fin_estimado,inicio_real,fin_real');
        expect(lines).to.have.lengthOf(4);
        expect(lines[1]).to.contain('t1,Diseño,Completed,High,u1').and.contain('2026-10-01T10:00:00.000Z');
    });

    it('CSV: escapa comas y comillas, y neutraliza fórmulas (inyección CSV)', async () => {
        const csv = (await new CsvReportGenerator(source(tasks)).generate('p1')).toString();
        expect(csv).to.contain('"Código, con coma"');
        expect(csv).to.contain(`"'=HYPERLINK(""http://x"")"`);
        expect(csvCell('+1')).to.equal("'+1");
        expect(csvCell('-2')).to.equal("'-2");
        expect(csvCell('@a')).to.equal("'@a");
        expect(csvCell('normal')).to.equal('normal');
        expect(csvCell(null)).to.equal('');
    });

    it('JSON: incluye el resumen por estado y el total', async () => {
        const json = JSON.parse((await new JsonReportGenerator(source(tasks)).generate('p1')).toString());
        expect(json.total_tasks).to.equal(3);
        expect(json.summary).to.deep.equal({ Completed: 1, 'In-Progress': 2 });
        expect(json.project).to.include({ project_id: 'p1' });
        expect(json.tasks).to.have.lengthOf(3);
    });

    it('lanza ReportNotFoundError si el proyecto no existe', async () => {
        let error: any;
        try { await new CsvReportGenerator(source([], null)).generate('nada'); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(ReportNotFoundError);
    });

    it('la estrategia se elige por formato y rechaza los desconocidos', () => {
        expect(reportGeneratorFor('csv', source([]))).to.be.instanceOf(CsvReportGenerator);
        expect(reportGeneratorFor('json', source([]))).to.be.instanceOf(JsonReportGenerator);
        expect(() => reportGeneratorFor('pdf')).to.throw('no soportado');
    });
});

describe('Patrón Command: AssignUserCommand y CommandManager', () => {
    const memoryStore = (): CommandHistoryStore & { data: Map<string, SerializedCommand[]> } => {
        const data = new Map<string, SerializedCommand[]>();
        return {
            data,
            async push(k, e) { data.set(k, [...(data.get(k) ?? []), e]); },
            async pop(k) { const l = data.get(k) ?? []; const e = l.pop() ?? null; data.set(k, l); return e; }
        };
    };
    const fakeService = (): IAssignmentService & { assign: sinon.SinonStub; unassign: sinon.SinonStub } =>
        ({ assign: sinon.stub().resolves(), unassign: sinon.stub().resolves() });
    const managerFor = (service: IAssignmentService, store: CommandHistoryStore) =>
        new CommandManager(store, (e): SerializableCommand => new AssignUserCommand(e.taskId, e.newUserId, e.previousUserId, service));
    beforeEach(() => sinon.stub(console, 'log'));
    afterEach(() => sinon.restore());

    it('execute asigna, y undo restaura al usuario anterior', async () => {
        const service = fakeService();
        const cmd = new AssignUserCommand('t', 'nuevo', 'anterior', service);
        await cmd.execute();
        await cmd.undo();
        expect(service.assign.args).to.deep.equal([['t', 'nuevo'], ['t', 'anterior']]);
    });

    it('si no había usuario anterior, undo quita la asignación', async () => {
        const service = fakeService();
        await new AssignUserCommand('t', 'nuevo', null, service).undo();
        expect(service.unassign.calledOnceWith('t')).to.be.true;
    });

    it('el manager ejecuta, guarda el historial y deshace en orden inverso (LIFO)', async () => {
        const service = fakeService();
        const store = memoryStore();
        const manager = managerFor(service, store);

        await manager.run('t', new AssignUserCommand('t', 'u2', 'u1', service));
        await manager.run('t', new AssignUserCommand('t', 'u3', 'u2', service));
        expect(store.data.get('t')).to.have.lengthOf(2);

        expect(await manager.undoLast('t')).to.be.true;
        expect(service.assign.lastCall.args).to.deep.equal(['t', 'u2']);
        expect(await manager.undoLast('t')).to.be.true;
        expect(service.assign.lastCall.args).to.deep.equal(['t', 'u1']);
        expect(await manager.undoLast('t')).to.be.false;
    });

    it('si execute falla, el comando no se guarda en el historial', async () => {
        const service = fakeService();
        service.assign.rejects(new Error('sin permiso'));
        const store = memoryStore();
        let error: any;
        try { await managerFor(service, store).run('t', new AssignUserCommand('t', 'u', null, service)); } catch (e) { error = e; }
        expect(error.message).to.equal('sin permiso');
        expect(store.data.get('t') ?? []).to.have.lengthOf(0);
    });

    it('el comando se serializa para poder reconstruirse en otro proceso', () => {
        expect(new AssignUserCommand('t', 'n', 'p', fakeService()).serialize()).to.deep.equal({ type: 'assign_user', taskId: 't', newUserId: 'n', previousUserId: 'p' });
    });
});

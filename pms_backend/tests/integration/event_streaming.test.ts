import { expect } from 'chai';
import { DatabaseUtil } from '../../src/utils/db';
import { StreamProcessor } from '../../src/events/stream_processor';
import { CdcEventStore } from '../../src/events/event_store';
import { replay, TRACKED_FIELDS } from '../../src/events/stream_events';
import { ensureCdc } from '../../src/events/cdc';
import { api, auth, login, uniq } from './helpers';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Integración (PostgreSQL real): CDC, Event Sourcing, CQRS y ventanas', () => {
    let admin: string;
    let adminId: string;
    const db = () => new DatabaseUtil().getDataSource();
    const dbNow = async (): Promise<Date> => (await db().query(`select clock_timestamp() as t`))[0].t;

    before(async () => {
        admin = (await login()).access;
        adminId = (await api().get('/api/users?username=superadmin').set(auth(admin))).body.data[0].user_id;
    });

    const newProject = async () => (await api().post('/api/projects').set(auth(admin)).send({ name: `Ev${uniq()}` })).body.data.project_id;
    const newTask = async (projectId: string, extra: object = {}) =>
        (await api().post('/api/tasks').set(auth(admin)).send({ name: `T${uniq()}`, project_id: projectId, user_id: adminId, ...extra })).body.data;
    const workflow = (id: string, action: string) => api().post(`/api/tasks/${id}/workflow/${action}`).set(auth(admin));
    const changes = (taskId: string) => db().query(`select op, old_row, new_row from task_changes where task_id = $1 order by seq`, [taskId]);

    describe('CDC con triggers (captura el 100 % de las mutaciones)', () => {
        it('registra INSERT, UPDATE y DELETE con la fila anterior y la nueva', async () => {
            const project = await newProject();
            const task = await newTask(project);
            await workflow(task.task_id, 'start');
            await api().delete(`/api/tasks/${task.task_id}`).set(auth(admin));

            const rows = await changes(task.task_id);
            expect(rows.map((r: any) => r.op)).to.deep.equal(['I', 'U', 'D']);
            expect(rows[0].old_row).to.equal(null);
            expect(rows[0].new_row.status).to.equal('Not-Started');
            expect(rows[1].old_row.status).to.equal('Not-Started');
            expect(rows[1].new_row.status).to.equal('In-Progress');
            expect(rows[2].new_row).to.equal(null);
            expect(rows[2].old_row.status, 'el borrado conserva lo que tenía').to.equal('In-Progress');
        });

        it('captura también lo que se hace por SQL directo, sin pasar por la API', async () => {
            const project = await newProject();
            const task = await newTask(project);
            await db().query(`update tasks set priority = 'High' where task_id = $1`, [task.task_id]);
            const rows = await changes(task.task_id);
            expect(rows[rows.length - 1].new_row.priority).to.equal('High');
        });

        it('instantánea inicial: las tareas anteriores a los triggers entran al log al activar el CDC, sin duplicarse', async () => {
            const project = await newProject();
            await db().query(`ALTER TABLE tasks DISABLE TRIGGER trg_tasks_cdc`);
            let taskId: string;
            try {
                [{ task_id: taskId }] = await db().query(`insert into tasks (name, project_id, user_id) values ($1, $2, $3) returning task_id`, [`Previa${uniq()}`, project, adminId]);
            } finally {
                await db().query(`ALTER TABLE tasks ENABLE TRIGGER trg_tasks_cdc`);
            }
            expect(await changes(taskId!), 'sin CDC no había nada en el log').to.have.lengthOf(0);

            await ensureCdc(db());
            await ensureCdc(db());
            const rows = await changes(taskId!);
            expect(rows).to.have.lengthOf(1);
            expect(rows[0].op).to.equal('I');
            expect(rows[0].new_row.project_id).to.equal(project);
            const history = await api().get(`/api/tasks/${taskId!}/history`).set(auth(admin));
            expect(history.body.data.map((e: any) => e.eventType)).to.deep.equal(['TaskCreated']);
        });

        it('el log es inmutable: no se puede actualizar ni borrar', async () => {
            const task = await newTask(await newProject());
            for (const sql of [`update task_changes set op = 'D' where task_id = $1`, `delete from task_changes where task_id = $1`]) {
                let error: any;
                try { await db().query(sql, [task.task_id]); } catch (e) { error = e; }
                expect(error?.message, sql).to.contain('solo-añadir');
            }
            expect(await changes(task.task_id)).to.have.lengthOf(1);
        });

        it('la transacción que revierte un cambio también revierte su registro en el log', async () => {
            const project = await newProject();
            const runner = db().createQueryRunner();
            await runner.connect();
            await runner.startTransaction();
            const [{ task_id }] = await runner.query(`insert into tasks (name, project_id, user_id) values ($1, $2, $3) returning task_id`, [`R${uniq()}`, project, adminId]);
            await runner.rollbackTransaction();
            await runner.release();
            expect(await changes(task_id), 'sin doble escritura: el log y la tabla nunca se contradicen').to.have.lengthOf(0);
        });
    });

    describe('Event Sourcing: historial y viaje en el tiempo', () => {
        it('GET /api/tasks/:id/history devuelve los eventos de dominio en orden', async () => {
            const task = await newTask(await newProject());
            for (const a of ['start', 'submit', 'approve']) await workflow(task.task_id, a);
            const res = await api().get(`/api/tasks/${task.task_id}/history`).set(auth(admin));
            expect(res.status).to.equal(200);
            expect(res.body.data.map((e: any) => e.eventType)).to.deep.equal(
                ['TaskCreated', 'TaskStatusChanged', 'TaskFieldsChanged', 'TaskStatusChanged',
                 'TaskStatusChanged', 'TaskCompleted', 'TaskFieldsChanged']);
            expect(res.body.data[1].payload).to.deep.equal({ oldStatus: 'Not-Started', newStatus: 'In-Progress' });
        });

        it('el estado reconstruido solo con eventos coincide con la fila real de la tabla', async () => {
            const project = await newProject();
            const other = await newProject();
            const task = await newTask(project, { description: 'inicial' });
            await workflow(task.task_id, 'start');
            await api().put(`/api/tasks/${task.task_id}`).set(auth(admin)).send({ name: `Renombrada${uniq()}`, priority: 'High', description: 'editada', project_id: other });
            await workflow(task.task_id, 'submit');

            const state = replay(await new CdcEventStore().getEventStream(task.task_id))!;
            const [actual] = await db().query(`select * from tasks where task_id = $1`, [task.task_id]);
            const normalize = (value: any) => {
                if (value instanceof Date) return value.getTime();
                if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) && !value.startsWith('[')) return new Date(value).getTime();
                return value ?? null;
            };
            for (const field of TRACKED_FIELDS) {
                expect(normalize(state[field]), `campo ${field}`).to.equal(normalize(actual[field]));
            }
        });

        it('GET /api/tasks/:id/at?time= muestra el estado que tenía la tarea en cada instante', async () => {
            const task = await newTask(await newProject(), { description: 'v1' });
            const t0 = await dbNow();
            await sleep(30);
            await workflow(task.task_id, 'start');
            await sleep(30);
            const t1 = await dbNow();
            await sleep(30);
            await api().put(`/api/tasks/${task.task_id}`).set(auth(admin)).send({ description: 'v2' });
            await workflow(task.task_id, 'submit');
            await sleep(30);
            const t2 = await dbNow();
            await api().delete(`/api/tasks/${task.task_id}`).set(auth(admin));
            await sleep(30);
            const t3 = await dbNow();
            const at = (t: Date) => api().get(`/api/tasks/${task.task_id}/at?time=${t.toISOString()}`).set(auth(admin));

            const s0 = (await at(t0)).body.data.state;
            expect(s0).to.include({ status: 'Not-Started', description: 'v1' });
            const s1 = (await at(t1)).body.data.state;
            expect(s1).to.include({ status: 'In-Progress', description: 'v1' });
            const s2 = (await at(t2)).body.data.state;
            expect(s2).to.include({ status: 'In-Review', description: 'v2' });
            expect((await at(t3)).body.data.state.deleted, 'la tarea borrada sigue en la historia').to.equal(true);
            expect((await at(new Date(t0.getTime() - 60_000))).status, 'antes de existir').to.equal(404);
            expect((await api().get(`/api/tasks/${task.task_id}/at?time=ayer`).set(auth(admin))).status).to.equal(400);
        });

        it('una tarea que nunca existió no tiene historial', async () => {
            const ghost = '00000000-0000-4000-8000-000000000000';
            expect((await api().get(`/api/tasks/${ghost}/history`).set(auth(admin))).status).to.equal(404);
        });
    });

    describe('CQRS: la vista de lectura se mantiene desde el log', () => {
        const metrics = async (projectId: string) => (await api().get(`/api/analytics/projects/${projectId}/metrics`).set(auth(admin))).body.data;
        const truth = async (projectId: string) => {
            const rows = await db().query(`select status, count(*)::int as n from tasks where project_id = $1 group by status`, [projectId]);
            const by: Record<string, number> = { 'Not-Started': 0, 'In-Progress': 0, 'In-Review': 0, 'Completed': 0 };
            rows.forEach((r: any) => { by[r.status] = r.n; });
            return by;
        };

        it('tras procesar el log, las métricas coinciden con los datos reales (altas, transiciones, mover y borrar)', async () => {
            const project = await newProject();
            const other = await newProject();
            const tasks = [];
            for (let i = 0; i < 6; i++) tasks.push(await newTask(project));
            for (const t of tasks.slice(0, 4)) await workflow(t.task_id, 'start');
            for (const t of tasks.slice(0, 2)) await workflow(t.task_id, 'submit');
            await workflow(tasks[0].task_id, 'approve');
            await api().put(`/api/tasks/${tasks[5].task_id}`).set(auth(admin)).send({ project_id: other });
            await api().delete(`/api/tasks/${tasks[4].task_id}`).set(auth(admin));

            await new StreamProcessor().drain();
            for (const p of [project, other]) {
                const m = await metrics(p);
                const real = await truth(p);
                expect(m.by_status, `proyecto ${p}`).to.deep.equal(real);
                expect(m.total).to.equal(Object.values(real).reduce((a, b) => a + b, 0));
            }
            expect((await metrics(project)).by_status).to.deep.equal({ 'Not-Started': 0, 'In-Progress': 2, 'In-Review': 1, 'Completed': 1 });
        });

        it('es idempotente: volver a procesar no cambia nada y el retraso queda en cero', async () => {
            const project = await newProject();
            await newTask(project);
            const processor = new StreamProcessor();
            await processor.drain();
            const before = await metrics(project);
            expect(await processor.processBatch()).to.equal(0);
            expect(await metrics(project)).to.deep.equal(before);
            expect(before.lag).to.equal(0);
        });

        it('el retraso (lag) refleja los cambios aún no procesados', async () => {
            const processor = new StreamProcessor();
            await processor.drain();
            const project = await newProject();
            await newTask(project);
            await newTask(project);
            expect(await processor.lag()).to.be.greaterThanOrEqual(2);
            await processor.drain();
            expect(await processor.lag()).to.equal(0);
        });

        it('dos procesadores a la vez no cuentan nada doble (bloqueo de la fila del offset)', async () => {
            const project = await newProject();
            for (let i = 0; i < 5; i++) await newTask(project);
            await Promise.all([new StreamProcessor({ batchSize: 2 }).drain(), new StreamProcessor({ batchSize: 2 }).drain(), new StreamProcessor({ batchSize: 3 }).drain()]);
            await new StreamProcessor().drain();
            expect((await metrics(project)).total).to.equal(5);
        });

        it('rebuild reconstruye la vista desde cero reproduciendo el log y obtiene lo mismo', async () => {
            const project = await newProject();
            const task = await newTask(project);
            await workflow(task.task_id, 'start');
            await newTask(project);
            const processor = new StreamProcessor();
            await processor.drain();
            const before = await metrics(project);

            await db().query(`truncate project_metrics`);
            expect((await metrics(project)).total, 'la vista se perdió').to.equal(0);
            const replayed = await processor.rebuild();
            expect(replayed).to.be.greaterThan(0);
            const after = await metrics(project);
            expect(after.by_status).to.deep.equal(before.by_status);
            expect(after.total).to.equal(before.total);
        });

        it('NO se salta cambios de una transacción lenta que se confirma después de otra más nueva', async () => {
            const project = await newProject();
            const processor = new StreamProcessor();
            await processor.drain();

            const slow = db().createQueryRunner();
            await slow.connect();
            await slow.startTransaction();
            await slow.query(`insert into tasks (name, project_id, user_id) values ($1, $2, $3)`, [`Lenta${uniq()}`, project, adminId]);

            await newTask(project);
            await processor.drain();
            expect((await metrics(project)).total, 'la rápida no se procesa mientras haya una anterior sin cerrar').to.equal(0);

            await slow.commitTransaction();
            await slow.release();
            await processor.drain();
            expect((await metrics(project)).total, 'ahora entran las dos, ninguna se perdió').to.equal(2);
        });
    });

    describe('Ventanas de tiempo sobre el log', () => {
        const throughput = (qs: string) => api().get(`/api/analytics/throughput?${qs}`).set(auth(admin));

        it('tumbling: cuenta las tareas creadas por intervalo; un proyecto distinto no se mezcla', async () => {
            const project = await newProject();
            const from = new Date(Date.now() - 1000).toISOString();
            for (let i = 0; i < 4; i++) await newTask(project);
            await newTask(await newProject());
            const res = await throughput(`window=tumbling&size=3600&project_id=${project}&from=${from}`);
            expect(res.status).to.equal(200);
            expect(res.body.data.events).to.equal(4);
            expect(res.body.data.windows.reduce((n: number, w: any) => n + w.count, 0)).to.equal(4);
        });

        it('session: una pausa mayor al umbral separa la actividad en dos sesiones', async () => {
            const project = await newProject();
            const from = new Date(Date.now() - 1000).toISOString();
            for (let i = 0; i < 3; i++) await newTask(project);
            await sleep(1800);
            for (let i = 0; i < 2; i++) await newTask(project);
            const res = await throughput(`window=session&gap=1&project_id=${project}&from=${from}`);
            expect(res.body.data.windows.map((w: any) => w.count)).to.deep.equal([3, 2]);
        });

        it('sliding: devuelve ventanas solapadas; y se pueden contar las tareas completadas', async () => {
            const project = await newProject();
            const from = new Date(Date.now() - 1000).toISOString();
            const task = await newTask(project);
            for (const a of ['start', 'submit', 'approve']) await workflow(task.task_id, a);
            const sliding = await throughput(`window=sliding&size=3600&slide=1800&metric=completed&project_id=${project}&from=${from}`);
            expect(sliding.body.data.events).to.equal(1);
            expect(sliding.body.data.windows.length, 'una ventana de 1 h que avanza cada 30 min cubre el evento dos veces').to.equal(2);
        });

        it('valida los parámetros (400) y exige el derecho (403)', async () => {
            expect((await throughput('window=raro')).status).to.equal(400);
            expect((await throughput('metric=otra')).status).to.equal(400);
            expect((await throughput('from=2026-01-01&to=2026-06-01')).status).to.equal(400);
            const role = (await api().post('/api/roles').set(auth(admin)).send({ name: `SinT${uniq()}`, rights: 'get_all_roles' })).body.data;
            const email = `w${uniq()}@pms.com`;
            await api().post('/api/users').set(auth(admin)).send({ fullname: 'W', username: `w${uniq()}`, email, password: 'Clave123!', role_ids: [role.role_id] });
            const token = (await login(email, 'Clave123!')).access;
            expect((await api().get('/api/analytics/throughput').set(auth(token))).status).to.equal(403);
        });
    });
});

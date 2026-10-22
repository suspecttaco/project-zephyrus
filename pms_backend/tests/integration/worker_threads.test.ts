import { expect } from 'chai';
import { RiskAnalysisService } from '../../src/services/risk_service';
import { api, auth, login, uniq } from './helpers';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Integración (hilos y procesos reales): análisis de riesgo, event loop y pool', function () {
    this.timeout(120000);
    let admin: string;
    let projectId: string;
    const saved = { ...process.env };

    const risk = (qs = '') => api().get(`/api/analytics/projects/${projectId}/risk${qs}`).set(auth(admin));

    before(async () => {
        process.env.ANALYTICS_ALLOW_INLINE = 'true';
        admin = (await login()).access;
        const adminId = (await api().get('/api/users?username=superadmin').set(auth(admin))).body.data[0].user_id;
        const bea = (await api().post('/api/users').set(auth(admin)).send({ fullname: 'Bea', username: `b${uniq()}`, email: `bea${uniq()}@pms.com`, password: 'Clave123!', role_ids: [] })).body.data.user_id;
        projectId = (await api().post('/api/projects').set(auth(admin)).send({
            name: `Riesgo${uniq()}`, start_time: '2026-01-01', end_time: new Date(Date.now() + 5 * 24 * 3600_000).toISOString()
        })).body.data.project_id;
        const estimates: Array<[string, number]> = [[adminId, 16], [adminId, 24], [bea, 40], [bea, 8]];
        for (const [user, hours] of estimates) {
            await api().post('/api/tasks').set(auth(admin)).send({
                name: `T${uniq()}`, project_id: projectId, user_id: user,
                estimated_start_time: '2026-11-01T08:00:00Z', estimated_end_time: new Date(Date.parse('2026-11-01T08:00:00Z') + hours * 3_600_000).toISOString()
            });
        }
        await risk('?samples=1000');
    });
    after(async () => { process.env = { ...saved }; await RiskAnalysisService.closePool(); });

    it('calcula el riesgo del plazo con el pool de worker threads', async () => {
        const res = await risk('?samples=200000&seed=11');
        expect(res.status).to.equal(200);
        const d = res.body.data;
        expect(d).to.include({ mode: 'thread', pending_tasks: 4, assignees: 2, samples: 200000 });
        expect(d.hours.p50).to.be.at.most(d.hours.p90);
        expect(d.hours.mean).to.be.greaterThan(48);
        expect(d.on_time_probability).to.be.within(0, 1);
        expect(d.deadline_hours).to.be.closeTo(120, 1);
    });

    it('hilo, proceso hijo y cálculo directo dan exactamente el mismo resultado con la misma semilla', async () => {
        const [thread, child, inline] = await Promise.all(['thread', 'process', 'inline'].map((m) => risk(`?mode=${m}&samples=100000&seed=99`)));
        for (const r of [thread, child, inline]) expect(r.status).to.equal(200);
        expect(child.body.data.hours).to.deep.equal(thread.body.data.hours);
        expect(inline.body.data.hours).to.deep.equal(thread.body.data.hours);
        expect(child.body.data.on_time_probability).to.equal(thread.body.data.on_time_probability);
    });

    it('con el pool el event loop sigue libre durante un cálculo pesado; calcular en el hilo principal lo bloquea', async () => {
        const measureStall = async (mode: string) => {
            let last = Date.now();
            let worst = 0;
            const timer = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last - 10); last = now; }, 10);
            const started = Date.now();
            const res = await risk(`?mode=${mode}&samples=3000000&seed=1`);
            const elapsed = Date.now() - started;
            clearInterval(timer);
            expect(res.status).to.equal(200);
            return { worst, elapsed };
        };
        const thread = await measureStall('thread');
        const inline = await measureStall('inline');
        expect(thread.elapsed, 'el cálculo es realmente pesado').to.be.greaterThan(300);
        expect(inline.worst, 'en el hilo principal el temporizador se atrasó casi lo que duró el cálculo').to.be.greaterThan(inline.elapsed * 0.5);
        expect(thread.worst, 'con worker threads el event loop siguió atendiendo').to.be.lessThan(thread.elapsed * 0.25);
        expect(thread.worst).to.be.lessThan(inline.worst / 3);
    });

    it('varias peticiones simultáneas se reparten entre los hilos y se encolan sin perder ninguna', async () => {
        const before = RiskAnalysisService.poolStats()!;
        const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => risk(`?samples=300000&seed=${i + 1}`)));
        expect(responses.every((r) => r.status === 200)).to.be.true;
        const after = RiskAnalysisService.poolStats()!;
        expect(after.completed - before.completed).to.equal(8);
        expect(after.failed).to.equal(before.failed);
        expect(after.queued).to.equal(0);
        expect(after.threads).to.be.greaterThanOrEqual(1);
    });

    it('GET /api/health informa la utilización del event loop y el estado del pool', async () => {
        const health = (await api().get('/api/health')).body;
        expect(health.event_loop).to.have.all.keys('utilization', 'p99DelayMs', 'maxDelayMs');
        expect(health.worker_pool).to.have.all.keys('threads', 'ready', 'busy', 'queued', 'completed', 'failed', 'cancelled');
        expect(health.worker_pool.completed).to.be.greaterThan(0);
    });

    it('un cálculo que supera el tiempo máximo se cancela con la bandera compartida, responde 504 y el hilo se reutiliza', async () => {
        await RiskAnalysisService.closePool();
        process.env.ANALYTICS_TIMEOUT_MS = '100';
        process.env.ANALYTICS_THREADS = '1';
        await risk('?samples=1000');
        const started = Date.now();
        const slow = await risk('?samples=5000000&seed=2');
        expect(slow.status).to.equal(504);
        expect(Date.now() - started, 'se canceló pronto, no esperó el cálculo completo').to.be.lessThan(3000);
        expect(RiskAnalysisService.poolStats()!.cancelled).to.equal(1);
        const ok = await risk('?samples=2000');
        expect(ok.status, 'el mismo hilo sigue sirviendo').to.equal(200);
        delete process.env.ANALYTICS_TIMEOUT_MS;
        delete process.env.ANALYTICS_THREADS;
        await RiskAnalysisService.closePool();
    });
});

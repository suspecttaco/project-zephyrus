import sinon from 'sinon';
import request from 'supertest';
import { expect } from 'chai';
import { app } from '../../src/app';
import { DatabaseUtil } from '../../src/utils/db';
import { RiskAnalysisService } from '../../src/services/risk_service';
import { TaskTimeoutError } from '../../src/utils/worker_pool';
import { stubAuth } from '../helpers/auth';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const at = (h: number) => new Date(Date.UTC(2026, 10, 1, h));
const task = (hours: number, user = 'u1', status = 'In-Progress') =>
    ({ status, user_id: user, estimated_start_time: at(0), estimated_end_time: at(hours) });

describe('Pruebas de integración (API): riesgo de plazo (Monte Carlo en worker threads)', () => {
    const saved = { ...process.env };
    afterEach(() => { process.env = { ...saved }; sinon.restore(); });

    const stubData = (project: any, tasks: any[]) => {
        const repo = (entity: any) => entity.name === 'Projects'
            ? { findOneBy: sinon.stub().resolves(project) }
            : { find: sinon.stub().resolves(tasks) };
        sinon.stub(DatabaseUtil.prototype, 'getRepository').callsFake(repo as any);
    };
    const get = (token: string, qs = '') => request(app).get(`/api/analytics/projects/${PROJECT_ID}/risk${qs}`).set('Authorization', `Bearer ${token}`);

    it('exige autenticación (401) y el derecho get_details_project (403)', async () => {
        expect((await request(app).get(`/api/analytics/projects/${PROJECT_ID}/risk`)).status).to.equal(401);
        expect((await get(stubAuth(['get_all_tasks']))).status).to.equal(403);
    });

    it('valida el modo y el número de muestras (400); el modo inline está deshabilitado por defecto', async () => {
        const token = stubAuth(['get_details_project']);
        expect((await get(token, '?mode=quantum')).status).to.equal(400);
        expect((await get(token, '?samples=99999999')).status).to.equal(400);
        const inline = await get(token, '?mode=inline');
        expect(inline.status).to.equal(400);
        expect(inline.body.message).to.contain('bloquea');
    });

    it('404 si el proyecto no existe y 400 si no hay tareas pendientes con fechas estimadas', async () => {
        const token = stubAuth(['get_details_project']);
        stubData(null, []);
        expect((await get(token)).status).to.equal(404);
        sinon.restore();
        const token2 = stubAuth(['get_details_project']);
        stubData({ project_id: PROJECT_ID }, [task(8, 'u1', 'Completed'), { status: 'Not-Started', user_id: 'u1' }]);
        const res = await get(token2);
        expect(res.status).to.equal(400);
        expect(res.body.message).to.contain('fechas estimadas');
    });

    it('agrupa las horas pendientes por persona, ignora las completadas y delega el cálculo al servicio', async () => {
        const token = stubAuth(['get_details_project']);
        stubData({ project_id: PROJECT_ID, end_time: null }, [task(8, 'u1'), task(16, 'u1'), task(24, 'u2'), task(40, 'u3', 'Completed'), { status: 'Not-Started', user_id: 'u2' }]);
        const run = sinon.stub(RiskAnalysisService, 'run').resolves({ samples: 1000, mean: 50, p50: 48, p80: 55, p90: 60, p95: 65, onTimeProbability: null });

        const res = await get(token, '?samples=1000&seed=5');

        expect(res.status).to.equal(200);
        expect(run.firstCall.args[0]).to.equal('thread');
        const input = run.firstCall.args[1];
        expect(input.assigneeLoads).to.deep.equal([[8, 16], [24]]);
        expect(input).to.include({ samples: 1000, seed: 5 });
        expect(res.body.data).to.include({ pending_tasks: 3, unestimated_tasks: 1, assignees: 2, mode: 'thread' });
        expect(res.body.data.hours).to.deep.equal({ mean: 50, p50: 48, p80: 55, p90: 60, p95: 65 });
    });

    it('calcula las horas disponibles hasta la fecha límite del proyecto', async () => {
        const token = stubAuth(['get_details_project']);
        stubData({ project_id: PROJECT_ID, end_time: new Date(Date.now() + 10 * 3_600_000) }, [task(8)]);
        const run = sinon.stub(RiskAnalysisService, 'run').resolves({ samples: 1, mean: 1, p50: 1, p80: 1, p90: 1, p95: 1, onTimeProbability: 0.9 });
        const res = await get(token);
        expect(run.firstCall.args[1].deadlineHours).to.be.closeTo(10, 0.05);
        expect(res.body.data.on_time_probability).to.equal(0.9);
    });

    it('responde 504 cuando el cálculo supera el tiempo máximo', async () => {
        const token = stubAuth(['get_details_project']);
        stubData({ project_id: PROJECT_ID }, [task(8)]);
        sinon.stub(RiskAnalysisService, 'run').rejects(new TaskTimeoutError(15000));
        const res = await get(token);
        expect(res.status).to.equal(504);
        expect(res.body.message).to.contain('tiempo máximo');
    });
});

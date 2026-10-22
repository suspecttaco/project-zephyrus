import { expect } from 'chai';
import { api, auth, login, uniq } from './helpers';
import { TypeOrmDomainTaskRepository } from '../../src/adapters/repositories/typeorm_task_repository';
import { taskRepositoryContract } from '../helpers/task_repository_contract';

taskRepositoryContract('PostgreSQL (TypeORM)', async () => {
    const admin = (await login()).access;
    const userId = (await api().get('/api/users?username=superadmin').set(auth(admin))).body.data[0].user_id;
    const project = async () => (await api().post('/api/projects').set(auth(admin)).send({ name: `Contrato${uniq()}` })).body.data.project_id;
    return { repo: new TypeOrmDomainTaskRepository(), projectId: await project(), otherProjectId: await project(), userId, uniqueName: () => `Tarea ${uniq()}` };
});

describe('Integración (real): crear tarea a través del caso de uso', () => {
    let admin: string;
    let adminId: string;
    let projectId: string;
    const create = (body: object) => api().post('/api/tasks').set(auth(admin)).send({ name: `T${uniq()}`, project_id: projectId, user_id: adminId, ...body });

    before(async () => {
        admin = (await login()).access;
        adminId = (await api().get('/api/users?username=superadmin').set(auth(admin))).body.data[0].user_id;
        projectId = (await api().post('/api/projects').set(auth(admin)).send({ name: `CU${uniq()}` })).body.data.project_id;
    });

    it('responde 201 con la tarea en el formato de la API', async () => {
        const res = await create({ description: 'detalle', priority: 'High' });
        expect(res.status).to.equal(201);
        expect(res.body.data).to.include({ project_id: projectId, user_id: adminId, status: 'Not-Started', priority: 'High', description: 'detalle' });
        expect(res.body.data.task_id).to.be.a('string');
        expect(res.body.data.created_at).to.be.a('string');
    });

    it('rechaza crear una tarea ya completada: todas inician en Not-Started (400)', async () => {
        const res = await create({ status: 'Completed' });
        expect(res.status).to.equal(400);
        expect(res.body.message).to.contain('Not-Started');
    });

    it('proyecto o usuario inexistentes dan 404 con el motivo', async () => {
        const ghost = '00000000-0000-4000-8000-000000000000';
        const noProject = await create({ project_id: ghost });
        expect(noProject.status).to.equal(404);
        expect(noProject.body.message).to.contain('proyecto');
        const noUser = await create({ user_id: ghost });
        expect(noUser.status).to.equal(404);
        expect(noUser.body.message).to.contain('usuario');
    });

    it('nombre duplicado en el mismo proyecto da 409', async () => {
        const name = `Dup${uniq()}`;
        expect((await create({ name })).status).to.equal(201);
        expect((await create({ name })).status).to.equal(409);
    });

    it('las validaciones de entrada siguen respondiendo 400', async () => {
        expect((await create({ name: 'ab' })).status).to.equal(400);
        expect((await create({ project_id: 'no-uuid' })).status).to.equal(400);
        expect((await create({ estimated_start_time: '2026-12-01', estimated_end_time: '2026-11-01' })).status).to.equal(400);
    });

    it('la creación sigue notificando a los miembros del proyecto', async () => {
        expect((await create({})).status).to.equal(201);
    });

    describe('GET /api/tasks/:id/cost (OCP + ISP)', () => {
        it('calcula el costo estándar y el urgente con las horas estimadas reales', async () => {
            const task = (await create({ estimated_start_time: '2026-11-01T08:00:00Z', estimated_end_time: '2026-11-01T18:00:00Z' })).body.data;
            const standard = await api().get(`/api/tasks/${task.task_id}/cost`).set(auth(admin));
            expect(standard.body.data).to.include({ type: 'standard', hours: 10, rate_per_hour: 50, cost: 500 });
            const urgent = await api().get(`/api/tasks/${task.task_id}/cost?type=urgent`).set(auth(admin));
            expect(urgent.body.data.cost).to.equal(750);
        });

        it('sin fechas estimadas (400), tarifa inválida (400) y tarea inexistente (404)', async () => {
            const task = (await create({})).body.data;
            expect((await api().get(`/api/tasks/${task.task_id}/cost`).set(auth(admin))).status).to.equal(400);
            expect((await api().get(`/api/tasks/${task.task_id}/cost?type=gratis`).set(auth(admin))).status).to.equal(400);
            expect((await api().get('/api/tasks/00000000-0000-4000-8000-000000000000/cost').set(auth(admin))).status).to.equal(404);
        });
    });
});

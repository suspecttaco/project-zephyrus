import sinon from 'sinon';
import request from 'supertest';
import { expect } from 'chai';
import { app } from '../../src/app';
import { ProjectService } from '../../src/components/projects/projects_service';
import { ok, stubAuth } from '../helpers/auth';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

describe('Pruebas de integración: proyectos (/api/projects)', () => {
    afterEach(() => sinon.restore());

    it('rechaza la creación sin encabezado Authorization (401)', async () => {
        const res = await request(app).post('/api/projects').send({ name: 'Proyecto sin token' });
        expect(res.status).to.equal(401);
    });

    it('rechaza la creación sin el derecho add_project (403)', async () => {
        const token = stubAuth(['get_all_projects']);
        const res = await request(app).post('/api/projects').set('Authorization', `Bearer ${token}`).send({ name: 'Sistema de pagos' });
        expect(res.status).to.equal(403);
    });

    it('valida que el nombre sea obligatorio (400)', async () => {
        const token = stubAuth(['add_project']);
        const res = await request(app).post('/api/projects').set('Authorization', `Bearer ${token}`).send({ description: 'sin nombre' });
        expect(res.status).to.equal(400);
    });

    it('valida que la fecha de fin sea posterior a la de inicio (400)', async () => {
        const token = stubAuth(['add_project']);
        const res = await request(app).post('/api/projects').set('Authorization', `Bearer ${token}`)
            .send({ name: 'Sistema de pagos', start_time: '2026-12-31', end_time: '2026-10-01' });
        expect(res.status).to.equal(400);
        expect(JSON.stringify(res.body.errors)).to.contain('posterior');
    });

    it('crea un proyecto asignando al usuario autenticado como miembro (201)', async () => {
        const token = stubAuth(['add_project']);
        const create = sinon.stub(ProjectService.prototype, 'createProject').resolves({ project_id: PROJECT_ID, name: 'Sistema de pagos' });

        const res = await request(app).post('/api/projects').set('Authorization', `Bearer ${token}`)
            .send({ name: 'Sistema de pagos', start_time: '2026-10-01', end_time: '2026-12-31' });

        expect(res.status).to.equal(201);
        expect(res.body.data).to.have.property('project_id', PROJECT_ID);
        expect(create.firstCall.args[1]).to.equal('11111111-1111-4111-8111-111111111111');
    });

    it('responde 409 cuando el nombre del proyecto está duplicado', async () => {
        const token = stubAuth(['add_project']);
        sinon.stub(ProjectService.prototype, 'createProject').rejects({ code: '23505' });
        const res = await request(app).post('/api/projects').set('Authorization', `Bearer ${token}`).send({ name: 'Duplicado' });
        expect(res.status).to.equal(409);
    });

    it('crea el proyecto con su tarea por defecto en una transacción (201)', async () => {
        const token = stubAuth(['add_project']);
        const create = sinon.stub(ProjectService.prototype, 'createProjectWithDefaultTask').resolves({ project_id: PROJECT_ID } as any);
        const res = await request(app).post('/api/projects/with-default-task').set('Authorization', `Bearer ${token}`).send({ name: 'Con tarea' });
        expect(res.status).to.equal(201);
        expect(create.calledOnce).to.be.true;
    });

    it('responde 500 si la transacción falla (el rollback lo hace el servicio)', async () => {
        const token = stubAuth(['add_project']);
        sinon.stub(ProjectService.prototype, 'createProjectWithDefaultTask').rejects(new Error('fallo'));
        const res = await request(app).post('/api/projects/with-default-task').set('Authorization', `Bearer ${token}`).send({ name: 'Con tarea' });
        expect(res.status).to.equal(500);
    });

    it('GET filtra por estado y búsqueda usando la consulta personalizada', async () => {
        const token = stubAuth(['get_all_projects']);
        const custom = sinon.stub(ProjectService.prototype, 'getAllProjectsCustom').resolves([{ name: 'Sistema' }]);

        const res = await request(app).get('/api/projects?status=Planning&search=Sis').set('Authorization', `Bearer ${token}`);

        expect(res.status).to.equal(200);
        expect(res.body.data).to.have.lengthOf(1);
        expect(custom.firstCall.args[0]).to.include({ status: 'Planning', search: 'Sis' });
    });

    it('GET rechaza un estado inválido (400)', async () => {
        const token = stubAuth(['get_all_projects']);
        const res = await request(app).get('/api/projects?status=Inventado').set('Authorization', `Bearer ${token}`);
        expect(res.status).to.equal(400);
    });

    it('GET /:id rechaza un identificador que no es UUID (400)', async () => {
        const token = stubAuth(['get_details_project']);
        const res = await request(app).get('/api/projects/no-es-uuid').set('Authorization', `Bearer ${token}`);
        expect(res.status).to.equal(400);
    });

    it('GET /:id retorna 404 cuando el proyecto no existe', async () => {
        const token = stubAuth(['get_details_project']);
        sinon.stub(ProjectService.prototype, 'findOne').resolves({ statusCode: 404, status: 'error', message: 'Recurso no encontrado' });
        const res = await request(app).get(`/api/projects/${PROJECT_ID}`).set('Authorization', `Bearer ${token}`);
        expect(res.status).to.equal(404);
    });

    it('DELETE retorna 200 cuando se elimina', async () => {
        const token = stubAuth(['delete_project']);
        sinon.stub(ProjectService.prototype, 'delete').resolves(ok(undefined));
        const res = await request(app).delete(`/api/projects/${PROJECT_ID}`).set('Authorization', `Bearer ${token}`);
        expect(res.status).to.equal(200);
    });
});

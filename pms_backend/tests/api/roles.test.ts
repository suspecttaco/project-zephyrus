import sinon from 'sinon';
import request from 'supertest';
import { expect } from 'chai';
import { app } from '../../src/app';
import { RoleService } from '../../src/components/roles/roles_service';
import { RoleUtil } from '../../src/components/roles/roles_controller';
import { ok, stubAuth } from '../helpers/auth';

const ROLE_ID = '22222222-2222-4222-8222-222222222222';

describe('Pruebas de integración: roles (/api/roles)', () => {
    afterEach(() => sinon.restore());

    it('exige autenticación (401)', async () => {
        expect((await request(app).get('/api/roles')).status).to.equal(401);
    });

    it('exige el derecho add_role (403)', async () => {
        const token = stubAuth(['get_all_roles']);
        const res = await request(app).post('/api/roles').set('Authorization', `Bearer ${token}`).send({ name: 'Dev', rights: 'add_task' });
        expect(res.status).to.equal(403);
    });

    it('rechaza derechos que no existen (400)', async () => {
        const token = stubAuth(['add_role']);
        const res = await request(app).post('/api/roles').set('Authorization', `Bearer ${token}`).send({ name: 'Dev', rights: 'add_task,volar' });
        expect(res.status).to.equal(400);
        expect(JSON.stringify(res.body.errors)).to.contain('inválidos');
    });

    it('rechaza un nombre vacío (400)', async () => {
        const token = stubAuth(['add_role']);
        const res = await request(app).post('/api/roles').set('Authorization', `Bearer ${token}`).send({ name: '', rights: 'add_task' });
        expect(res.status).to.equal(400);
    });

    it('crea el rol con derechos válidos (201)', async () => {
        const token = stubAuth(['add_role']);
        sinon.stub(RoleService.prototype, 'create').resolves(ok({ role_id: ROLE_ID, name: 'Dev' }, 201));
        const res = await request(app).post('/api/roles').set('Authorization', `Bearer ${token}`).send({ name: 'Dev', rights: 'add_task,get_all_tasks' });
        expect(res.status).to.equal(201);
    });

    it('lista, consulta, edita y elimina con sus derechos', async () => {
        const token = stubAuth(['get_all_roles', 'get_details_role', 'edit_role', 'delete_role']);
        sinon.stub(RoleService.prototype, 'findAll').resolves(ok([]));
        sinon.stub(RoleService.prototype, 'findOne').resolves(ok({ role_id: ROLE_ID }));
        sinon.stub(RoleService.prototype, 'update').resolves(ok({ role_id: ROLE_ID }));
        sinon.stub(RoleService.prototype, 'delete').resolves(ok(undefined));
        sinon.stub(RoleUtil, 'countUsersWithRole').resolves(0);
        const auth = { Authorization: `Bearer ${token}` };

        expect((await request(app).get('/api/roles').set(auth)).status).to.equal(200);
        expect((await request(app).get(`/api/roles/${ROLE_ID}`).set(auth)).status).to.equal(200);
        expect((await request(app).put(`/api/roles/${ROLE_ID}`).set(auth).send({ name: 'Dev', rights: 'add_task' })).status).to.equal(200);
        expect((await request(app).delete(`/api/roles/${ROLE_ID}`).set(auth)).status).to.equal(200);
    });

    it('no elimina un rol que está asignado a usuarios (409)', async () => {
        const token = stubAuth(['delete_role']);
        sinon.stub(RoleUtil, 'countUsersWithRole').resolves(3);
        const del = sinon.stub(RoleService.prototype, 'delete').resolves(ok(undefined));

        const res = await request(app).delete(`/api/roles/${ROLE_ID}`).set('Authorization', `Bearer ${token}`);

        expect(res.status).to.equal(409);
        expect(res.body.message).to.contain('3 usuario');
        expect(del.called).to.be.false;
    });
});

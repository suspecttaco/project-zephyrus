import sinon from 'sinon';
import request from 'supertest';
import { expect } from 'chai';
import { app } from '../../src/app';
import { CacheUtil } from '../../src/utils/cache_util';
import { UserService } from '../../src/components/users/users_service';
import { RoleService } from '../../src/components/roles/roles_service';
import { ProjectService } from '../../src/components/projects/projects_service';
import { UsersUtil } from '../../src/utils/users_util';
import { RoleUtil } from '../../src/components/roles/roles_controller';
import { fakeUser, ok, stubAuth } from '../helpers/auth';

const ID = '66666666-6666-4666-8666-666666666666';

describe('Pruebas de integración: caché Cache-Aside', () => {
    let get: sinon.SinonStub, set: sinon.SinonStub, remove: sinon.SinonStub;

    beforeEach(() => {
        get = sinon.stub(CacheUtil, 'get').resolves(null);
        set = sinon.stub(CacheUtil, 'set').resolves();
        remove = sinon.stub(CacheUtil, 'remove').resolves();
    });
    afterEach(() => sinon.restore());

    const cases = [
        { name: 'usuarios', url: '/api/users', cache: 'User', right: 'get_details_user', service: UserService },
        { name: 'roles', url: '/api/roles', cache: 'Role', right: 'get_details_role', service: RoleService },
        { name: 'proyectos', url: '/api/projects', cache: 'Project', right: 'get_details_project', service: ProjectService }
    ];

    cases.forEach(({ name, url, cache, right, service }) => {
        describe(name, () => {
            it('responde desde la caché sin consultar la base de datos (cache hit)', async () => {
                const token = stubAuth([right]);
                get.resolves({ id: ID, from: 'cache' });
                const findOne = sinon.stub(service.prototype as any, 'findOne');

                const res = await request(app).get(`${url}/${ID}`).set('Authorization', `Bearer ${token}`);

                expect(res.status).to.equal(200);
                expect(res.body.data).to.deep.equal({ id: ID, from: 'cache' });
                expect(findOne.called).to.be.false;
            });

            it('consulta la base de datos y guarda el resultado en caché (cache miss)', async () => {
                const token = stubAuth([right]);
                sinon.stub(service.prototype as any, 'findOne').resolves(ok({ id: ID, password: undefined, from: 'db' }));

                const res = await request(app).get(`${url}/${ID}`).set('Authorization', `Bearer ${token}`);

                expect(res.status).to.equal(200);
                expect(get.calledWith(cache, ID)).to.be.true;
                expect(set.calledWith(cache, ID)).to.be.true;
            });

            it('no guarda en caché una respuesta 404', async () => {
                const token = stubAuth([right]);
                sinon.stub(service.prototype as any, 'findOne').resolves({ statusCode: 404, status: 'error', message: 'no existe' });

                const res = await request(app).get(`${url}/${ID}`).set('Authorization', `Bearer ${token}`);

                expect(res.status).to.equal(404);
                expect(set.called).to.be.false;
            });
        });
    });

    it('usuarios: no guarda la contraseña en caché', async () => {
        const token = stubAuth(['get_details_user']);
        sinon.stub(UserService.prototype, 'findOne').resolves(ok({ ...fakeUser }));
        await request(app).get(`/api/users/${ID}`).set('Authorization', `Bearer ${token}`);
        expect(set.firstCall.args[2]).to.not.have.property('password');
    });

    describe('invalidación', () => {
        it('usuarios: actualizar invalida la caché', async () => {
            const token = stubAuth(['edit_user']);
            sinon.stub(UserService.prototype, 'update').resolves(ok({ ...fakeUser }));
            await request(app).put(`/api/users/${ID}`).set('Authorization', `Bearer ${token}`).send({ fullname: 'Nuevo' });
            expect(remove.calledWith('User', ID)).to.be.true;
        });

        it('usuarios: eliminar invalida la caché', async () => {
            const token = stubAuth(['delete_user']);
            sinon.stub(UserService.prototype, 'delete').resolves(ok(undefined));
            await request(app).delete(`/api/users/${ID}`).set('Authorization', `Bearer ${token}`);
            expect(remove.calledWith('User', ID)).to.be.true;
        });

        it('roles: actualizar y eliminar invalidan la caché', async () => {
            const token = stubAuth(['edit_role', 'delete_role']);
            sinon.stub(RoleService.prototype, 'update').resolves(ok({}));
            sinon.stub(RoleService.prototype, 'delete').resolves(ok(undefined));
            sinon.stub(RoleUtil, 'countUsersWithRole').resolves(0);
            await request(app).put(`/api/roles/${ID}`).set('Authorization', `Bearer ${token}`).send({ name: 'Dev', rights: 'add_task' });
            await request(app).delete(`/api/roles/${ID}`).set('Authorization', `Bearer ${token}`);
            expect(remove.withArgs('Role', ID).callCount).to.equal(2);
        });

        it('proyectos: actualizar y eliminar invalidan la caché', async () => {
            const token = stubAuth(['edit_project', 'delete_project']);
            sinon.stub(ProjectService.prototype, 'update').resolves(ok({}));
            sinon.stub(ProjectService.prototype, 'delete').resolves(ok(undefined));
            await request(app).put(`/api/projects/${ID}`).set('Authorization', `Bearer ${token}`).send({ name: 'Proyecto' });
            await request(app).delete(`/api/projects/${ID}`).set('Authorization', `Bearer ${token}`);
            expect(remove.withArgs('Project', ID).callCount).to.equal(2);
        });

        it('no invalida si la operación falla', async () => {
            const token = stubAuth(['delete_user']);
            sinon.stub(UserService.prototype, 'delete').resolves({ statusCode: 404, status: 'error', message: 'no existe' });
            await request(app).delete(`/api/users/${ID}`).set('Authorization', `Bearer ${token}`);
            expect(remove.called).to.be.false;
        });
    });

    describe('precarga (warm-up)', () => {
        it('carga todos los usuarios en caché sin contraseña', async () => {
            sinon.stub(UserService.prototype, 'findAll').resolves(ok([{ ...fakeUser }, { ...fakeUser, user_id: 'otro' }]));
            sinon.stub(console, 'log');

            await UsersUtil.putAllUsersInCache();

            expect(set.callCount).to.equal(2);
            expect(set.firstCall.args[0]).to.equal('User');
            expect(set.firstCall.args[2]).to.not.have.property('password');
        });

        it('no falla si la base de datos responde con error', async () => {
            sinon.stub(UserService.prototype, 'findAll').resolves({ statusCode: 500, status: 'error', message: 'db caída' });
            sinon.stub(console, 'error');
            await UsersUtil.putAllUsersInCache();
            expect(set.called).to.be.false;
        });
    });
});

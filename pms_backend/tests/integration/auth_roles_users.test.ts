import { expect } from 'chai';
import { DatabaseUtil } from '../../src/utils/db';
import { api, auth, login, uniq, SUPERADMIN } from './helpers';

const countRows = async (sql: string, params: any[]): Promise<number> =>
    Number((await new DatabaseUtil().getDataSource().query(sql, params))[0].count);

describe('Integración (PostgreSQL real): autenticación, roles y usuarios', () => {
    let admin: string;

    before(async () => {
        admin = (await login()).access;
    });

    describe('sembrado inicial', () => {
        it('el SuperAdmin sembrado tiene su rol guardado en user_roles', async () => {
            const rows = await countRows(
                `select count(*) from user_roles ur join users u on u.user_id = ur.user_id where u.username = 'superadmin'`, []);
            expect(rows).to.equal(1);
        });

        it('el SuperAdmin puede operar (tiene permisos reales)', async () => {
            const res = await api().get('/api/users').set(auth(admin));
            expect(res.status).to.equal(200);
        });
    });

    describe('autenticación', () => {
        it('rechaza contraseñas incorrectas y correos inexistentes', async () => {
            expect((await login(SUPERADMIN.email, 'incorrecta')).status).to.equal(400);
            expect((await login('nadie@pms.com', 'x')).status).to.equal(404);
        });

        it('el refresh token emite un access token nuevo que funciona', async () => {
            const { refresh } = await login();
            const res = await api().post('/api/users/refresh-token').send({ refreshToken: refresh });
            expect(res.status).to.equal(200);
            const check = await api().get('/api/users').set(auth(res.body.data.accessToken));
            expect(check.status).to.equal(200);
        });

        it('un refresh token no sirve como access token', async () => {
            const { refresh } = await login();
            expect((await api().get('/api/users').set(auth(refresh))).status).to.equal(401);
        });
    });

    describe('roles', () => {
        it('CRUD completo con derechos validados', async () => {
            const name = `Rol${uniq()}`;
            const created = await api().post('/api/roles').set(auth(admin)).send({ name, description: 'd', rights: 'get_all_tasks' });
            expect(created.status).to.equal(201);
            const id = created.body.data.role_id;

            expect((await api().post('/api/roles').set(auth(admin)).send({ name, rights: 'get_all_tasks' })).status).to.equal(409);
            expect((await api().post('/api/roles').set(auth(admin)).send({ name: `X${uniq()}`, rights: 'volar' })).status).to.equal(400);

            const edited = await api().put(`/api/roles/${id}`).set(auth(admin)).send({ name: `${name}ed`, rights: 'get_all_tasks,add_task' });
            expect(edited.status).to.equal(200);
            expect((await api().get(`/api/roles/${id}`).set(auth(admin))).body.data.rights).to.equal('get_all_tasks,add_task');

            expect((await api().delete(`/api/roles/${id}`).set(auth(admin))).status).to.equal(200);
            expect((await api().get(`/api/roles/${id}`).set(auth(admin))).status).to.equal(404);
        });

        it('no elimina un rol asignado a un usuario y el usuario conserva su permiso', async () => {
            const role = (await api().post('/api/roles').set(auth(admin)).send({ name: `EnUso${uniq()}`, rights: 'get_all_tasks' })).body.data;
            const user = (await api().post('/api/users').set(auth(admin)).send({
                fullname: 'U', username: `u${uniq()}`, email: `u${uniq()}@pms.com`, password: 'Clave123!', role_ids: [role.role_id]
            })).body.data;

            const res = await api().delete(`/api/roles/${role.role_id}`).set(auth(admin));

            expect(res.status).to.equal(409);
            expect(await countRows('select count(*) from user_roles where user_id = $1', [user.user_id])).to.equal(1);
        });
    });

    describe('usuarios y permisos (RBAC)', () => {
        let devToken: string;
        let devId: string;
        const email = `dev${uniq()}@pms.com`;

        before(async () => {
            const role = (await api().post('/api/roles').set(auth(admin)).send({
                name: `Dev${uniq()}`, rights: 'get_all_projects,get_details_project'
            })).body.data;
            const created = await api().post('/api/users').set(auth(admin)).send({
                fullname: 'Dev', username: `dev${uniq()}`, email, password: 'Dev12345!', role_ids: [role.role_id]
            });
            devId = created.body.data.user_id;
            devToken = (await login(email, 'Dev12345!')).access;
        });

        it('el usuario creado queda con su rol en la base de datos', async () => {
            expect(await countRows('select count(*) from user_roles where user_id = $1', [devId])).to.equal(1);
        });

        it('la respuesta nunca incluye la contraseña y role_ids son UUID', async () => {
            const res = await api().get(`/api/users/${devId}`).set(auth(admin));
            expect(res.body.data).to.not.have.property('password');
            expect(res.body.data.role_ids).to.have.lengthOf(1);
            expect(res.body.data.role_ids[0]).to.be.a('string');
        });

        it('aplica los permisos del rol: puede listar proyectos pero no crearlos', async () => {
            expect((await api().get('/api/projects').set(auth(devToken))).status).to.equal(200);
            expect((await api().post('/api/projects').set(auth(devToken)).send({ name: `No${uniq()}` })).status).to.equal(403);
            expect((await api().get('/api/users').set(auth(devToken))).status).to.equal(403);
        });

        it('rechaza datos inválidos al crear y al actualizar', async () => {
            expect((await api().post('/api/users').set(auth(admin)).send({ username: 'ab', email: 'x', password: '1' })).status).to.equal(400);
            const bad = await api().put(`/api/users/${devId}`).set(auth(admin)).send({ email: 'no-es-correo' });
            expect(bad.status).to.equal(400);
            expect((await api().put(`/api/users/${devId}`).set(auth(admin)).send({ password: '123' })).status).to.equal(400);
        });

        it('rechaza usuario o correo duplicado (409)', async () => {
            const dup = await api().post('/api/users').set(auth(admin)).send({
                fullname: 'Otro', username: `x${uniq()}`, email, password: 'Dev12345!', role_ids: []
            });
            expect(dup.status).to.equal(409);
        });

        it('ignora la clave primaria enviada en el cuerpo (no crea copias ni cambia el id)', async () => {
            const injected = '11111111-1111-4111-8111-111111111111';
            const res = await api().put(`/api/users/${devId}`).set(auth(admin)).send({ user_id: injected, fullname: 'Mismo Usuario' });
            expect(res.status).to.equal(200);
            expect(res.body.data.user_id).to.equal(devId);
            expect(await countRows('select count(*) from users where user_id = $1', [injected])).to.equal(0);
        });

        it('cambiar la contraseña desde la edición permite iniciar sesión con la nueva', async () => {
            await api().put(`/api/users/${devId}`).set(auth(admin)).send({ password: 'Nueva123!' });
            expect((await login(email, 'Nueva123!')).status).to.equal(200);
            expect((await login(email, 'Dev12345!')).status).to.equal(400);
        });

        it('el usuario cambia su propia contraseña', async () => {
            const token = (await login(email, 'Nueva123!')).access;
            const wrong = await api().post('/api/users/change-password').set(auth(token)).send({ current_password: 'mala', new_password: 'Otra1234!' });
            expect(wrong.status).to.equal(400);
            const ok = await api().post('/api/users/change-password').set(auth(token)).send({ current_password: 'Nueva123!', new_password: 'Otra1234!' });
            expect(ok.status).to.equal(200);
            expect((await login(email, 'Otra1234!')).status).to.equal(200);
        });

        it('eliminar al usuario borra también su asignación de roles', async () => {
            expect((await api().delete(`/api/users/${devId}`).set(auth(admin))).status).to.equal(200);
            expect(await countRows('select count(*) from user_roles where user_id = $1', [devId])).to.equal(0);
        });
    });
});

import { expect } from 'chai';
import { CacheUtil } from '../../src/utils/cache_util';
import { api, auth, login, uniq, mailpitAvailable, mailsWithSubject, waitFor, MAIL_API } from './helpers';

describe('Integración (Redis y SMTP reales): caché y correos', () => {
    let admin: string;
    let adminId: string;

    before(async function () {
        admin = (await login()).access;
        adminId = (await api().get('/api/users?username=superadmin').set(auth(admin))).body.data[0].user_id;
        const ready = await waitFor(async () => (CacheUtil as any).client.isReady, 10000);
        if (!ready) this.skip();
    });

    describe('Cache-Aside en Redis', () => {
        const newUser = async () => (await api().post('/api/users').set(auth(admin)).send({
            fullname: 'Cache', username: `c${uniq()}`, email: `c${uniq()}@pms.com`, password: 'Clave123!', role_ids: []
        })).body.data;

        it('la primera lectura guarda el usuario en Redis, sin contraseña y con TTL', async () => {
            const user = await newUser();
            expect(await CacheUtil.get('User', user.user_id)).to.equal(null);

            await api().get(`/api/users/${user.user_id}`).set(auth(admin));

            const cached = await CacheUtil.get('User', user.user_id);
            expect(cached).to.include({ username: user.username });
            expect(cached).to.not.have.property('password');
            expect(await (CacheUtil as any).client.ttl(`User:${user.user_id}`)).to.be.greaterThan(0);
        });

        it('editar o eliminar invalida la caché y la siguiente lectura trae el dato nuevo', async () => {
            const user = await newUser();
            await api().get(`/api/users/${user.user_id}`).set(auth(admin));

            await api().put(`/api/users/${user.user_id}`).set(auth(admin)).send({ fullname: 'Nombre Nuevo' });
            expect(await CacheUtil.get('User', user.user_id)).to.equal(null);
            expect((await api().get(`/api/users/${user.user_id}`).set(auth(admin))).body.data.fullname).to.equal('Nombre Nuevo');

            await api().delete(`/api/users/${user.user_id}`).set(auth(admin));
            expect(await CacheUtil.get('User', user.user_id)).to.equal(null);
        });

        it('roles y proyectos también se cachean e invalidan', async () => {
            const role = (await api().post('/api/roles').set(auth(admin)).send({ name: `R${uniq()}`, rights: 'get_all_tasks' })).body.data;
            await api().get(`/api/roles/${role.role_id}`).set(auth(admin));
            expect(await CacheUtil.get('Role', role.role_id)).to.not.equal(null);
            await api().put(`/api/roles/${role.role_id}`).set(auth(admin)).send({ name: role.name, rights: 'get_all_tasks' });
            expect(await CacheUtil.get('Role', role.role_id)).to.equal(null);

            const project = (await api().post('/api/projects').set(auth(admin)).send({ name: `P${uniq()}` })).body.data;
            await api().get(`/api/projects/${project.project_id}`).set(auth(admin));
            expect(await CacheUtil.get('Project', project.project_id)).to.not.equal(null);
            await api().delete(`/api/projects/${project.project_id}`).set(auth(admin));
            expect(await CacheUtil.get('Project', project.project_id)).to.equal(null);
        });
    });

    describe('correos (cola Bull + SMTP)', () => {
        before(async function () {
            if (!(await mailpitAvailable())) this.skip();
            await fetch(`${MAIL_API}/api/v1/messages`, { method: 'DELETE' });
        });

        it('crear una tarea encola y entrega un correo a cada miembro del proyecto', async function () {
            const dev = (await api().post('/api/users').set(auth(admin)).send({
                fullname: 'Dev Mail', username: `m${uniq()}`, email: `m${uniq()}@pms.com`, password: 'Clave123!', role_ids: []
            })).body.data;
            const project = (await api().post('/api/projects').set(auth(admin)).send({
                name: `Mail${uniq()}`, user_ids: [adminId, dev.user_id]
            })).body.data;
            const taskName = `Tarea${uniq()}`;

            const res = await api().post('/api/tasks').set(auth(admin)).send({ name: taskName, project_id: project.project_id, user_id: dev.user_id });
            expect(res.status).to.equal(201);

            const arrived = await waitFor(async () => (await mailsWithSubject(`Nueva Tarea Creada: ${taskName}`)).length >= 2);
            expect(arrived, 'llegaron 2 correos').to.be.true;
            const recipients = (await mailsWithSubject(taskName)).map((m) => m.To[0].Address);
            expect(recipients).to.include(dev.email);
        });

        it('recuperar contraseña envía un enlace con token que sirve una sola vez para restablecerla', async () => {
            const email = `r${uniq()}@pms.com`;
            await api().post('/api/users').set(auth(admin)).send({ fullname: 'Reset', username: `r${uniq()}`, email, password: 'Clave123!', role_ids: [] });

            expect((await api().post('/api/users/forgot-password').send({ email: 'nadie@pms.com' })).status).to.equal(404);
            expect((await api().post('/api/users/forgot-password').send({ email })).status).to.equal(200);

            expect(await waitFor(async () => (await mailsWithSubject('Recuperación')).some((m) => m.To[0].Address === email))).to.be.true;
            const message = (await mailsWithSubject('Recuperación')).find((m) => m.To[0].Address === email);
            const html: string = (await (await fetch(`${MAIL_API}/api/v1/message/${message.ID}`)).json() as any).HTML;
            const token = /token=([^"]+)/.exec(html)![1];

            expect((await api().get('/api/users').set(auth(token))).status, 'el token de reset no es un access token').to.equal(401);
            expect((await api().post('/api/users/reset-password').send({ token, password: 'abc' })).status).to.equal(400);
            expect((await api().post('/api/users/reset-password').send({ token, password: 'Nueva123!' })).status).to.equal(200);
            expect((await login(email, 'Nueva123!')).status).to.equal(200);
        });
    });
});

import sinon from 'sinon';
import request from 'supertest';
import { expect } from 'chai';
import { app } from '../../src/app';
import { UserService } from '../../src/components/users/users_service';
import { UsersUtil } from '../../src/components/users/users_controller';
import { encryptString } from '../../src/utils/common';
import * as emailUtil from '../../src/utils/email_util';
import { fakeUser, makeToken, ok, stubAuth } from '../helpers/auth';

describe('Pruebas de integración: usuarios (/api/users)', () => {
    afterEach(() => sinon.restore());

    describe('POST /api/users/login', () => {
        it('retorna 200 con accessToken y refreshToken con credenciales válidas', async () => {
            const password = await encryptString('Password1!');
            sinon.stub(UserService.prototype, 'findAll').resolves(ok([{ ...fakeUser, password }]));

            const res = await request(app).post('/api/users/login').send({ email: fakeUser.email, password: 'Password1!' });

            expect(res.status).to.equal(200);
            expect(res.body.data).to.have.all.keys('accessToken', 'refreshToken');
        });

        it('retorna 400 con contraseña incorrecta', async () => {
            const password = await encryptString('Password1!');
            sinon.stub(UserService.prototype, 'findAll').resolves(ok([{ ...fakeUser, password }]));

            const res = await request(app).post('/api/users/login').send({ email: fakeUser.email, password: 'Incorrecta1!' });

            expect(res.status).to.equal(400);
            expect(res.body.message).to.equal('Contraseña incorrecta');
        });

        it('retorna 404 si el correo no existe', async () => {
            sinon.stub(UserService.prototype, 'findAll').resolves(ok([]));
            const res = await request(app).post('/api/users/login').send({ email: 'nadie@pms.com', password: 'x' });
            expect(res.status).to.equal(404);
        });
    });

    describe('POST /api/users/refresh-token', () => {
        it('emite un nuevo accessToken a partir de un refresh token válido', async () => {
            sinon.stub(UsersUtil, 'getUserFromUsername').resolves(fakeUser as any);
            const res = await request(app).post('/api/users/refresh-token').send({ refreshToken: makeToken('refresh') });
            expect(res.status).to.equal(200);
            expect(res.body.data).to.have.property('accessToken');
        });

        it('rechaza un access token usado como refresh token (401)', async () => {
            sinon.stub(UsersUtil, 'getUserFromUsername').resolves(fakeUser as any);
            const res = await request(app).post('/api/users/refresh-token').send({ refreshToken: makeToken('access') });
            expect(res.status).to.equal(401);
        });

        it('retorna 400 si no se envía el token', async () => {
            const res = await request(app).post('/api/users/refresh-token').send({});
            expect(res.status).to.equal(400);
        });
    });

    describe('POST /api/users/forgot-password', () => {
        it('retorna 404 si el correo no está registrado', async () => {
            sinon.stub(UsersUtil, 'getUserByEmail').resolves(null);
            const res = await request(app).post('/api/users/forgot-password').send({ email: 'nadie@pms.com' });
            expect(res.status).to.equal(404);
        });

        it('envía el correo de recuperación con un enlace con token (sin enviar un email real)', async () => {
            sinon.stub(UsersUtil, 'getUserByEmail').resolves(fakeUser);
            const send = sinon.stub(emailUtil, 'sendMail').resolves(true);

            const res = await request(app).post('/api/users/forgot-password').send({ email: fakeUser.email });

            expect(res.status).to.equal(200);
            expect(send.calledOnce).to.be.true;
            expect(send.firstCall.args[0]).to.equal(fakeUser.email);
            expect(send.firstCall.args[2]).to.contain('reset-password?token=');
        });

        it('retorna 500 si falla el envío del correo', async () => {
            sinon.stub(UsersUtil, 'getUserByEmail').resolves(fakeUser);
            sinon.stub(emailUtil, 'sendMail').resolves(false);
            const res = await request(app).post('/api/users/forgot-password').send({ email: fakeUser.email });
            expect(res.status).to.equal(500);
        });
    });

    describe('POST /api/users/reset-password', () => {
        it('rechaza un access token usado como token de recuperación', async () => {
            sinon.stub(UsersUtil, 'getUserByEmail').resolves(fakeUser as any);
            const res = await request(app).post('/api/users/reset-password').send({ token: makeToken('access'), password: 'Nueva1234!' });
            expect(res.status).to.equal(404);
        });

        it('rechaza contraseñas débiles con 400', async () => {
            const res = await request(app).post('/api/users/reset-password').send({ token: makeToken('reset'), password: 'abc' });
            expect(res.status).to.equal(400);
        });

        it('actualiza la contraseña con un token de recuperación válido sin devolver el hash', async () => {
            sinon.stub(UsersUtil, 'getUserByEmail').resolves(fakeUser as any);
            const update = sinon.stub(UserService.prototype, 'update').resolves(ok({ ...fakeUser }));

            const res = await request(app).post('/api/users/reset-password').send({ token: makeToken('reset'), password: 'Nueva1234!' });

            expect(res.status).to.equal(200);
            expect(res.body.data).to.not.have.property('password');
            expect(update.firstCall.args[1].password).to.not.equal('Nueva1234!');
        });
    });

    describe('POST /api/users/change-password', () => {
        it('exige autenticación (401)', async () => {
            const res = await request(app).post('/api/users/change-password').send({});
            expect(res.status).to.equal(401);
        });

        it('retorna 400 si la contraseña actual es incorrecta', async () => {
            const token = stubAuth([]);
            const password = await encryptString('Actual123!');
            sinon.stub(UserService.prototype, 'findOne').resolves(ok({ ...fakeUser, password }));

            const res = await request(app).post('/api/users/change-password').set('Authorization', `Bearer ${token}`)
                .send({ current_password: 'Otra1234!', new_password: 'Nueva1234!' });

            expect(res.status).to.equal(400);
        });

        it('cambia la contraseña cuando la actual es correcta', async () => {
            const token = stubAuth([]);
            const password = await encryptString('Actual123!');
            sinon.stub(UserService.prototype, 'findOne').resolves(ok({ ...fakeUser, password }));
            sinon.stub(UserService.prototype, 'update').resolves(ok({ ...fakeUser }));

            const res = await request(app).post('/api/users/change-password').set('Authorization', `Bearer ${token}`)
                .send({ current_password: 'Actual123!', new_password: 'Nueva1234!' });

            expect(res.status).to.equal(200);
            expect(res.body.data).to.not.have.property('password');
        });
    });

    describe('RBAC en /api/users', () => {
        it('GET sin token retorna 401', async () => {
            expect((await request(app).get('/api/users')).status).to.equal(401);
        });

        it('GET sin el derecho get_all_users retorna 403', async () => {
            const token = stubAuth(['add_user']);
            const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
            expect(res.status).to.equal(403);
        });

        it('GET con el derecho retorna la lista sin contraseñas', async () => {
            const token = stubAuth(['get_all_users']);
            sinon.stub(UserService.prototype, 'findAll').resolves(ok([{ ...fakeUser }]));

            const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);

            expect(res.status).to.equal(200);
            expect(res.body.data[0]).to.not.have.property('password');
        });

        it('PUT valida los campos que lleguen (correo, usuario, contraseña) (400)', async () => {
            const token = stubAuth(['edit_user']);
            const put = (body: object) => request(app).put(`/api/users/${fakeUser.user_id}`).set('Authorization', `Bearer ${token}`).send(body);
            expect((await put({ email: 'no-es-correo' })).status).to.equal(400);
            expect((await put({ username: 'x' })).status).to.equal(400);
            expect((await put({ password: '123' })).status).to.equal(400);
        });

        it('POST valida el cuerpo antes de crear (400)', async () => {
            const token = stubAuth(['add_user']);
            const res = await request(app).post('/api/users').set('Authorization', `Bearer ${token}`)
                .send({ username: 'ab', email: 'no-es-correo', password: '123' });
            expect(res.status).to.equal(400);
            expect(res.body.errors.length).to.be.greaterThan(0);
        });
    });
});

import sinon from 'sinon';
import request from 'supertest';
import { expect } from 'chai';
import { createApp, app as sharedApp } from '../../src/app';
import { HttpError } from '../../src/middlewares/error.middleware';
import { UserService } from '../../src/components/users/users_service';

describe('Capítulo 3: endurecimiento de Express (Helmet, compresión, límite de tasa, errores centralizados)', () => {
    afterEach(() => sinon.restore());

    describe('Helmet: cabeceras HTTP defensivas', () => {
        it('añade las cabeceras de seguridad y oculta que se usa Express', async () => {
            const res = await request(sharedApp).get('/ping');
            expect(res.headers['x-content-type-options']).to.equal('nosniff');
            expect(res.headers['x-frame-options']).to.equal('SAMEORIGIN');
            expect(res.headers['strict-transport-security']).to.contain('max-age');
            expect(res.headers['content-security-policy']).to.be.a('string');
            expect(res.headers['x-powered-by']).to.equal(undefined);
        });
    });

    describe('compression: respuestas comprimidas', () => {
        it('comprime con gzip las respuestas grandes si el cliente lo acepta', async () => {
            const app = createApp({ extend: (a) => a.get('/grande', (req, res) => { res.json({ datos: 'x'.repeat(5000) }); }) });
            const res = await request(app).get('/grande').set('Accept-Encoding', 'gzip');
            expect(res.headers['content-encoding']).to.equal('gzip');
            expect(res.body.datos).to.have.lengthOf(5000);
        });

        it('no comprime lo pequeño ni a clientes que no lo piden', async () => {
            const app = createApp({ extend: (a) => a.get('/grande', (req, res) => { res.json({ datos: 'x'.repeat(5000) }); }) });
            expect((await request(app).get('/ping').set('Accept-Encoding', 'gzip')).headers['content-encoding']).to.equal(undefined);
            expect((await request(app).get('/grande').set('Accept-Encoding', 'identity')).headers['content-encoding']).to.equal(undefined);
        });
    });

    describe('express-rate-limit: limitación de tasa', () => {
        it('bloquea con 429 al superar el límite general e informa los encabezados RateLimit', async () => {
            const app = createApp({ rateLimit: { max: 3, loginMax: 100 } });
            for (let i = 0; i < 3; i++) expect((await request(app).get('/api/health')).status).to.not.equal(429);
            const blocked = await request(app).get('/api/health');
            expect(blocked.status).to.equal(429);
            expect(blocked.body).to.deep.equal({ statusCode: 429, status: 'error', message: 'Demasiadas solicitudes desde esta IP, intente más tarde.' });
            expect(blocked.headers['ratelimit-limit']).to.equal('3');
            expect(blocked.headers['ratelimit-remaining']).to.equal('0');
        });

        it('el límite solo afecta a /api/: /ping sigue respondiendo', async () => {
            const app = createApp({ rateLimit: { max: 1, loginMax: 100 } });
            await request(app).get('/api/health');
            expect((await request(app).get('/api/health')).status).to.equal(429);
            for (let i = 0; i < 5; i++) expect((await request(app).get('/ping')).status).to.equal(200);
        });

        it('protege el login contra fuerza bruta: solo cuentan los intentos fallidos', async () => {
            sinon.stub(UserService.prototype, 'findAll').resolves({ statusCode: 200, status: 'success', data: [] });
            const app = createApp({ rateLimit: { max: 1000, loginMax: 3 } });
            const attempt = () => request(app).post('/api/users/login').send({ email: 'a@pms.com', password: 'x' });
            for (let i = 0; i < 3; i++) expect((await attempt()).status).to.equal(404);
            const blocked = await attempt();
            expect(blocked.status).to.equal(429);
            expect(blocked.body.message).to.contain('Demasiadas solicitudes');
        });

        it('los inicios de sesión correctos no consumen el límite estricto', async () => {
            const bcrypt = await import('bcrypt');
            const hash = await bcrypt.hash('Clave123!', 4);
            sinon.stub(UserService.prototype, 'findAll').resolves({ statusCode: 200, status: 'success', data: [{ user_id: 'u', username: 'x', email: 'a@pms.com', password: hash } as any] });
            const app = createApp({ rateLimit: { max: 1000, loginMax: 2 } });
            for (let i = 0; i < 6; i++) {
                expect((await request(app).post('/api/users/login').send({ email: 'a@pms.com', password: 'Clave123!' })).status).to.equal(200);
            }
        });

        it('la limitación se puede desactivar por entorno (usado por las pruebas)', async () => {
            for (let i = 0; i < 5; i++) expect((await request(sharedApp).get('/api/health')).status).to.not.equal(429);
        });
    });

    describe('manejo centralizado de errores', () => {
        const withRoutes = () => createApp({
            extend: (a) => {
                a.get('/falla', () => { throw new Error('detalle interno secreto'); });
                a.get('/falla-async', async () => { throw new HttpError(418, 'soy una tetera'); });
                a.post('/eco', (req, res) => { res.json(req.body); });
            }
        });
        const saved = process.env.NODE_ENV;
        afterEach(() => { process.env.NODE_ENV = saved; });

        it('las rutas inexistentes responden 404 en JSON', async () => {
            const res = await request(sharedApp).get('/api/no-existe');
            expect(res.status).to.equal(404);
            expect(res.body).to.deep.include({ statusCode: 404, status: 'error' });
            expect(res.body.message).to.contain('/api/no-existe');
        });

        it('un error inesperado se convierte en un 500 en JSON, sin traza de pila', async () => {
            sinon.stub(console, 'error');
            process.env.NODE_ENV = 'test';
            const res = await request(withRoutes()).get('/falla');
            expect(res.status).to.equal(500);
            expect(res.body).to.deep.equal({ statusCode: 500, status: 'error', message: 'detalle interno secreto' });
        });

        it('en producción no se filtra el mensaje interno de un error inesperado', async () => {
            sinon.stub(console, 'error');
            process.env.NODE_ENV = 'production';
            const res = await request(withRoutes()).get('/falla');
            expect(res.status).to.equal(500);
            expect(res.body.message).to.equal('Error interno del servidor');
            expect(JSON.stringify(res.body)).to.not.contain('secreto');
        });

        it('solo en desarrollo se incluye la traza de pila', async () => {
            sinon.stub(console, 'error');
            process.env.NODE_ENV = 'development';
            expect((await request(withRoutes()).get('/falla')).body.stack).to.be.a('string');
            process.env.NODE_ENV = 'test';
            expect((await request(withRoutes()).get('/falla')).body).to.not.have.property('stack');
        });

        it('los errores de controladores asíncronos llegan al manejador con su código', async () => {
            const res = await request(withRoutes()).get('/falla-async');
            expect(res.status).to.equal(418);
            expect(res.body.message).to.equal('soy una tetera');
        });

        it('un JSON mal formado da 400 y uno demasiado grande 413, ambos en JSON', async () => {
            const app = withRoutes();
            const bad = await request(app).post('/eco').set('Content-Type', 'application/json').send('{"roto": ');
            expect(bad.status).to.equal(400);
            expect(bad.body.message).to.contain('JSON válido');
            const big = await request(app).post('/eco').send({ texto: 'x'.repeat(60_000) });
            expect(big.status).to.equal(413);
            expect(big.body.status).to.equal('error');
        });
    });
});

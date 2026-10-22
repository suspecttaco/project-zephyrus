import http from 'http';
import { AddressInfo } from 'net';
import sinon from 'sinon';
import { expect } from 'chai';
import { createLoggingProxy } from '../../src/proxies/logging_proxy';
import { HttpClientBuilder } from '../../src/builders/http_client_builder';
import { TwilioSmsAdapter, HttpSmsProviderClient, SimulatedSmsProviderClient, defaultSmsProviderClient } from '../../src/adapters/sms_adapter';

describe('Patrón Proxy: createLoggingProxy', () => {
    beforeEach(() => { sinon.stub(console, 'log'); sinon.stub(console, 'error'); });
    afterEach(() => sinon.restore());

    it('delega la llamada, devuelve el resultado y registra auditoría y métricas', async () => {
        const proxy = createLoggingProxy({ sumar: async (a: number, b: number) => a + b }, 'Calc');
        expect(await proxy.sumar(2, 3)).to.equal(5);
        const lines = (console.log as sinon.SinonStub).args.map((a) => a[0]);
        expect(lines[0]).to.contain('[AUDITORÍA] Iniciando método Calc.sumar');
        expect(lines[1]).to.match(/\[METRICAS\] Método Calc\.sumar completado en [\d.]+ ms/);
    });

    it('registra el error y lo vuelve a lanzar', async () => {
        const proxy = createLoggingProxy({ falla: async () => { throw new Error('boom'); } }, 'Svc');
        let error: any;
        try { await proxy.falla(); } catch (e) { error = e; }
        expect(error.message).to.equal('boom');
        expect((console.error as sinon.SinonStub).firstCall.args[0]).to.contain('falló').and.contain('boom');
    });

    it('las propiedades que no son métodos pasan sin interceptar', () => {
        const proxy = createLoggingProxy({ nombre: 'x', f() { return 1; } }, 'S');
        expect(proxy.nombre).to.equal('x');
    });
});

describe('Patrón Builder: HttpClientBuilder', () => {
    let server: http.Server;
    let url: string;
    let hits: number;
    let lastHeaders: http.IncomingHttpHeaders;
    let failFirst: number;
    let statusOnFail: number;

    before((done) => {
        server = http.createServer((req, res) => {
            hits++;
            lastHeaders = req.headers;
            if (req.url === '/lento') return;
            if (hits <= failFirst) { res.writeHead(statusOnFail); return res.end('{}'); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        }).listen(0, '127.0.0.1', () => {
            url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
            done();
        });
    });
    after(() => { server.closeAllConnections(); server.close(); });
    beforeEach(() => { hits = 0; failFirst = 0; statusOnFail = 500; });

    it('exige una URL base', () => {
        expect(() => new HttpClientBuilder().build()).to.throw('URL base');
    });

    it('encadena la configuración y envía los encabezados', async () => {
        const client = new HttpClientBuilder().setBaseUrl(url).addHeader('X-App', 'pms').setBearerToken('abc').build();
        const res = await client.get('/');
        expect(res.data).to.deep.equal({ ok: true });
        expect(lastHeaders['x-app']).to.equal('pms');
        expect(lastHeaders.authorization).to.equal('Bearer abc');
    });

    it('reintenta ante errores 5xx hasta tener éxito', async () => {
        failFirst = 2;
        const client = new HttpClientBuilder().setBaseUrl(url).setRetries(3).build();
        expect((await client.get('/')).status).to.equal(200);
        expect(hits).to.equal(3);
    });

    it('deja de reintentar al agotar los intentos', async () => {
        failFirst = 99;
        const client = new HttpClientBuilder().setBaseUrl(url).setRetries(2).build();
        let error: any;
        try { await client.get('/'); } catch (e) { error = e; }
        expect(error.response.status).to.equal(500);
        expect(hits).to.equal(3);
    });

    it('no reintenta los errores 4xx (son del cliente)', async () => {
        failFirst = 99; statusOnFail = 400;
        const client = new HttpClientBuilder().setBaseUrl(url).setRetries(3).build();
        try { await client.get('/'); } catch { }
        expect(hits).to.equal(1);
    });

    it('respeta el timeout configurado', async () => {
        const client = new HttpClientBuilder().setBaseUrl(url).setTimeout(150).build();
        let error: any;
        try { await client.get('/lento'); } catch (e) { error = e; }
        expect(error.code).to.equal('ECONNABORTED');
    });
});

describe('Patrón Adapter: TwilioSmsAdapter', () => {
    const saved = { ...process.env };
    afterEach(() => { process.env = { ...saved }; sinon.restore(); });

    it('traduce sendSms() del dominio a dispatchMessage() del proveedor', async () => {
        const dispatchMessage = sinon.stub().resolves({ status: 'delivered' });
        const adapter = new TwilioSmsAdapter('+15005550006', { dispatchMessage });
        expect(await adapter.sendSms('+526671234567', 'hola')).to.equal(true);
        expect(dispatchMessage.firstCall.args[0]).to.deep.equal({ to: '+526671234567', body: 'hola', fromNumber: '+15005550006' });
    });

    it('devuelve false si el proveedor no entrega o falla (nunca lanza al dominio)', async () => {
        sinon.stub(console, 'error');
        expect(await new TwilioSmsAdapter('+1', { dispatchMessage: async () => ({ status: 'failed' }) }).sendSms('+2', 'x')).to.equal(false);
        expect(await new TwilioSmsAdapter('+1', { dispatchMessage: async () => { throw new Error('red'); } }).sendSms('+2', 'x')).to.equal(false);
    });

    it('sin SMS_API_URL usa el proveedor simulado; con ella, el cliente HTTP', () => {
        delete process.env.SMS_API_URL;
        expect(defaultSmsProviderClient()).to.be.instanceOf(SimulatedSmsProviderClient);
        process.env.SMS_API_URL = 'http://127.0.0.1:1';
        expect(defaultSmsProviderClient()).to.be.instanceOf(HttpSmsProviderClient);
    });

    it('el cliente HTTP publica el mensaje en la pasarela con el token', async () => {
        let received: any; let auth: any;
        const server = http.createServer((req, res) => {
            auth = req.headers.authorization;
            let body = '';
            req.on('data', (c) => (body += c)).on('end', () => {
                received = JSON.parse(body);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'delivered' }));
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        const adapter = new TwilioSmsAdapter('+1500', new HttpSmsProviderClient(base, 'tok'));
        expect(await adapter.sendSms('+52667', 'mensaje')).to.equal(true);
        server.close();

        expect(received).to.deep.equal({ to: '+52667', body: 'mensaje', from: '+1500' });
        expect(auth).to.equal('Bearer tok');
    });
});

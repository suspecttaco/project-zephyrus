import sinon from 'sinon';
import { expect } from 'chai';
import { CacheUtil } from '../../src/utils/cache_util';

const originalClient = (CacheUtil as any).client;

const fakeClient = (isReady: boolean) => ({
    isReady,
    get: sinon.stub().resolves(null),
    set: sinon.stub().resolves('OK'),
    del: sinon.stub().resolves(1)
});

describe('Pruebas unitarias: CacheUtil', () => {
    afterEach(() => {
        (CacheUtil as any).client = originalClient;
        sinon.restore();
    });

    describe('con Redis no disponible', () => {
        it('get responde como cache miss sin esperar a Redis', async () => {
            const client = fakeClient(false);
            (CacheUtil as any).client = client;
            expect(await CacheUtil.get('User', '1')).to.equal(null);
            expect(client.get.called).to.be.false;
        });

        it('set y remove no hacen nada ni fallan', async () => {
            const client = fakeClient(false);
            (CacheUtil as any).client = client;
            await CacheUtil.set('User', '1', { a: 1 });
            await CacheUtil.remove('User', '1');
            expect(client.set.called).to.be.false;
            expect(client.del.called).to.be.false;
        });
    });

    describe('con Redis disponible', () => {
        it('set guarda el JSON bajo namespace:clave con tiempo de vida', async () => {
            const client = fakeClient(true);
            (CacheUtil as any).client = client;
            await CacheUtil.set('User', 'abc', { name: 'Ana' }, 120);
            expect(client.set.calledOnceWith('User:abc', JSON.stringify({ name: 'Ana' }), { EX: 120 })).to.be.true;
        });

        it('set aplica un tiempo de vida por defecto', async () => {
            const client = fakeClient(true);
            (CacheUtil as any).client = client;
            await CacheUtil.set('User', 'abc', {});
            expect(client.set.firstCall.args[2].EX).to.be.greaterThan(0);
        });

        it('get devuelve el objeto deserializado', async () => {
            const client = fakeClient(true);
            client.get.resolves(JSON.stringify({ name: 'Ana' }));
            (CacheUtil as any).client = client;
            expect(await CacheUtil.get('User', 'abc')).to.deep.equal({ name: 'Ana' });
            expect(client.get.calledWith('User:abc')).to.be.true;
        });

        it('get devuelve null cuando la clave no existe', async () => {
            (CacheUtil as any).client = fakeClient(true);
            expect(await CacheUtil.get('User', 'nada')).to.equal(null);
        });

        it('remove elimina la clave', async () => {
            const client = fakeClient(true);
            (CacheUtil as any).client = client;
            await CacheUtil.remove('User', 'abc');
            expect(client.del.calledOnceWith('User:abc')).to.be.true;
        });

        it('los errores de Redis se tragan: get devuelve null y set/remove no lanzan', async () => {
            sinon.stub(console, 'error');
            const client = fakeClient(true);
            client.get.rejects(new Error('boom'));
            client.set.rejects(new Error('boom'));
            client.del.rejects(new Error('boom'));
            (CacheUtil as any).client = client;
            expect(await CacheUtil.get('User', '1')).to.equal(null);
            await CacheUtil.set('User', '1', {});
            await CacheUtil.remove('User', '1');
        });
    });
});

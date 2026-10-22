import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect } from 'chai';
import { SimpleLogEngine } from '../../src/engines/simple_log_engine';
import { ActivityStore } from '../../src/engines/activity_store';

describe('Motor Bitcask: SimpleLogEngine (append-only + índice hash)', () => {
    let dir: string;
    let file: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-log-')); file = path.join(dir, 'data.log'); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('guarda y lee valores; las claves inexistentes devuelven null', async () => {
        const engine = new SimpleLogEngine(file);
        await engine.set('a', '1');
        await engine.set('b', '2');
        expect(await engine.get('a')).to.equal('1');
        expect(await engine.get('b')).to.equal('2');
        expect(await engine.get('zzz')).to.equal(null);
        engine.close();
    });

    it('la última escritura de una clave es la vigente, y el archivo solo crece (append-only)', async () => {
        const engine = new SimpleLogEngine(file);
        await engine.set('k', 'v1');
        const sizeAfterFirst = fs.statSync(file).size;
        await engine.set('k', 'v2');
        expect(await engine.get('k')).to.equal('v2');
        expect(fs.statSync(file).size).to.be.greaterThan(sizeAfterFirst);
        expect(fs.readFileSync(file, 'utf8').trim().split('\n')).to.have.lengthOf(2);
        engine.close();
    });

    it('lee valores de cualquier tamaño (el ejemplo original truncaba a 1024 bytes)', async () => {
        const engine = new SimpleLogEngine(file);
        const big = 'x'.repeat(50_000) + 'ñ\u{1F642}';
        await engine.set('grande', big);
        await engine.set('despues', 'ok');
        expect(await engine.get('grande')).to.equal(big);
        expect(await engine.get('despues')).to.equal('ok');
        engine.close();
    });

    it('borra con una lápida (tombstone) y el borrado sobrevive al reinicio', async () => {
        const engine = new SimpleLogEngine(file);
        await engine.set('a', '1');
        expect(await engine.delete('a')).to.equal(true);
        expect(await engine.delete('a')).to.equal(false);
        expect(await engine.get('a')).to.equal(null);
        engine.close();
        const reopened = new SimpleLogEngine(file);
        expect(await reopened.get('a')).to.equal(null);
        reopened.close();
    });

    it('reconstruye el índice al reiniciar: los datos persisten y se puede seguir escribiendo', async () => {
        const first = new SimpleLogEngine(file);
        await first.set('a', '1');
        await first.set('b', '2');
        await first.set('a', '3');
        first.close();

        const second = new SimpleLogEngine(file);
        expect(await second.get('a')).to.equal('3');
        expect(await second.get('b')).to.equal('2');
        await second.set('c', '4');
        expect(await second.get('c')).to.equal('4');
        expect(await second.get('a')).to.equal('3');
        expect(second.stats().keys).to.equal(3);
        second.close();
    });

    it('se recupera de una caída durante una escritura (cola incompleta o corrupta)', async () => {
        const engine = new SimpleLogEngine(file);
        await engine.set('a', '1');
        await engine.set('b', '2');
        engine.close();
        fs.appendFileSync(file, '{"key":"c","val');

        const recovered = new SimpleLogEngine(file);
        expect(await recovered.get('a')).to.equal('1');
        expect(await recovered.get('b')).to.equal('2');
        expect(await recovered.get('c')).to.equal(null);
        await recovered.set('d', '4');
        expect(await recovered.get('d')).to.equal('4');
        recovered.close();
        expect(fs.readFileSync(file, 'utf8')).to.not.contain('"val\n');
        const again = new SimpleLogEngine(file);
        expect(await again.get('d')).to.equal('4');
        again.close();
    });

    it('stats mide el espacio obsoleto y la compactación lo recupera sin perder datos', async () => {
        const engine = new SimpleLogEngine(file);
        for (let i = 0; i < 200; i++) await engine.set(`k${i % 10}`, `valor-${i}`);
        await engine.set('temporal', 'x');
        await engine.delete('temporal');

        const before = engine.stats();
        expect(before.keys).to.equal(10);
        expect(before.garbageRatio).to.be.greaterThan(0.9);

        const after = await engine.compact();
        expect(after.fileBytes).to.be.lessThan(before.fileBytes / 10);
        expect(after.garbageBytes).to.equal(0);
        expect(after.keys).to.equal(10);
        for (let i = 190; i < 200; i++) expect(await engine.get(`k${i % 10}`)).to.equal(`valor-${i}`);
        expect(await engine.get('temporal')).to.equal(null);

        await engine.set('despues', 'ok');
        expect(await engine.get('despues')).to.equal('ok');
        engine.close();
        expect(fs.existsSync(`${file}.compact`)).to.be.false;
    });
});

describe('ActivityStore: LevelDB (LSM-Tree) + motor de registro', () => {
    let dir: string;
    let store: ActivityStore;
    beforeEach(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-act-')); store = new ActivityStore(dir); await store.open(); });
    afterEach(async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('devuelve el historial de una tarea en orden cronológico', async () => {
        await store.record('t1', 'u1', 'task.created');
        await store.record('t1', 'u2', 'task.start', { status: 'In-Progress' });
        await store.record('t1', 'u2', 'task.submit');
        const history = await store.getHistory('t1');
        expect(history.map((e) => e.action)).to.deep.equal(['task.created', 'task.start', 'task.submit']);
        expect(history[1]).to.deep.include({ userId: 'u2', details: { status: 'In-Progress' } });
    });

    it('no pierde eventos aunque ocurran en el mismo milisegundo', async () => {
        await Promise.all(Array.from({ length: 50 }, (_, i) => store.record('t1', 'u', `evento-${i}`)));
        expect(await store.getHistory('t1')).to.have.lengthOf(50);
    });

    it('la consulta por rango aísla cada tarea (sin mezclar las vecinas)', async () => {
        await store.record('tarea-1', 'u', 'a');
        await store.record('tarea-10', 'u', 'b');
        await store.record('tarea-2', 'u', 'c');
        expect((await store.getHistory('tarea-1')).map((e) => e.action)).to.deep.equal(['a']);
        expect(await store.getHistory('inexistente')).to.deep.equal([]);
    });

    it('admite límite y orden descendente', async () => {
        for (let i = 1; i <= 5; i++) await store.record('t', 'u', `e${i}`);
        expect((await store.getHistory('t', { limit: 2 })).map((e) => e.action)).to.deep.equal(['e1', 'e2']);
        expect((await store.getHistory('t', { limit: 2, reverse: true })).map((e) => e.action)).to.deep.equal(['e5', 'e4']);
    });

    it('la última actividad sale del índice hash en una sola lectura', async () => {
        await store.record('t', 'u1', 'primero');
        await store.record('t', 'u2', 'segundo');
        expect((await store.getLast('t'))!.action).to.equal('segundo');
        expect(await store.getLast('otra')).to.equal(null);
        expect(store.stats().latestIndex.keys).to.equal(1);
        expect(store.stats().latestIndex.garbageBytes).to.be.greaterThan(0);
    });

    it('los datos sobreviven al reinicio del proceso', async () => {
        await store.record('t', 'u', 'persistente');
        await store.close();
        store = new ActivityStore(dir);
        await store.open();
        expect((await store.getHistory('t')).map((e) => e.action)).to.deep.equal(['persistente']);
        expect((await store.getLast('t'))!.action).to.equal('persistente');
    });

    it('LevelDB bloquea la carpeta: un segundo proceso no puede abrirla (por eso hay un único dueño)', async () => {
        const second = new ActivityStore(dir);
        let error: any;
        try { await second.open(); } catch (e) { error = e; }
        expect(error, 'debía fallar al abrir una carpeta ya abierta').to.exist;
        second.compact().catch(() => undefined);
    });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect } from 'chai';
import { WorkerPool, TaskTimeoutError, PoolClosedError } from '../../src/utils/worker_pool';

const WORKER_SOURCE = `
const { parentPort, workerData, threadId } = require('node:worker_threads');
const cancel = new Int32Array(workerData.cancel);
const counters = new Int32Array(workerData.counters);
parentPort.postMessage({ ready: true });
parentPort.on('message', ({ id, input }) => {
    if (input.crash) process.exit(3);
    if (input.throw) { Atomics.add(counters, 1, 1); return parentPort.postMessage({ id, error: 'boom' }); }
    if (input.hang) { while (true) {} }                                    // ignora la cancelación
    const end = Date.now() + (input.ms || 0);
    while (Date.now() < end) {
        if (Atomics.load(cancel, 0) === 1) {                               // cancelación cooperativa
            Atomics.store(cancel, 0, 0); Atomics.add(counters, 2, 1);
            return parentPort.postMessage({ id, cancelled: true });
        }
    }
    Atomics.add(counters, 0, 1);
    parentPort.postMessage({ id, result: { echo: input.value, thread: threadId } });
});
`;

describe('WorkerPool (worker threads reutilizables)', () => {
    let dir: string;
    let file: string;
    let pool: WorkerPool | undefined;
    const make = (threads: number, extra: object = {}) => (pool = new WorkerPool({ file, threads, ...extra }));

    before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-pool-')); file = path.join(dir, 'worker.js'); fs.writeFileSync(file, WORKER_SOURCE); });
    after(() => fs.rmSync(dir, { recursive: true, force: true }));
    afterEach(async () => { await pool?.close(); pool = undefined; });

    it('ejecuta tareas en los hilos y devuelve sus resultados', async () => {
        const results = await Promise.all([1, 2, 3].map((value) => make(2).runTask({ value })));
        expect(results.map((r) => r.echo)).to.deep.equal([1, 2, 3]);
    });

    it('reparte el trabajo en paralelo: 4 tareas de 150 ms en 2 hilos tardan ~300 ms, no ~600', async function () {
        this.timeout(5000);
        const p = make(2);
        await p.runTask({ value: 'calentamiento' });
        const started = Date.now();
        const results = await Promise.all([1, 2, 3, 4].map((value) => p.runTask({ value, ms: 150 })));
        const elapsed = Date.now() - started;
        expect(elapsed).to.be.lessThan(520);
        expect(new Set(results.map((r) => r.thread)).size, 'usó los dos hilos').to.equal(2);
    });

    it('encola las tareas cuando todos los hilos están ocupados y las atiende en orden', async () => {
        const p = make(1);
        await p.runTask({ value: 0 });
        const order: number[] = [];
        const tasks = [1, 2, 3].map((value) => p.runTask({ value, ms: 60 }).then(() => order.push(value)));
        expect(p.stats()).to.include({ threads: 1, busy: 1, queued: 2 });
        await Promise.all(tasks);
        expect(order).to.deep.equal([1, 2, 3]);
        expect(p.stats()).to.include({ busy: 0, queued: 0 });
    });

    it('un error dentro del worker rechaza esa tarea y el pool sigue funcionando', async () => {
        const p = make(1);
        let error: any;
        try { await p.runTask({ throw: true }); } catch (e) { error = e; }
        expect(error.message).to.equal('boom');
        expect((await p.runTask({ value: 'sigue' })).echo).to.equal('sigue');
        expect(p.stats().failed).to.equal(1);
    });

    it('si un worker muere, su tarea se rechaza y se crea otro: el pool conserva su tamaño', async () => {
        const p = make(2);
        await p.runTask({ value: 0 });
        let error: any;
        try { await p.runTask({ crash: true }); } catch (e) { error = e; }
        expect(error.message).to.contain('terminó inesperadamente');
        expect(p.stats().threads).to.equal(2);
        const results = await Promise.all([1, 2, 3].map((value) => p.runTask({ value })));
        expect(results.map((r) => r.echo)).to.deep.equal([1, 2, 3]);
    });

    it('tiempo máximo: cancela mediante la bandera compartida (SharedArrayBuffer) y reutiliza el mismo hilo', async function () {
        this.timeout(5000);
        const p = make(1, { taskTimeoutMs: 150 });
        const first = await p.runTask({ value: 'a', ms: 0 });
        const started = Date.now();
        let error: any;
        try { await p.runTask({ ms: 10_000 }); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(TaskTimeoutError);
        expect(Date.now() - started, 'se detuvo por la bandera, no esperó los 10 s').to.be.lessThan(1000);
        expect(p.stats().cancelled).to.equal(1);
        expect((await p.runTask({ value: 'b' })).thread, 'el mismo hilo sigue vivo').to.equal(first.thread);
    });

    it('si el worker no obedece la cancelación, se termina y se reemplaza tras el periodo de gracia', async function () {
        this.timeout(5000);
        const p = make(1, { taskTimeoutMs: 100, cancelGraceMs: 150 });
        const first = await p.runTask({ value: 'a' });
        let error: any;
        try { await p.runTask({ hang: true }); } catch (e) { error = e; }
        expect(error.message).to.contain('terminó inesperadamente');
        const after = await p.runTask({ value: 'b' });
        expect(after.echo).to.equal('b');
        expect(after.thread, 'es un hilo nuevo').to.not.equal(first.thread);
        expect(p.stats().threads).to.equal(1);
    });

    it('los contadores compartidos reflejan lo que hacen los workers sin enviar mensajes', async () => {
        const p = make(2);
        await Promise.all([1, 2, 3, 4, 5].map((value) => p.runTask({ value })));
        expect(p.stats().completed).to.equal(5);
    });

    it('el tiempo máximo no cuenta el arranque del hilo: una tarea esperando a un worker lento no se cancela', async function () {
        this.timeout(5000);
        const slow = path.join(dir, 'slow_boot.js');
        fs.writeFileSync(slow, `const end = Date.now() + 600; while (Date.now() < end) {}\n` + WORKER_SOURCE);
        pool = new WorkerPool({ file: slow, threads: 1, taskTimeoutMs: 200 });
        expect(pool.stats()).to.include({ threads: 1, ready: 0 });
        const result = await pool.runTask({ value: 'llegó antes de que el hilo estuviera listo' });
        expect(result.echo).to.equal('llegó antes de que el hilo estuviera listo');
        expect(pool.stats()).to.include({ ready: 1, cancelled: 0 });
    });

    it('close() rechaza lo pendiente, termina los hilos y no acepta más tareas', async () => {
        const p = make(1);
        await p.runTask({ value: 0 });
        const running = p.runTask({ ms: 5000 });
        const queued = p.runTask({ value: 'en cola' });
        const settled = Promise.allSettled([running, queued]);
        await p.close();
        const [a, b] = await settled;
        expect((a as PromiseRejectedResult).reason).to.be.instanceOf(PoolClosedError);
        expect((b as PromiseRejectedResult).reason).to.be.instanceOf(PoolClosedError);
        expect(p.stats().threads).to.equal(0);
        let error: any;
        try { await p.runTask({ value: 1 }); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(PoolClosedError);
    });
});

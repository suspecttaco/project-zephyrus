import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

export function orderDemo(log: (line: string) => void = console.log): Promise<void> {
    return new Promise((resolve) => {
        log('1. Inicio síncrono');
        setTimeout(() => log('4. Macrotarea: setTimeout (fase Timers)'), 0);
        setImmediate(() => { log('5. Macrotarea: setImmediate (fase Check)'); resolve(); });
        Promise.resolve().then(() => log('3. Microtarea: Promise.then'));
        process.nextTick(() => log('2. Microtarea prioritaria: process.nextTick'));
        log('6. Fin síncrono');
    });
}

const busyWork = (ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { } };

export async function utilizationDemo(log: (line: string) => void = console.log): Promise<{ blocked: number; offloaded: number }> {
    const measure = async (work: () => Promise<void> | void) => {
        const before = performance.eventLoopUtilization();
        await work();
        await new Promise((r) => setTimeout(r, 20));
        return performance.eventLoopUtilization(before).utilization;
    };

    const blocked = await measure(() => busyWork(200));
    log(`Bloqueando el hilo principal 200 ms -> utilización del event loop: ${(blocked * 100).toFixed(1)} %`);

    const offloaded = await measure(() => new Promise<void>((resolve) => {
        const worker = new Worker('const end = Date.now() + 200; while (Date.now() < end) {} require("worker_threads").parentPort.postMessage("ok")', { eval: true });
        worker.once('message', () => { void worker.terminate(); resolve(); });
    }));
    log(`Los mismos 200 ms en un worker thread     -> utilización del event loop: ${(offloaded * 100).toFixed(1)} %`);
    return { blocked, offloaded };
}

if (require.main === module) {
    orderDemo().then(() => utilizationDemo()).then(() => process.exit(0));
}

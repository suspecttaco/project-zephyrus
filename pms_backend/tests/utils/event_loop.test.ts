import { expect } from 'chai';
import { eventLoopSnapshot } from '../../src/utils/event_loop_monitor';
import { orderDemo, utilizationDemo } from '../../src/diagnostics/event_loop_demo';

describe('Diagnóstico del event loop (perf_hooks)', () => {
    it('eventLoopSnapshot devuelve utilización y retraso, y detecta un bloqueo síncrono', async () => {
        eventLoopSnapshot();
        await new Promise((r) => setTimeout(r, 50));
        const calm = eventLoopSnapshot();
        expect(calm.utilization).to.be.within(0, 1);
        await new Promise((r) => setTimeout(r, 30));

        const end = Date.now() + 250;
        while (Date.now() < end) { }
        await new Promise((r) => setTimeout(r, 30));
        const blocked = eventLoopSnapshot();
        expect(blocked.maxDelayMs, 'el histograma vio el bloqueo').to.be.greaterThan(150);
        expect(blocked.maxDelayMs).to.be.greaterThan(calm.maxDelayMs);
    });

    it('orden de ejecución: síncrono, nextTick, microtareas y después las macrotareas', async () => {
        const lines: string[] = [];
        await orderDemo((l) => lines.push(l));
        await new Promise((r) => setTimeout(r, 10));
        expect(lines.slice(0, 4).map((l) => l[0])).to.deep.equal(['1', '6', '2', '3']);
        expect(lines.slice(4).map((l) => l[0]).sort()).to.deep.equal(['4', '5']);
    });

    it('bloquear el hilo principal satura el event loop; el mismo trabajo en un worker thread, no', async function () {
        this.timeout(5000);
        const { blocked, offloaded } = await utilizationDemo(() => undefined);
        expect(blocked).to.be.greaterThan(0.5);
        expect(offloaded).to.be.lessThan(blocked / 2);
    });
});

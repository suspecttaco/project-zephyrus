import { parentPort, workerData } from 'node:worker_threads';
import { simulate, SimulationCancelled, RiskInput } from '../utils/risk_simulation';

const cancel = new Int32Array(workerData.cancel);
const counters = new Int32Array(workerData.counters);

parentPort?.on('message', ({ id, input }: { id: number; input: RiskInput }) => {
    try {
        const result = simulate(input, () => Atomics.load(cancel, 0) === 1);
        Atomics.add(counters, 0, 1);
        parentPort?.postMessage({ id, result });
    } catch (error: any) {
        if (error instanceof SimulationCancelled) {
            Atomics.add(counters, 2, 1);
            parentPort?.postMessage({ id, cancelled: true });
        } else {
            Atomics.add(counters, 1, 1);
            parentPort?.postMessage({ id, error: error.message });
        }
    } finally {
        Atomics.store(cancel, 0, 0);
    }
});

parentPort?.postMessage({ ready: true });

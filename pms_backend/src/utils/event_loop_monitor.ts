import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

let histogram: ReturnType<typeof monitorEventLoopDelay> | undefined;
let lastElu = performance.eventLoopUtilization();

const round = (n: number, digits = 3): number => Math.round(n * 10 ** digits) / 10 ** digits;

export interface EventLoopSnapshot {
    utilization: number;
    p99DelayMs: number;
    maxDelayMs: number;
}

export function eventLoopSnapshot(): EventLoopSnapshot {
    if (!histogram) {
        histogram = monitorEventLoopDelay({ resolution: 10 });
        histogram.enable();
    }
    const elu = performance.eventLoopUtilization(lastElu);
    lastElu = performance.eventLoopUtilization();
    const snapshot = {
        utilization: round(elu.utilization),
        p99DelayMs: round(histogram.percentile(99) / 1e6, 1),
        maxDelayMs: round(histogram.max / 1e6, 1)
    };
    histogram.reset();
    return snapshot;
}

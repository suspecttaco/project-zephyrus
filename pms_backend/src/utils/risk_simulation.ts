
export interface RiskInput {
    assigneeLoads: number[][];
    samples: number;
    seed?: number;
    deadlineHours?: number | null;
}

export interface RiskResult {
    samples: number;
    mean: number;
    p50: number;
    p80: number;
    p90: number;
    p95: number;
    onTimeProbability: number | null;
}

export const MAX_SAMPLES = 5_000_000;
const CANCEL_CHECK_EVERY = 10_000;

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const MIN_FACTOR = 0.8;
const MODE_FACTOR = 1.0;
const MAX_FACTOR = 1.8;
const triangular = (u: number): number => {
    const c = (MODE_FACTOR - MIN_FACTOR) / (MAX_FACTOR - MIN_FACTOR);
    return u < c
        ? MIN_FACTOR + Math.sqrt(u * (MAX_FACTOR - MIN_FACTOR) * (MODE_FACTOR - MIN_FACTOR))
        : MAX_FACTOR - Math.sqrt((1 - u) * (MAX_FACTOR - MIN_FACTOR) * (MAX_FACTOR - MODE_FACTOR));
};

const percentile = (sorted: Float64Array, p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

const round = (n: number): number => Math.round(n * 100) / 100;

export class SimulationCancelled extends Error {
    constructor() {
        super('Simulación cancelada');
    }
}

export function simulate(input: RiskInput, shouldCancel: () => boolean = () => false): RiskResult {
    const samples = Math.floor(input.samples);
    if (!Number.isFinite(samples) || samples < 1 || samples > MAX_SAMPLES) {
        throw new RangeError(`samples debe estar entre 1 y ${MAX_SAMPLES}`);
    }
    const loads = input.assigneeLoads.filter((tasks) => tasks.length > 0);
    if (loads.length === 0 || loads.some((tasks) => tasks.some((h) => !(h >= 0) || !Number.isFinite(h)))) {
        throw new RangeError('assigneeLoads debe tener al menos una tarea con horas válidas');
    }

    const random = mulberry32(input.seed ?? 1);
    const durations = new Float64Array(samples);
    let sum = 0;
    for (let i = 0; i < samples; i++) {
        if (i % CANCEL_CHECK_EVERY === 0 && shouldCancel()) throw new SimulationCancelled();
        let longest = 0;
        for (const tasks of loads) {
            let total = 0;
            for (const hours of tasks) total += hours * triangular(random());
            if (total > longest) longest = total;
        }
        durations[i] = longest;
        sum += longest;
    }

    const sorted = durations.sort();
    const deadline = input.deadlineHours;
    let onTime: number | null = null;
    if (deadline !== undefined && deadline !== null) {
        let within = 0;
        for (let i = 0; i < samples; i++) if (sorted[i] <= deadline) within++;
        onTime = round(within / samples);
    }
    return {
        samples,
        mean: round(sum / samples),
        p50: round(percentile(sorted, 0.5)),
        p80: round(percentile(sorted, 0.8)),
        p90: round(percentile(sorted, 0.9)),
        p95: round(percentile(sorted, 0.95)),
        onTimeProbability: onTime
    };
}

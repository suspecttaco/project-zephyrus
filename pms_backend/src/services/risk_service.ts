import { fork } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { WorkerPool, PoolStats } from '../utils/worker_pool';
import { RiskInput, RiskResult, simulate } from '../utils/risk_simulation';

export type RiskMode = 'thread' | 'process' | 'inline';

const ext = path.extname(__filename);
const workerFile = (name: string): string => path.join(__dirname, '..', 'workers', `${name}${ext}`);

export class RiskAnalysisService {
    private static pool?: WorkerPool<RiskInput, RiskResult>;

    private static timeoutMs(): number {
        return Number(process.env.ANALYTICS_TIMEOUT_MS) || 15_000;
    }

    public static getPool(): WorkerPool<RiskInput, RiskResult> {
        if (!RiskAnalysisService.pool) {
            const threads = Number(process.env.ANALYTICS_THREADS) || Math.max(1, Math.min(2, os.cpus().length - 1));
            RiskAnalysisService.pool = new WorkerPool<RiskInput, RiskResult>({
                file: workerFile('risk_worker'), threads, taskTimeoutMs: RiskAnalysisService.timeoutMs()
            });
        }
        return RiskAnalysisService.pool;
    }

    public static poolStats(): PoolStats | null {
        return RiskAnalysisService.pool?.stats() ?? null;
    }

    public static async closePool(): Promise<void> {
        await RiskAnalysisService.pool?.close();
        RiskAnalysisService.pool = undefined;
    }

    public static async run(mode: RiskMode, input: RiskInput): Promise<RiskResult> {
        switch (mode) {
            case 'thread': return RiskAnalysisService.getPool().runTask(input);
            case 'process': return RiskAnalysisService.runInChildProcess(input);
            case 'inline': return simulate(input);
            default: throw new Error(`Modo no soportado: ${mode}`);
        }
    }

    private static runInChildProcess(input: RiskInput): Promise<RiskResult> {
        return new Promise<RiskResult>((resolve, reject) => {
            const child = fork(workerFile('risk_process'), [], {
                execArgv: ext === '.ts' ? ['-r', 'ts-node/register'] : [],
                env: { NODE_ENV: process.env.NODE_ENV ?? '' }
            });
            let settled = false;
            const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
            const timer = setTimeout(() => done(() => {
                child.kill('SIGKILL');
                reject(new Error(`El proceso hijo superó el tiempo máximo de ${RiskAnalysisService.timeoutMs()} ms y fue terminado`));
            }), RiskAnalysisService.timeoutMs());

            child.on('message', (msg: { result?: RiskResult; error?: string }) =>
                done(() => (msg.error ? reject(new Error(msg.error)) : resolve(msg.result as RiskResult))));
            child.on('error', (error) => done(() => reject(error)));
            child.on('exit', (code) => done(() => reject(new Error(`El proceso hijo terminó inesperadamente (código ${code})`))));
            child.send(input);
        });
    }
}

import { Worker } from 'node:worker_threads';
import path from 'node:path';

export class TaskTimeoutError extends Error {
    constructor(ms: number) {
        super(`La tarea superó el tiempo máximo de ${ms} ms y fue cancelada`);
    }
}

export class PoolClosedError extends Error {
    constructor() {
        super('El pool de workers está cerrado');
    }
}

interface PendingTask<TIn, TOut> {
    id: number;
    input: TIn;
    resolve: (value: TOut) => void;
    reject: (reason: Error) => void;
}

interface Slot<TIn, TOut> {
    worker: Worker;
    cancel: Int32Array;
    ready: boolean;
    current: PendingTask<TIn, TOut> | null;
    timer?: NodeJS.Timeout;
    killer?: NodeJS.Timeout;
}

export interface PoolOptions {
    file: string;
    threads: number;
    taskTimeoutMs?: number;
    cancelGraceMs?: number;
}

export interface PoolStats {
    threads: number;
    ready: number;
    busy: number;
    queued: number;
    completed: number;
    failed: number;
    cancelled: number;
}

export class WorkerPool<TIn = any, TOut = any> {
    private slots: Array<Slot<TIn, TOut>> = [];
    private queue: Array<PendingTask<TIn, TOut>> = [];
    private nextId = 1;
    private closed = false;
    private readonly counters = new Int32Array(new SharedArrayBuffer(4 * 4));
    private readonly timeoutMs: number;
    private readonly graceMs: number;

    constructor(private readonly options: PoolOptions) {
        this.timeoutMs = options.taskTimeoutMs ?? 0;
        this.graceMs = options.cancelGraceMs ?? 1000;
        for (let i = 0; i < options.threads; i++) this.addWorker();
    }

    private static execArgvFor(file: string): string[] {
        return path.extname(file) === '.ts' ? ['-r', 'ts-node/register'] : [];
    }

    private addWorker(): void {
        const cancel = new Int32Array(new SharedArrayBuffer(4));
        const worker = new Worker(this.options.file, {
            workerData: { cancel: cancel.buffer, counters: this.counters.buffer },
            execArgv: WorkerPool.execArgvFor(this.options.file)
        });
        const slot: Slot<TIn, TOut> = { worker, cancel, ready: false, current: null };

        worker.on('message', (msg: { id?: number; ready?: boolean; result?: TOut; error?: string; cancelled?: boolean }) => {
            if (msg.ready) {
                slot.ready = true;
                this.dispatch();
                return;
            }
            const task = slot.current;
            if (!task || task.id !== msg.id) return;
            this.finish(slot);
            if (msg.error) task.reject(new Error(msg.error));
            else if (msg.cancelled) task.reject(new TaskTimeoutError(this.timeoutMs));
            else task.resolve(msg.result as TOut);
            this.dispatch();
        });
        const fail = (error: Error) => {
            if (!this.slots.includes(slot)) return;
            const task = slot.current;
            this.finish(slot);
            this.slots = this.slots.filter((s) => s !== slot);
            Atomics.add(this.counters, 1, 1);
            task?.reject(error);
            if (!this.closed) this.addWorker();
            this.dispatch();
        };
        worker.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))));
        worker.on('exit', (code) => fail(new Error(`El worker terminó inesperadamente (código ${code})`)));

        this.slots.push(slot);
    }

    private finish(slot: Slot<TIn, TOut>): void {
        if (slot.timer) clearTimeout(slot.timer);
        if (slot.killer) clearTimeout(slot.killer);
        slot.timer = slot.killer = undefined;
        slot.current = null;
    }

    public runTask(input: TIn): Promise<TOut> {
        if (this.closed) return Promise.reject(new PoolClosedError());
        return new Promise<TOut>((resolve, reject) => {
            this.queue.push({ id: this.nextId++, input, resolve, reject });
            this.dispatch();
        });
    }

    private dispatch(): void {
        while (this.queue.length > 0) {
            const slot = this.slots.find((s) => s.ready && s.current === null);
            if (!slot) return;
            const task = this.queue.shift()!;
            slot.current = task;
            if (this.timeoutMs > 0) {
                slot.timer = setTimeout(() => {
                    Atomics.store(slot.cancel, 0, 1);
                    slot.killer = setTimeout(() => {
                        if (slot.current === task) {
                            void slot.worker.terminate();
                        }
                    }, this.graceMs);
                }, this.timeoutMs);
            }
            slot.worker.postMessage({ id: task.id, input: task.input });
        }
    }

    public stats(): PoolStats {
        return {
            threads: this.slots.length,
            busy: this.slots.filter((s) => s.current !== null).length,
            ready: this.slots.filter((s) => s.ready).length,
            queued: this.queue.length,
            completed: Atomics.load(this.counters, 0),
            failed: Atomics.load(this.counters, 1),
            cancelled: Atomics.load(this.counters, 2)
        };
    }

    public async close(): Promise<void> {
        this.closed = true;
        this.queue.splice(0).forEach((t) => t.reject(new PoolClosedError()));
        const slots = this.slots.splice(0);
        await Promise.all(slots.map(async (slot) => {
            const task = slot.current;
            this.finish(slot);
            task?.reject(new PoolClosedError());
            await slot.worker.terminate();
        }));
    }
}

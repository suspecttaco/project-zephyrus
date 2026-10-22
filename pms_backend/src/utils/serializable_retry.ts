export interface RetryOptions {
    maxRetries: number;
    initialDelayMs: number;
    onRetry?: (attempt: number, delayMs: number) => void;
}

export const isSerializationFailure = (error: any): boolean =>
    error?.code === '40001' || error?.driverError?.code === '40001' ||
    String(error?.message ?? '').includes('could not serialize access');

export async function executeSerializableTransaction<T>(
    operation: () => Promise<T>,
    options: RetryOptions = { maxRetries: 3, initialDelayMs: 100 }
): Promise<T> {
    let attempt = 0;
    while (true) {
        try {
            attempt++;
            return await operation();
        } catch (error: any) {
            if (isSerializationFailure(error) && attempt <= options.maxRetries) {
                const delay = options.initialDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 50);
                console.warn(`[RETRY_WARN] Transacción abortada por conflicto de serialización (Intento ${attempt}/${options.maxRetries}). Reintentando en ${delay}ms...`);
                options.onRetry?.(attempt, delay);
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
}

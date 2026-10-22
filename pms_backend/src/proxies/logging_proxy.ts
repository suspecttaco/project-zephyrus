import { performance } from 'perf_hooks';

export function createLoggingProxy<T extends object>(target: T, serviceName: string): T {
    return new Proxy(target, {
        get(obj: T, prop: string | symbol, receiver: any) {
            const origMethod = Reflect.get(obj, prop, receiver);
            if (typeof origMethod !== 'function') {
                return origMethod;
            }
            return async function (...args: any[]) {
                const start = performance.now();
                console.log(`[AUDITORÍA] Iniciando método ${serviceName}.${String(prop)} con argumentos:`, JSON.stringify(args));
                try {
                    const result = await origMethod.apply(obj, args);
                    console.log(`[METRICAS] Método ${serviceName}.${String(prop)} completado en ${(performance.now() - start).toFixed(2)} ms`);
                    return result;
                } catch (error: any) {
                    console.error(`[ERROR] Método ${serviceName}.${String(prop)} falló en ${(performance.now() - start).toFixed(2)} ms. Causa: ${error.message}`);
                    throw error;
                }
            };
        }
    });
}

import * as redis from 'redis';

const DEFAULT_TTL_SECONDS = 60 * 60;

export class CacheUtil {
    private static client: any = CacheUtil.createClient();
    private static connecting = false;
    private static errorLogged = false;

    private static createClient(): any {
        const client = redis.createClient(process.env.REDIS_URL ? { url: process.env.REDIS_URL } : undefined);
        client.on('error', (err: any) => {
            if (!CacheUtil.errorLogged) {
                CacheUtil.errorLogged = true;
                console.error(`Error de Cliente Redis: ${err}`);
            }
        });
        client.on('ready', () => {
            CacheUtil.errorLogged = false;
            console.log('Conectado exitosamente a Redis Server');
        });
        return client;
    }

    constructor() {
        if (CacheUtil.client.isOpen || CacheUtil.connecting) {
            return;
        }
        CacheUtil.connecting = true;
        CacheUtil.client.connect()
            .catch((err: any) => console.error(`Error al conectar cliente Redis: ${err}`))
            .finally(() => { CacheUtil.connecting = false; });
    }

    public static isAvailable(): boolean {
        return !!CacheUtil.client.isReady;
    }

    private static key(cacheName: string, key: string): string {
        return `${cacheName}:${key}`;
    }

    public static async get(cacheName: string, key: string): Promise<any | null> {
        if (!CacheUtil.client.isReady) {
            return null;
        }
        try {
            const data = await CacheUtil.client.get(CacheUtil.key(cacheName, key));
            return data ? JSON.parse(data) : null;
        } catch (err) {
            console.error(`Error al obtener clave ${cacheName}:${key} de caché: ${err}`);
            return null;
        }
    }

    public static async set(cacheName: string, key: string, value: any, ttlSeconds: number = DEFAULT_TTL_SECONDS): Promise<void> {
        if (!CacheUtil.client.isReady) {
            return;
        }
        try {
            await CacheUtil.client.set(CacheUtil.key(cacheName, key), JSON.stringify(value), { EX: ttlSeconds });
        } catch (err) {
            console.error(`Error al guardar clave ${cacheName}:${key} en caché: ${err}`);
        }
    }

    public static async remove(cacheName: string, key: string): Promise<void> {
        if (!CacheUtil.client.isReady) {
            return;
        }
        try {
            await CacheUtil.client.del(CacheUtil.key(cacheName, key));
        } catch (err) {
            console.error(`Error al eliminar clave ${cacheName}:${key} de caché: ${err}`);
        }
    }
}

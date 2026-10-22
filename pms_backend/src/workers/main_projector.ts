import 'dotenv/config';
import 'reflect-metadata';
import { DatabaseUtil } from '../utils/db';
import { StreamProcessor } from '../events/stream_processor';

(async () => {
    new DatabaseUtil();
    await DatabaseUtil.waitUntilReady();
    const processor = new StreamProcessor();

    if (process.argv.includes('--rebuild')) {
        const n = await processor.rebuild();
        console.log(`[Proyector] Vista reconstruida reproduciendo ${n} cambios.`);
        process.exit(0);
    }

    processor.start();
    console.log('[Proyector] Procesando el log de cambios de tareas...');
    const shutdown = () => { processor.stop(); console.log('[Proyector] Detenido.'); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
})().catch((error) => {
    console.error('[Proyector] No se pudo iniciar:', error.message);
    process.exit(1);
});

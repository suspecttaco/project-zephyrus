import 'dotenv/config';
import path from 'path';
import { ActivityStore } from '../engines/activity_store';
import { createActivityApp } from './activity_server';

(async () => {
    const dir = process.env.ACTIVITY_DATA_DIR || path.join(process.cwd(), 'data', 'activity');
    const port = Number(process.env.ACTIVITY_PORT) || 4100;

    const store = new ActivityStore(dir);
    await store.open();

    const server = createActivityApp(store).listen(port, '127.0.0.1', () => {
        console.log(`[Actividad] Servicio escuchando en 127.0.0.1:${port} (datos en ${dir}, pid ${process.pid})`);
    });

    const shutdown = async () => {
        console.log('[Actividad] Cerrando motores de almacenamiento...');
        server.close();
        await store.close();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
})().catch((error) => {
    console.error('[Actividad] No se pudo iniciar:', error.message);
    process.exit(1);
});

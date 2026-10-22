import "dotenv/config";
import cluster from "cluster";
import os from "os";
import { ExpressServer } from "./express_server";
import { DDLUtil } from "./utils/ddl_util";
import { CacheUtil } from "./utils/cache_util";
import { UsersUtil } from "./utils/users_util";
import { QueueWorker } from "./workers/queue_worker";

if (process.argv.includes('--init')) {
    console.log(`Proceso Maestro PID: ${process.pid}`);
    DDLUtil.addDefaultRoleAndUser()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Error al ejecutar --init:', error);
            process.exit(1);
        });
} else if (cluster.isPrimary) {
    const numCPUs = Number(process.env.WEB_CONCURRENCY) || os.cpus().length;
    console.log(`Master process ${process.pid} is running. Forking for ${numCPUs} CPUs...`);

    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker process ${worker.process.pid} died. Restarting ... `);
        cluster.fork();
    });
} else {
    new CacheUtil();
    setTimeout(() => {
        UsersUtil.putAllUsersInCache();
    }, 10000);
    const queueWorker = new QueueWorker();
    queueWorker.beginProcessing();

    const server = new ExpressServer();

    process.on('uncaughtException', (error: Error) => {
        console.error(`Uncaught exception in worker process ${process.pid}:`, error);
        server.closeServer();
    });

    process.on('SIGINT', () => {
        console.log(`Received SIGINT. Closing worker process ... `);
        server.closeServer();
    });

    process.on('SIGTERM', () => {
        console.log(`Received SIGTERM. Closing worker process ... `);
        server.closeServer();
    });
}
import cluster from "node:cluster";
import os from "node:os";
import process from "node:process";

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
    console.log(`[cluster] primary ${process.pid} starting ${numCPUs} workers`);

    let shuttingDown = false;

    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on("exit", (worker, code, signal) => {
        if (shuttingDown) {
            console.log(`[cluster] worker ${worker.process.pid} exited (${signal || code})`);
            return;
        }
        console.log(`[cluster] worker ${worker.process.pid} died (${signal || code}), restarting`);
        cluster.fork();
    });

    function shutdownPrimary(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[cluster] primary ${process.pid} received ${signal}, stopping workers`);
        for (const id in cluster.workers) {
            cluster.workers[id].process.kill(signal);
        }
    }

    process.on("SIGTERM", () => shutdownPrimary("SIGTERM"));
    process.on("SIGINT", () => shutdownPrimary("SIGINT"));
} else {
    await import("./server.js");
}

import { Express } from "express";
import { IServerConfig } from "./utils/config";
import config from "../server_config.json";
import { createApp } from "./app";
import  { DatabaseUtil } from "./utils/db";
import { RiskAnalysisService } from "./services/risk_service";

export class ExpressServer {
    public static server: any = null;
    public server_config: IServerConfig = config;

    constructor () {
        const port = Number(process.env.PORT) || this.server_config.port || 3000;
        const app: Express = createApp();
        console.log('Server Routes started for server');

        new DatabaseUtil();

        ExpressServer.server = app.listen(port, () => {
            console.log(`Server is running on port ${port} with pid = ${process.pid}`);
        });
    }

    public closeServer(): void {
        if (ExpressServer.server) {
            ExpressServer.server.close(async () => {
                await RiskAnalysisService.closePool();
                console.log('Server closed gracefully');
                process.exit(0);
            });
        }
    }
}
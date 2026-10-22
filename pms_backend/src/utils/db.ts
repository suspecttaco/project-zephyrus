import { DataSource, EntityTarget, ObjectLiteral, QueryRunner, Repository } from "typeorm";
import { IServerConfig } from "./config";
import config from "../../server_config.json";
import { Roles } from "../components/roles/roles_entity";
import { Users } from "../components/users/users_entity";
import { Projects } from "../components/projects/projects_entity";
import { Tasks } from "../components/tasks/tasks_entity";
import { Comments} from "../components/comments/comments_entity";
import { AuditEvents } from "../components/audit/audit_entity";
import { TaskChanges, StreamOffsets, ProjectMetrics } from "../events/entities";
import { ensureCdc } from "../events/cdc";

export class DatabaseUtil {
    public server_config: IServerConfig = config;
    private static dataSource?: DataSource;
    private static ready?: Promise<void>;

    constructor() {
        this.connectDatabase();
    }

    private connectDatabase(): void {
        if (DatabaseUtil.dataSource) {
            return;
        }

        const db_config = this.server_config.db_config;
        const dataSource = new DataSource({
            type: 'postgres',
            host: process.env.DB_HOST || db_config.host,
            port: Number(process.env.DB_PORT) || db_config.port,
            username: process.env.DB_USER || db_config.username,
            password: process.env.DB_PASSWORD || db_config.password,
            database: process.env.DB_NAME || db_config.dbname,
            entities: [Roles, Users, Projects, Tasks, Comments, AuditEvents, TaskChanges, StreamOffsets, ProjectMetrics],
            synchronize: true,
            logging: false
        });

        DatabaseUtil.dataSource = dataSource;
        DatabaseUtil.ready = dataSource.initialize()
            .then(() => ensureCdc(dataSource))
            .then(() => {
                console.log('Connected to the database with all entities synchronized');
            })
            .catch((error) => {
                DatabaseUtil.dataSource = undefined;
                console.log('Error connecting to database:', error);
            });
    }

    public static async waitUntilReady(): Promise<void> {
        await DatabaseUtil.ready;
    }

    public getRepository<T extends ObjectLiteral>(entity: EntityTarget<T>): Repository<T> {
        return DatabaseUtil.dataSource!.getRepository(entity);
    }

    public createQueryRunner(): QueryRunner {
        return DatabaseUtil.dataSource!.createQueryRunner();
    }

    public getDataSource(): DataSource {
        return DatabaseUtil.dataSource!;
    }
}
import { Pool } from 'pg';
import config from '../../server_config.json';

class DatabaseConnection {
    private pool: Pool;
    private static instance: DatabaseConnection;

    private constructor() {
        const db = config.db_config;
        this.pool = new Pool({
            host: process.env.DB_HOST || db.host,
            port: Number(process.env.DB_PORT) || db.port,
            user: process.env.DB_USER || db.username,
            password: process.env.DB_PASSWORD || db.password,
            database: process.env.DB_NAME || db.dbname,
            max: 20,
            connectionTimeoutMillis: 3000
        });
        this.pool.on('error', (err) => {
            console.error('Error imprevisto en el cliente de PostgreSQL:', err);
        });
    }

    public static getInstance(): DatabaseConnection {
        if (!DatabaseConnection.instance) {
            DatabaseConnection.instance = new DatabaseConnection();
        }
        return DatabaseConnection.instance;
    }

    public getPool(): Pool {
        return this.pool;
    }
}

export const dbConnection = DatabaseConnection.getInstance();
export default dbConnection;

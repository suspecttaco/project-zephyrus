import { Client } from 'pg';
import request from 'supertest';
import config from '../../server_config.json';
import { app } from '../../src/app';
import { DatabaseUtil } from '../../src/utils/db';
import { DDLUtil } from '../../src/utils/ddl_util';
import { ensureCdc } from '../../src/events/cdc';
import { CacheUtil } from '../../src/utils/cache_util';
import { QueueWorker } from '../../src/workers/queue_worker';

export const api = () => request(app);
export const MAIL_API = process.env.MAIL_API || 'http://localhost:8025';
export const SUPERADMIN = { email: 'superadmin@pms.com', password: 'SuperAdmin123!' };

let unique = 0;
export const uniq = (): string => `${Date.now().toString(36).slice(-4)}${(unique++).toString(36)}`;

const ensureDatabase = async (): Promise<void> => {
    const db = config.db_config;
    const client = new Client({
        host: process.env.DB_HOST || db.host,
        port: Number(process.env.DB_PORT) || db.port,
        user: process.env.DB_USER || db.username,
        password: process.env.DB_PASSWORD || db.password,
        database: 'postgres'
    });
    await client.connect();
    const name = process.env.DB_NAME!;
    const exists = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (exists.rowCount === 0) {
        await client.query(`create database "${name}"`);
    }
    await client.end();
};

export const bootstrap = async (): Promise<void> => {
    if (!/_test$/.test(process.env.DB_NAME || '')) {
        throw new Error(`Las pruebas de integración solo corren sobre una base *_test (DB_NAME=${process.env.DB_NAME})`);
    }
    await ensureDatabase();
    new DatabaseUtil();
    await DatabaseUtil.waitUntilReady();
    await new DatabaseUtil().getDataSource().synchronize(true);
    await ensureCdc(new DatabaseUtil().getDataSource());
    await DDLUtil.addDefaultRoleAndUser();
    new CacheUtil();
    new QueueWorker().beginProcessing();
};

export const login = async (email = SUPERADMIN.email, password = SUPERADMIN.password) => {
    const res = await api().post('/api/users/login').send({ email, password });
    return { status: res.status, access: res.body.data?.accessToken as string, refresh: res.body.data?.refreshToken as string };
};

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export const mailpitAvailable = async (): Promise<boolean> => {
    try {
        return (await fetch(`${MAIL_API}/api/v1/messages`)).ok;
    } catch {
        return false;
    }
};

export const waitFor = async (check: () => Promise<boolean>, timeoutMs = 20000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
};

export const mailsWithSubject = async (subject: string): Promise<any[]> => {
    const res = await fetch(`${MAIL_API}/api/v1/messages`);
    const body: any = await res.json();
    return body.messages.filter((m: any) => m.Subject.includes(subject));
};

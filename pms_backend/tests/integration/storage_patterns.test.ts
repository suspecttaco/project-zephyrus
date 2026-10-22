import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect } from 'chai';
import { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteBucketCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { DatabaseUtil } from '../../src/utils/db';
import { EncryptedTaskRepositoryDecorator } from '../../src/decorators/encrypted_task_repository_decorator';
import { TypeOrmTaskRepository } from '../../src/repositories/typeorm_task_repository';
import { api, auth, login, uniq } from './helpers';

const S3_ENDPOINT = process.env.TEST_S3_ENDPOINT || 'http://127.0.0.1:4566';

const s3Available = async (): Promise<boolean> => {
    try {
        process.env.AWS_ENDPOINT_URL = S3_ENDPOINT;
        const client = new S3Client({ region: 'us-east-1', endpoint: S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
        await client.send(new HeadBucketCommand({ Bucket: 'no-existe-' + uniq() })).catch((e) => { if (e?.$metadata?.httpStatusCode === undefined) throw e; });
        return true;
    } catch {
        return false;
    }
};

describe('Integración (real): adjuntos con Factory, Proxy y Adapter; Decorator y Singleton', () => {
    let admin: string;
    let adminId: string;
    let taskId: string;
    const saved = { ...process.env };
    const payload = Buffer.from('contenido real del adjunto\n'.repeat(500));

    const send = (name: string, body: Buffer = payload, extra = '') =>
        api().post(`/api/tasks/${taskId}/attachments?filename=${name}${extra}`).set(auth(admin)).set('Content-Type', 'application/octet-stream').send(body);

    before(async () => {
        admin = (await login()).access;
        adminId = (await api().get('/api/users?username=superadmin').set(auth(admin))).body.data[0].user_id;
        const project = (await api().post('/api/projects').set(auth(admin)).send({ name: `Adj${uniq()}` })).body.data;
        taskId = (await api().post('/api/tasks').set(auth(admin)).send({ name: `T${uniq()}`, project_id: project.project_id, user_id: adminId })).body.data.task_id;
    });
    afterEach(() => { process.env = { ...saved }; });

    it('GET /api/health usa el pool Singleton de PostgreSQL y reporta Redis', async () => {
        const res = await api().get('/api/health');
        expect(res.status).to.equal(200);
        expect(res.body).to.include({ status: 'ok', postgres: true });
    });

    describe('proveedor local (disco)', () => {
        let dir: string;
        beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-int-')); process.env.STORAGE_PROVIDER = 'local'; process.env.LOCAL_UPLOAD_DIR = dir; });
        afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

        it('sube, lista, descarga del disco y elimina un archivo real', async () => {
            const res = await send('informe.txt', payload, '&phone=%2B526671234567');
            expect(res.status).to.equal(201);
            const file = path.join(dir, 'tasks', taskId, 'informe.txt');
            expect(fs.readFileSync(file).equals(payload)).to.be.true;

            const list = await api().get(`/api/tasks/${taskId}/attachments`).set(auth(admin));
            expect(list.body.data.map((a: any) => a.name)).to.include('informe.txt');
            expect(list.body.data.find((a: any) => a.name === 'informe.txt').size).to.equal(payload.length);

            expect((await api().delete(`/api/tasks/${taskId}/attachments/informe.txt`).set(auth(admin))).status).to.equal(200);
            expect(fs.existsSync(file)).to.be.false;
            const after = await api().get(`/api/tasks/${taskId}/attachments`).set(auth(admin));
            expect(after.body.data.map((a: any) => a.name)).to.not.include('informe.txt');
        });

        it('no permite escribir fuera de la carpeta de adjuntos', async () => {
            expect((await send('..%2F..%2Fescape.txt')).status).to.equal(400);
            expect(fs.readdirSync(dir)).to.have.lengthOf(0);
        });
    });

    describe('proveedor S3 (LocalStack)', () => {
        const bucket = `pms-int-${uniq()}`;
        let client: S3Client;

        before(async function () {
            if (!(await s3Available())) return this.skip();
            client = new S3Client({ region: 'us-east-1', endpoint: S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
        });
        beforeEach(() => { process.env.STORAGE_PROVIDER = 's3'; process.env.AWS_S3_BUCKET = bucket; process.env.AWS_ENDPOINT_URL = S3_ENDPOINT; });
        after(async () => {
            if (!client) return;
            const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket })).catch(() => undefined);
            for (const obj of listed?.Contents ?? []) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
            await client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
        });

        it('crea el bucket, sube el archivo a S3 y lo recupera idéntico', async () => {
            const res = await send('reporte.txt');
            expect(res.status).to.equal(201);
            expect(res.body.data.url).to.equal(`s3://${bucket}/tasks/${taskId}/reporte.txt`);

            const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `tasks/${taskId}/reporte.txt` }));
            expect(Buffer.from(await got.Body!.transformToByteArray()).equals(payload)).to.be.true;
        });

        it('elimina el objeto de S3 al borrar el adjunto', async () => {
            await send('temporal.txt');
            expect((await api().delete(`/api/tasks/${taskId}/attachments/temporal.txt`).set(auth(admin))).status).to.equal(200);
            const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `tasks/${taskId}/temporal` }));
            expect(listed.KeyCount).to.equal(0);
        });

        it('la misma API cambia de proveedor solo con la variable STORAGE_PROVIDER', async () => {
            process.env.STORAGE_PROVIDER = 'memory';
            const res = await send('memoria.txt');
            expect(res.body.data.url).to.equal(`memory://tasks/${taskId}/memoria.txt`);
        });
    });

    describe('Decorator de cifrado sobre PostgreSQL', () => {
        it('la descripción queda cifrada en la base y se lee en claro a través del decorador', async () => {
            const project = (await api().post('/api/projects').set(auth(admin)).send({ name: `Enc${uniq()}` })).body.data;
            const repo = new EncryptedTaskRepositoryDecorator(new TypeOrmTaskRepository());

            const created = await repo.create({ name: `Cif${uniq()}`, description: 'credenciales del cliente', project_id: project.project_id, user_id: adminId });

            const raw = await new DatabaseUtil().getDataSource().query('select description from tasks where task_id = $1', [created.task_id]);
            expect(raw[0].description).to.match(/^enc:v1:/);
            expect(raw[0].description).to.not.contain('credenciales');
            expect((await repo.findById(created.task_id!))!.description).to.equal('credenciales del cliente');
        });
    });
});

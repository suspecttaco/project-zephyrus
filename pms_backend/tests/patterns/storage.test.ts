import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { expect } from 'chai';
import { StorageFactory } from '../../src/factories/storage_factory';
import { DiskStorageService, MemoryStorageService } from '../../src/services/storage_service';
import { S3StorageService, createS3Client } from '../../src/services/s3_storage_service';

describe('Patrón Factory: StorageFactory', () => {
    const saved = { ...process.env };
    afterEach(() => {
        process.env = { ...saved };
        sinon.restore();
    });

    it('crea el proveedor pedido sin que el cliente conozca la clase concreta', () => {
        expect(StorageFactory.createStorage('local')).to.be.instanceOf(DiskStorageService);
        expect(StorageFactory.createStorage('memory')).to.be.instanceOf(MemoryStorageService);
    });

    it('crea el proveedor S3 cuando hay bucket y endpoint de LocalStack', () => {
        process.env.AWS_S3_BUCKET = 'pms-attachments';
        process.env.AWS_ENDPOINT_URL = 'http://127.0.0.1:4566';
        expect(StorageFactory.createStorage('s3')).to.be.instanceOf(S3StorageService);
    });

    it('S3 exige el nombre del bucket', () => {
        delete process.env.AWS_S3_BUCKET;
        expect(() => StorageFactory.createStorage('s3')).to.throw('AWS_S3_BUCKET');
    });

    it('S3 se niega a funcionar sin endpoint: nunca habla con una cuenta real de AWS', () => {
        process.env.AWS_S3_BUCKET = 'pms-attachments';
        delete process.env.AWS_ENDPOINT_URL;
        expect(() => StorageFactory.createStorage('s3')).to.throw('LocalStack');
        expect(() => createS3Client()).to.throw('AWS_ENDPOINT_URL');
    });

    it('rechaza tipos no soportados', () => {
        expect(() => StorageFactory.createStorage('ftp' as any)).to.throw('no soportado');
    });

    it('el directorio local por defecto es ./uploads y se puede cambiar con LOCAL_UPLOAD_DIR', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-up-'));
        process.env.LOCAL_UPLOAD_DIR = dir;
        const src = path.join(dir, 'origen.txt');
        fs.writeFileSync(src, 'hola');
        const url = await StorageFactory.createStorage('local').uploadFile(src, 'a/b.txt');
        expect(url).to.equal(path.join(dir, 'a', 'b.txt'));
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe('Proveedores de almacenamiento', () => {
    let dir: string;
    let source: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-st-'));
        source = path.join(dir, 'origen.txt');
        fs.writeFileSync(source, 'contenido');
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('disco: copia el archivo, crea subcarpetas y lo borra', async () => {
        const storage = new DiskStorageService(path.join(dir, 'uploads'));
        const target = await storage.uploadFile(source, 'tasks/1/a.txt');
        expect(fs.readFileSync(target, 'utf8')).to.equal('contenido');
        await storage.deleteFile('tasks/1/a.txt');
        expect(fs.existsSync(target)).to.be.false;
    });

    it('disco: rechaza claves que salen de la carpeta base', async () => {
        const storage = new DiskStorageService(path.join(dir, 'uploads'));
        let error: any;
        try { await storage.uploadFile(source, '../fuera.txt'); } catch (e) { error = e; }
        expect(error.message).to.equal('Ruta de destino inválida');
    });

    it('memoria: guarda el contenido y permite borrarlo', async () => {
        const storage = new MemoryStorageService();
        expect(await storage.uploadFile(source, 'k')).to.equal('memory://k');
        expect(storage.files.get('k')!.toString()).to.equal('contenido');
        await storage.deleteFile('k');
        expect(storage.files.has('k')).to.be.false;
    });

    it('S3: sube con la clave y el tamaño correctos y crea el bucket si no existe', async () => {
        const send = sinon.stub();
        send.onFirstCall().rejects({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });
        send.resolves({});
        const storage = new S3StorageService('mi-bucket', { send } as any);

        const url = await storage.uploadFile(source, 'tasks/1/a.txt');

        expect(url).to.equal('s3://mi-bucket/tasks/1/a.txt');
        const names = send.args.map((a) => a[0].constructor.name);
        expect(names).to.deep.equal(['HeadBucketCommand', 'CreateBucketCommand', 'PutObjectCommand']);
        expect(send.args[2][0].input).to.include({ Bucket: 'mi-bucket', Key: 'tasks/1/a.txt', ContentLength: 9 });
    });

    it('S3: rechaza claves peligrosas', async () => {
        const storage = new S3StorageService('b', { send: sinon.stub().resolves({}) } as any);
        for (const key of ['/abs', '../x', 'a/../b', '']) {
            let error: any;
            try { await storage.uploadFile(source, key); } catch (e) { error = e; }
            expect(error?.message, key).to.equal('Clave de destino inválida');
        }
    });
});

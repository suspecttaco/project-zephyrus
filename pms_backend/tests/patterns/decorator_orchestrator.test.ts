import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { expect } from 'chai';
import { cryptoUtil } from '../../src/utils/crypto_util';
import { EncryptedTaskRepositoryDecorator } from '../../src/decorators/encrypted_task_repository_decorator';
import { ITaskRepository, TaskEntity } from '../../src/repositories/task_repository';
import { TaskOrchestrator } from '../../src/components/tasks/task_orchestrator';
import { MemoryStorageService } from '../../src/services/storage_service';

class InMemoryTaskRepository implements ITaskRepository {
    public readonly rows = new Map<string, TaskEntity>();
    async create(task: TaskEntity) { const saved = { ...task, task_id: `t${this.rows.size + 1}` }; this.rows.set(saved.task_id, saved); return saved; }
    async findById(id: string) { return this.rows.get(id) ?? null; }
}

describe('cryptoUtil (AES-256-GCM)', () => {
    it('cifra y descifra de ida y vuelta, incluso con acentos y emojis', () => {
        const text = 'Contraseña del servidor: ñandú \u{1F510}';
        const encrypted = cryptoUtil.encrypt(text);
        expect(encrypted).to.not.contain('ñandú');
        expect(encrypted).to.match(/^enc:v1:/);
        expect(cryptoUtil.decrypt(encrypted)).to.equal(text);
    });

    it('cada cifrado usa un IV distinto', () => {
        expect(cryptoUtil.encrypt('igual')).to.not.equal(cryptoUtil.encrypt('igual'));
    });

    it('detecta datos alterados', () => {
        const encrypted = cryptoUtil.encrypt('secreto');
        const raw = Buffer.from(encrypted.slice(7), 'base64');
        raw[raw.length - 1] ^= 0xff;
        expect(() => cryptoUtil.decrypt('enc:v1:' + raw.toString('base64'))).to.throw();
    });

    it('los valores sin cifrar (datos anteriores) se devuelven tal cual', () => {
        expect(cryptoUtil.decrypt('texto plano')).to.equal('texto plano');
        expect(cryptoUtil.isEncrypted('texto plano')).to.be.false;
    });

    it('ENCRYPTION_KEY debe ser hexadecimal de 64 caracteres', () => {
        const prev = process.env.ENCRYPTION_KEY;
        process.env.ENCRYPTION_KEY = 'corta';
        expect(() => cryptoUtil.encrypt('x')).to.throw('64 caracteres');
        if (prev === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = prev;
    });
});

describe('Patrón Decorator: EncryptedTaskRepositoryDecorator', () => {
    it('guarda la descripción cifrada y la devuelve en claro', async () => {
        const inner = new InMemoryTaskRepository();
        const repo = new EncryptedTaskRepositoryDecorator(inner);

        const created = await repo.create({ name: 'T', description: 'dato confidencial' });

        expect(created.description).to.equal('dato confidencial');
        expect(inner.rows.get(created.task_id!)!.description).to.match(/^enc:v1:/);
        expect((await repo.findById(created.task_id!))!.description).to.equal('dato confidencial');
    });

    it('no falla con tareas sin descripción ni con ids inexistentes', async () => {
        const repo = new EncryptedTaskRepositoryDecorator(new InMemoryTaskRepository());
        const created = await repo.create({ name: 'Sin descripción' });
        expect((await repo.findById(created.task_id!))!.description).to.equal(undefined);
        expect(await repo.findById('nada')).to.equal(null);
    });

    it('se puede componer con cualquier ITaskRepository (misma interfaz)', async () => {
        const inner: ITaskRepository = { create: sinon.stub().callsFake(async (t) => t), findById: sinon.stub().resolves(null) };
        await new EncryptedTaskRepositoryDecorator(inner).create({ name: 'x', description: 'y' });
        expect((inner.create as sinon.SinonStub).firstCall.args[0].description).to.match(/^enc:v1:/);
    });
});

describe('TaskOrchestrator (Factory + Proxy + Adapter con inyección de dependencias)', () => {
    let file: string;
    beforeEach(() => { file = path.join(os.tmpdir(), `orq-${Date.now()}.txt`); fs.writeFileSync(file, 'adjunto'); sinon.stub(console, 'log'); });
    afterEach(() => { fs.rmSync(file, { force: true }); sinon.restore(); });

    it('sube el archivo con la clave tasks/<id>/<nombre> y notifica por SMS', async () => {
        const storage = new MemoryStorageService();
        const notifier = { sendSms: sinon.stub().resolves(true) };

        const url = await new TaskOrchestrator(storage, notifier).processTaskAttachment('tsk-1', file, 'doc.txt', '+526671234567');

        expect(url).to.equal('memory://tasks/tsk-1/doc.txt');
        expect(storage.files.get('tasks/tsk-1/doc.txt')!.toString()).to.equal('adjunto');
        expect(notifier.sendSms.firstCall.args[0]).to.equal('+526671234567');
        expect(notifier.sendSms.firstCall.args[1]).to.contain('doc.txt').and.contain('tsk-1');
    });

    it('sin teléfono no envía SMS', async () => {
        const notifier = { sendSms: sinon.stub().resolves(true) };
        await new TaskOrchestrator(new MemoryStorageService(), notifier).processTaskAttachment('t', file, 'a.txt');
        expect(notifier.sendSms.called).to.be.false;
    });

    it('un fallo del SMS no impide guardar el adjunto', async () => {
        const storage = new MemoryStorageService();
        const url = await new TaskOrchestrator(storage, { sendSms: async () => false }).processTaskAttachment('t', file, 'a.txt', '+526671234567');
        expect(url).to.equal('memory://tasks/t/a.txt');
    });

    it('elimina el adjunto del almacenamiento', async () => {
        const storage = new MemoryStorageService();
        const orchestrator = new TaskOrchestrator(storage, { sendSms: async () => true });
        await orchestrator.processTaskAttachment('t', file, 'a.txt');
        await orchestrator.removeTaskAttachment('t', 'a.txt');
        expect(storage.files.size).to.equal(0);
    });
});

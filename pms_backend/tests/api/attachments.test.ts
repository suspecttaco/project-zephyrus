import sinon from 'sinon';
import request from 'supertest';
import { expect } from 'chai';
import { app } from '../../src/app';
import { TaskService } from '../../src/components/tasks/tasks_service';
import { TaskOrchestrator } from '../../src/components/tasks/task_orchestrator';
import { TaskTransactionService } from '../../src/components/tasks/task_transaction_service';
import { fakeUser, ok, stubAuth } from '../helpers/auth';

const TASK_ID = '44444444-4444-4444-8444-444444444444';
const url = (qs = 'filename=informe.pdf') => `/api/tasks/${TASK_ID}/attachments?${qs}`;
const upload = (token: string, qs?: string, body: Buffer | string = Buffer.from('contenido')) =>
    request(app).post(url(qs)).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send(body as any);

describe('Pruebas de integración (API): adjuntos de tareas', () => {
    beforeEach(() => sinon.stub(console, 'log'));
    afterEach(() => sinon.restore());

    it('exige autenticación (401) y el derecho edit_task (403)', async () => {
        expect((await request(app).post(url()).send('x')).status).to.equal(401);
        const token = stubAuth(['get_all_tasks']);
        expect((await upload(token)).status).to.equal(403);
    });

    it('valida el nombre del archivo, el teléfono y el cuerpo (400)', async () => {
        const token = stubAuth(['edit_task']);
        expect((await upload(token, 'filename=../../etc/passwd')).status).to.equal(400);
        expect((await upload(token, 'filename=')).status).to.equal(400);
        expect((await upload(token, 'filename=a.txt&phone=abc')).status).to.equal(400);
        const empty = await request(app).post(url('filename=a.txt')).set('Authorization', `Bearer ${token}`);
        expect(empty.status).to.equal(400);
        expect(empty.body.message).to.contain('binario');
    });

    it('responde 404 si la tarea no existe', async () => {
        const token = stubAuth(['edit_task']);
        sinon.stub(TaskService.prototype, 'findOne').resolves({ statusCode: 404, status: 'error', message: 'Recurso no encontrado' });
        const process = sinon.stub(TaskOrchestrator.prototype, 'processTaskAttachment');
        expect((await upload(token)).status).to.equal(404);
        expect(process.called).to.be.false;
    });

    it('guarda el archivo con el orquestador y registra el adjunto en la tarea con bloqueo (201)', async () => {
        const token = stubAuth(['edit_task']);
        sinon.stub(TaskService.prototype, 'findOne').resolves(ok({ task_id: TASK_ID, supported_files: null }));
        const process = sinon.stub(TaskOrchestrator.prototype, 'processTaskAttachment').resolves('s3://b/tasks/x/informe.pdf');
        const add = sinon.stub(TaskTransactionService.prototype, 'addAttachment').resolves('ok');

        const res = await upload(token, 'filename=informe.pdf&phone=%2B526671234567', 'abcdef');

        expect(res.status).to.equal(201);
        expect(res.body.data).to.include({ name: 'informe.pdf', url: 's3://b/tasks/x/informe.pdf', size: 6, uploaded_by: fakeUser.user_id });
        expect(process.firstCall.args[0]).to.equal(TASK_ID);
        expect(process.firstCall.args[2]).to.equal('informe.pdf');
        expect(process.firstCall.args[3]).to.equal('+526671234567');
        expect(add.firstCall.args[0]).to.equal(TASK_ID);
        expect(add.firstCall.args[1]).to.include({ name: 'informe.pdf', url: 's3://b/tasks/x/informe.pdf' });
    });

    it('si la tarea desaparece mientras se sube, responde 404', async () => {
        const token = stubAuth(['edit_task']);
        sinon.stub(TaskService.prototype, 'findOne').resolves(ok({ task_id: TASK_ID }));
        sinon.stub(TaskOrchestrator.prototype, 'processTaskAttachment').resolves('x');
        sinon.stub(TaskTransactionService.prototype, 'addAttachment').resolves('task_not_found');
        expect((await upload(token)).status).to.equal(404);
    });

    it('responde 500 con el motivo si el almacenamiento falla', async () => {
        const token = stubAuth(['edit_task']);
        sinon.stub(TaskService.prototype, 'findOne').resolves(ok({ task_id: TASK_ID }));
        sinon.stub(TaskOrchestrator.prototype, 'processTaskAttachment').rejects(new Error('S3 caído'));
        const res = await upload(token);
        expect(res.status).to.equal(500);
        expect(res.body.message).to.contain('S3 caído');
    });

    it('lista los adjuntos (y tolera datos corruptos)', async () => {
        const token = stubAuth(['get_details_task']);
        const find = sinon.stub(TaskService.prototype, 'findOne');
        find.onFirstCall().resolves(ok({ supported_files: JSON.stringify([{ name: 'a.txt' }]) }));
        find.onSecondCall().resolves(ok({ supported_files: '{no es json' }));
        const first = await request(app).get(url('')).set('Authorization', `Bearer ${token}`);
        expect(first.body.data).to.deep.equal([{ name: 'a.txt' }]);
        const second = await request(app).get(url('')).set('Authorization', `Bearer ${token}`);
        expect(second.body.data).to.deep.equal([]);
    });

    it('elimina un adjunto de la tarea y del almacenamiento; 404 si no existe', async () => {
        const token = stubAuth(['edit_task']);
        sinon.stub(TaskService.prototype, 'findOne').resolves(ok({ task_id: TASK_ID }));
        const remove = sinon.stub(TaskOrchestrator.prototype, 'removeTaskAttachment').resolves();
        const removeFromList = sinon.stub(TaskTransactionService.prototype, 'removeAttachment');
        removeFromList.onFirstCall().resolves('ok');
        removeFromList.onSecondCall().resolves('attachment_not_found');

        const res = await request(app).delete(`/api/tasks/${TASK_ID}/attachments/a.txt`).set('Authorization', `Bearer ${token}`);
        expect(res.status).to.equal(200);
        expect(removeFromList.calledWith(TASK_ID, 'a.txt')).to.be.true;
        expect(remove.calledWith(TASK_ID, 'a.txt')).to.be.true;

        const missing = await request(app).delete(`/api/tasks/${TASK_ID}/attachments/nada.txt`).set('Authorization', `Bearer ${token}`);
        expect(missing.status).to.equal(404);
        expect(remove.calledOnce).to.be.true;
    });
});

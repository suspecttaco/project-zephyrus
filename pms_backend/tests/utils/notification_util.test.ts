import sinon from 'sinon';
import { expect } from 'chai';
import { NotificationUtil } from '../../src/utils/notification_util';
import * as emailUtil from '../../src/utils/email_util';
import * as emailQueue from '../../src/utils/email_queue';
import { ProjectsUtil } from '../../src/utils/projects_util';
import { TaskNotifications } from '../../src/utils/task_notifications';

describe('Pruebas aisladas con stubs: NotificationUtil', () => {
    afterEach(() => sinon.restore());

    it('enqueueEmail agrega el trabajo a la cola con reintentos y espera exponencial', async () => {
        const add = sinon.stub().resolves();
        sinon.stub(emailQueue, 'getEmailQueue').returns({ add } as any);

        await NotificationUtil.enqueueEmail('dev@pms.com', 'Asunto', '<p>Hola</p>');

        expect(add.calledOnce).to.be.true;
        expect(add.firstCall.args[0]).to.deep.equal({ to: 'dev@pms.com', subject: 'Asunto', body: '<p>Hola</p>' });
        expect(add.firstCall.args[1]).to.deep.include({ attempts: 3, removeOnComplete: true });
        expect(add.firstCall.args[1].backoff).to.deep.equal({ type: 'exponential', delay: 5000 });
    });

    it('sendEmail usa el transporte SMTP sin enviar un correo real', async () => {
        const send = sinon.stub(emailUtil, 'sendMail').resolves(true);
        expect(await NotificationUtil.sendEmail('dev@pms.com', 'Asunto', '<p>Hola</p>')).to.equal(true);
        expect(send.calledOnceWith('dev@pms.com', 'Asunto', '<p>Hola</p>')).to.be.true;
    });

    it('sendEmail retorna false si el transporte falla', async () => {
        sinon.stub(emailUtil, 'sendMail').resolves(false);
        expect(await NotificationUtil.sendEmail('dev@pms.com', 'x', 'y')).to.equal(false);
    });
});

describe('Pruebas unitarias: TaskNotifications', () => {
    afterEach(() => sinon.restore());

    it('notifyMembers encola un correo por miembro sin duplicados', async () => {
        sinon.stub(ProjectsUtil, 'getProjectMemberEmails').resolves(['a@pms.com', 'b@pms.com', 'a@pms.com']);
        const enqueue = sinon.stub(NotificationUtil, 'enqueueEmail').resolves();

        await TaskNotifications.notifyMembers('p1', 'Asunto', 'Cuerpo');

        expect(enqueue.callCount).to.equal(2);
        expect(enqueue.args.map((a) => a[0])).to.have.members(['a@pms.com', 'b@pms.com']);
    });

    it('no consulta miembros cuando el proyecto no está definido', async () => {
        expect(await ProjectsUtil.getProjectMemberEmails(undefined as any)).to.deep.equal([]);
    });
});

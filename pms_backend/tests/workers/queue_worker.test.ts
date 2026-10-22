import sinon from 'sinon';
import { expect } from 'chai';
import { QueueWorker, processEmailJob } from '../../src/workers/queue_worker';
import { NotificationUtil } from '../../src/utils/notification_util';
import * as emailQueue from '../../src/utils/email_queue';

const job = (extra: object = {}): any => ({ id: 7, data: { to: 'dev@pms.com', subject: 'Asunto', body: '<p>Hola</p>' }, opts: { attempts: 3 }, attemptsMade: 1, ...extra });

describe('Pruebas unitarias: QueueWorker', () => {
    beforeEach(() => {
        sinon.stub(console, 'log');
        sinon.stub(console, 'warn');
        sinon.stub(console, 'error');
    });
    afterEach(() => sinon.restore());

    describe('processEmailJob', () => {
        it('envía el correo del trabajo', async () => {
            const send = sinon.stub(NotificationUtil, 'sendEmail').resolves(true);
            await processEmailJob(job());
            expect(send.calledOnceWith('dev@pms.com', 'Asunto', '<p>Hola</p>')).to.be.true;
        });

        it('lanza un error si el envío falla para que Bull reintente', async () => {
            sinon.stub(NotificationUtil, 'sendEmail').resolves(false);
            let error: any;
            try {
                await processEmailJob(job());
            } catch (e) {
                error = e;
            }
            expect(error).to.be.an('error');
            expect(error.message).to.contain('dev@pms.com');
        });
    });

    describe('beginProcessing', () => {
        const setup = () => {
            const handlers: Record<string, Function> = {};
            const queue = { process: sinon.stub(), on: sinon.stub().callsFake((event: string, fn: Function) => { handlers[event] = fn; }) };
            sinon.stub(emailQueue, 'getEmailQueue').returns(queue as any);
            new QueueWorker().beginProcessing();
            return { queue, handlers };
        };

        it('registra el procesador de trabajos', () => {
            const { queue } = setup();
            expect(queue.process.calledOnceWith(processEmailJob)).to.be.true;
        });

        it('avisa del reintento mientras queden intentos', () => {
            const { handlers } = setup();
            handlers.failed(job({ attemptsMade: 1 }), new Error('smtp'));
            expect((console.warn as sinon.SinonStub).calledOnce).to.be.true;
            expect((console.error as sinon.SinonStub).called).to.be.false;
        });

        it('marca como crítico el trabajo que agota sus intentos', () => {
            const { handlers } = setup();
            handlers.failed(job({ attemptsMade: 3 }), new Error('smtp'));
            expect((console.error as sinon.SinonStub).firstCall.args[0]).to.contain('[CRITICAL]');
        });
    });
});

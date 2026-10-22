import { Job } from 'bull';
import { NotificationUtil } from '../utils/notification_util';
import { getEmailQueue } from '../utils/email_queue';

export const processEmailJob = async (job: Job): Promise<void> => {
    try {
        const { to, subject, body } = job.data;
        const success = await NotificationUtil.sendEmail(to, subject, body);
        if (!success) {
            throw new Error(`Fallo en el transporte SMTP para destinatario: ${to}`);
        }
        console.log(`[OK] Correo enviado exitosamente a: ${to}`);
    } catch (error: any) {
        console.error(`[ERROR] Error procesando trabajo #${job.id}: ${error.message}`);
        throw error;
    }
};

export class QueueWorker {
    constructor() {
        console.log('[OK] Inicializando QueueWorker...');
    }

    public beginProcessing(): void {
        const emailQueue = getEmailQueue();
        emailQueue.process(processEmailJob);

        emailQueue.on('failed', (job, err) => {
            const maxAttempts = job.opts.attempts ?? 1;
            console.warn(`[WARN] Trabajo #${job.id} falló. Intento ${job.attemptsMade} de ${maxAttempts}: ${err.message}`);
            if (job.attemptsMade >= maxAttempts) {
                console.error(`[CRITICAL] Trabajo #${job.id} superó el límite de reintentos. Queda en la cola de fallidos para revisión.`);
            }
        });
    }
}

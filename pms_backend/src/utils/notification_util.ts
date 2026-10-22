import { sendMail } from './email_util';
import { EMAIL_JOB_OPTIONS, getEmailQueue } from './email_queue';

export class NotificationUtil {
    public static async enqueueEmail(to: string, subject: string, body: string): Promise<void> {
        await getEmailQueue().add({ to, subject, body }, EMAIL_JOB_OPTIONS);
    }

    public static async sendEmail(to: string, subject: string, body: string): Promise<boolean> {
        return sendMail(to, subject, body);
    }
}

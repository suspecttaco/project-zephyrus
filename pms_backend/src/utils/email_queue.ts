import Queue from 'bull';

export const EMAIL_QUEUE_NAME = 'emailQueue';

export const EMAIL_JOB_OPTIONS: Queue.JobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: false
};

let emailQueue: Queue.Queue | undefined;
let errorLogged = false;

export const getEmailQueue = (): Queue.Queue => {
    if (!emailQueue) {
        emailQueue = new Queue(EMAIL_QUEUE_NAME, process.env.REDIS_URL || 'redis://127.0.0.1:6379');
        emailQueue.on('error', (err) => {
            if (!errorLogged) {
                errorLogged = true;
                console.error(`[ERROR] Cola de correos: ${err.message}`);
            }
        });
        emailQueue.on('ready', () => { errorLogged = false; });
    }
    return emailQueue;
};

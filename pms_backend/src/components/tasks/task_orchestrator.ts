import { StorageFactory, StorageType } from '../../factories/storage_factory';
import { IStorageService } from '../../services/storage_service';
import { createLoggingProxy } from '../../proxies/logging_proxy';
import { TwilioSmsAdapter, ISmsNotifier } from '../../adapters/sms_adapter';

export class TaskOrchestrator {
    constructor(
        private readonly storage: IStorageService = createLoggingProxy(
            StorageFactory.createStorage((process.env.STORAGE_PROVIDER as StorageType) || 'local'),
            'StorageService'
        ),
        private readonly notifier: ISmsNotifier = new TwilioSmsAdapter(process.env.SMS_FROM_NUMBER || '+15005550006')
    ) {}

    public static keyFor(taskId: string, fileName: string): string {
        return `tasks/${taskId}/${fileName}`;
    }

    public async processTaskAttachment(taskId: string, filePath: string, fileName: string, userPhone?: string): Promise<string> {
        const fileUrl = await this.storage.uploadFile(filePath, TaskOrchestrator.keyFor(taskId, fileName));
        console.log(`[TAREA ${taskId}] Archivo adjuntado exitosamente en: ${fileUrl}`);

        if (userPhone) {
            const notified = await this.notifier.sendSms(userPhone, `Tu archivo ${fileName} para la tarea ${taskId} fue subido con éxito.`);
            if (notified) {
                console.log(`[NOTIFICACIÓN] SMS enviado a ${userPhone}`);
            }
        }
        return fileUrl;
    }

    public async removeTaskAttachment(taskId: string, fileName: string): Promise<void> {
        await this.storage.deleteFile(TaskOrchestrator.keyFor(taskId, fileName));
        console.log(`[TAREA ${taskId}] Archivo ${fileName} eliminado`);
    }
}

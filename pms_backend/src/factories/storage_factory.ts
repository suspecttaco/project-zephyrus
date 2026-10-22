import path from 'path';
import { DiskStorageService, MemoryStorageService, IStorageService } from '../services/storage_service';
import { S3StorageService } from '../services/s3_storage_service';

export type StorageType = 'local' | 's3' | 'memory';

export class StorageFactory {
    public static createStorage(type: StorageType): IStorageService {
        switch (type) {
            case 'local': {
                const uploadDir = process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads');
                return new DiskStorageService(uploadDir);
            }
            case 's3': {
                const bucket = process.env.AWS_S3_BUCKET;
                if (!bucket) {
                    throw new Error('Error de configuración: AWS_S3_BUCKET no está definido');
                }
                return new S3StorageService(bucket);
            }
            case 'memory':
                return new MemoryStorageService();
            default:
                throw new Error(`Tipo de almacenamiento no soportado: ${type}`);
        }
    }
}

import fs from 'fs/promises';
import path from 'path';

export interface IStorageService {
    uploadFile(sourcePath: string, destinationKey: string): Promise<string>;
    deleteFile(destinationKey: string): Promise<void>;
}

export class DiskStorageService implements IStorageService {
    constructor(private readonly baseDir: string) {}

    public async uploadFile(sourcePath: string, destinationKey: string): Promise<string> {
        const target = this.resolveSafe(destinationKey);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(sourcePath, target);
        return target;
    }

    public async deleteFile(destinationKey: string): Promise<void> {
        await fs.rm(this.resolveSafe(destinationKey), { force: true });
    }

    private resolveSafe(key: string): string {
        const root = path.resolve(this.baseDir);
        const target = path.resolve(root, key);
        if (!target.startsWith(root + path.sep)) {
            throw new Error('Ruta de destino inválida');
        }
        return target;
    }
}

export class MemoryStorageService implements IStorageService {
    public readonly files = new Map<string, Buffer>();

    public async uploadFile(sourcePath: string, destinationKey: string): Promise<string> {
        this.files.set(destinationKey, await fs.readFile(sourcePath));
        return `memory://${destinationKey}`;
    }

    public async deleteFile(destinationKey: string): Promise<void> {
        this.files.delete(destinationKey);
    }
}

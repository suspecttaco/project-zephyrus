import * as fs from 'fs';
import * as path from 'path';

interface Location {
    offset: number;
    length: number;
}

export interface LogEngineStats {
    keys: number;
    fileBytes: number;
    garbageBytes: number;
    garbageRatio: number;
}

export class SimpleLogEngine {
    private index = new Map<string, Location>();
    private fileSize = 0;
    private garbageBytes = 0;
    private fd: number;

    constructor(private readonly filepath: string) {
        fs.mkdirSync(path.dirname(filepath), { recursive: true });
        this.fd = fs.openSync(filepath, 'a+');
        this.rebuildIndex();
    }

    private rebuildIndex(): void {
        this.index.clear();
        this.garbageBytes = 0;
        const data = fs.readFileSync(this.filepath);
        let offset = 0;
        while (offset < data.length) {
            const newline = data.indexOf(0x0a, offset);
            if (newline === -1) break;
            const length = newline - offset + 1;
            let entry: { key: string; value?: string; deleted?: boolean };
            try {
                entry = JSON.parse(data.subarray(offset, newline).toString('utf-8'));
            } catch {
                break;
            }
            const previous = this.index.get(entry.key);
            if (previous) this.garbageBytes += previous.length;
            if (entry.deleted) {
                this.index.delete(entry.key);
                this.garbageBytes += length;
            } else {
                this.index.set(entry.key, { offset, length });
            }
            offset += length;
        }
        if (offset < data.length) {
            fs.ftruncateSync(this.fd, offset);
        }
        this.fileSize = offset;
    }

    private append(entry: object): Location {
        const buffer = Buffer.from(JSON.stringify(entry) + '\n', 'utf-8');
        fs.writeSync(this.fd, buffer, 0, buffer.length);
        const location = { offset: this.fileSize, length: buffer.length };
        this.fileSize += buffer.length;
        return location;
    }

    public async set(key: string, value: string): Promise<void> {
        const previous = this.index.get(key);
        if (previous) this.garbageBytes += previous.length;
        this.index.set(key, this.append({ key, value }));
    }

    public async get(key: string): Promise<string | null> {
        const location = this.index.get(key);
        if (!location) return null;
        const buffer = Buffer.alloc(location.length);
        fs.readSync(this.fd, buffer, 0, location.length, location.offset);
        return JSON.parse(buffer.toString('utf-8')).value;
    }

    public async delete(key: string): Promise<boolean> {
        const previous = this.index.get(key);
        if (!previous) return false;
        const tombstone = this.append({ key, deleted: true });
        this.index.delete(key);
        this.garbageBytes += previous.length + tombstone.length;
        return true;
    }

    public stats(): LogEngineStats {
        return {
            keys: this.index.size,
            fileBytes: this.fileSize,
            garbageBytes: this.garbageBytes,
            garbageRatio: this.fileSize === 0 ? 0 : this.garbageBytes / this.fileSize
        };
    }

    public async compact(): Promise<LogEngineStats> {
        const tmp = `${this.filepath}.compact`;
        const out = fs.openSync(tmp, 'w');
        for (const key of [...this.index.keys()]) {
            const value = await this.get(key);
            fs.writeSync(out, Buffer.from(JSON.stringify({ key, value }) + '\n', 'utf-8'));
        }
        fs.fsyncSync(out);
        fs.closeSync(out);
        fs.closeSync(this.fd);
        fs.renameSync(tmp, this.filepath);
        this.fd = fs.openSync(this.filepath, 'a+');
        this.rebuildIndex();
        return this.stats();
    }

    public close(): void {
        fs.closeSync(this.fd);
    }
}

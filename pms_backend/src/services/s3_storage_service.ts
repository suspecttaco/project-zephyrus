import fs from 'fs';
import { stat } from 'fs/promises';
import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    HeadBucketCommand,
    CreateBucketCommand
} from '@aws-sdk/client-s3';
import { IStorageService } from './storage_service';

export function createS3Client(): S3Client {
    const endpoint = process.env.AWS_ENDPOINT_URL;
    if (!endpoint) {
        throw new Error('S3 solo se usa con LocalStack: define AWS_ENDPOINT_URL (por ejemplo http://localhost:4566)');
    }
    return new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
    });
}

export class S3StorageService implements IStorageService {
    private bucketReady = false;

    constructor(
        private readonly bucket: string,
        private readonly client: S3Client = createS3Client()
    ) {}

    public async ensureBucket(): Promise<void> {
        if (this.bucketReady) return;
        try {
            await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        } catch (err: any) {
            if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') {
                await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
            } else {
                throw err;
            }
        }
        this.bucketReady = true;
    }

    public async uploadFile(sourcePath: string, destinationKey: string): Promise<string> {
        const key = this.safeKey(destinationKey);
        await this.ensureBucket();
        const { size } = await stat(sourcePath);
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: fs.createReadStream(sourcePath),
            ContentLength: size
        }));
        return `s3://${this.bucket}/${key}`;
    }

    public async deleteFile(destinationKey: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.safeKey(destinationKey) }));
    }

    private safeKey(key: string): string {
        if (!key || key.startsWith('/') || key.split('/').includes('..')) {
            throw new Error('Clave de destino inválida');
        }
        return key;
    }
}

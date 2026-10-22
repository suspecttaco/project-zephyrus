import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { SERVER_CONST } from './common';

const PREFIX = 'enc:v1:';

function getKey(): Buffer {
    const fromEnv = process.env.ENCRYPTION_KEY;
    if (fromEnv) {
        if (!/^[0-9a-fA-F]{64}$/.test(fromEnv)) {
            throw new Error('ENCRYPTION_KEY debe tener 64 caracteres hexadecimales (32 bytes)');
        }
        return Buffer.from(fromEnv, 'hex');
    }
    return scryptSync(SERVER_CONST.JWTSECRET, 'pms-encryption-salt', 32);
}

export const cryptoUtil = {
    encrypt(plainText: string): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
        const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
        return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    },

    isEncrypted(value: string): boolean {
        return typeof value === 'string' && value.startsWith(PREFIX);
    },

    decrypt(value: string): string {
        if (!this.isEncrypted(value)) {
            return value;
        }
        const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
        const decipher = createDecipheriv('aes-256-gcm', getKey(), raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    }
};

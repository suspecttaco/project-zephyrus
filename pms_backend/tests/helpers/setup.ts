import { DatabaseUtil } from '../../src/utils/db';

(DatabaseUtil.prototype as any).connectDatabase = () => undefined;
DatabaseUtil.prototype.getRepository = (() => ({})) as any;

process.env.ACTIVITY_DISABLED = 'true';
process.env.RATE_LIMIT_DISABLED = 'true';

process.env.DB_NAME = process.env.DB_NAME || 'pms_db_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379/1';
process.env.SMTP_HOST = process.env.TEST_SMTP_HOST || 'localhost';
process.env.SMTP_PORT = process.env.TEST_SMTP_PORT || '1025';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.SMTP_FROM = 'pms-tests@pms.com';
process.env.RATE_LIMIT_DISABLED = 'true';

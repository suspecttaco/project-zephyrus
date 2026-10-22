require('dotenv').config({ quiet: true });

module.exports = {
    apps: [{
        name: 'pms-backend',
        script: './dist/src/main.js',
        instances: process.env.WEB_CONCURRENCY || 'max',
        exec_mode: 'cluster',
        env_production: {
            NODE_ENV: 'production',
            PORT: 8080
        }
    }, {
        name: 'pms-activity',
        script: './dist/src/workers/main_activity.js',
        instances: 1,
        exec_mode: 'fork',
        env_production: {
            NODE_ENV: 'production'
        }
    }, {
        name: 'pms-projector',
        script: './dist/src/workers/main_projector.js',
        instances: 1,
        exec_mode: 'fork',
        env_production: { NODE_ENV: 'production' }
    }, {
        name: 'pms-audit',
        script: './dist/src/workers/main_audit.js',
        instances: 1,
        exec_mode: 'fork',
        exp_backoff_restart_delay: 1000,
        env_production: { NODE_ENV: 'production' }
    }, {
        name: 'pms-notifications',
        script: './dist/src/workers/main_notifications.js',
        instances: 1,
        exec_mode: 'fork',
        exp_backoff_restart_delay: 1000,
        env_production: { NODE_ENV: 'production' }
    }]
};

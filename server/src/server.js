import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

const app = createApp();

// 启动时打印关键环境变量（脱敏），用于排查云容器数据库连接
const mask = (v) => (v ? v.slice(0, 12) + '***' + v.slice(-6) : '(unset)');
logger.info('env check', {
  DATABASE_URL: mask(process.env.DATABASE_URL),
  TCB_ENV_ID: process.env.TCB_ENV_ID || process.env.CLOUDBASE_ENV_ID || '(unset)',
  TCB_SECRET_ID: process.env.TCB_SECRET_ID ? 'set' : 'unset',
  PORT: process.env.port,
});

const server = app.listen(config.port, () => {
  logger.info(`ohu-server listening on port ${config.port} (${config.nodeEnv})`);
  logger.info(`health: http://localhost:${config.port}/health`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down');
  server.close(() => process.exit(0));
});

export default server;

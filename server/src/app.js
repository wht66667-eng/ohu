import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/error.js';
import { logger } from './logger.js';

import healthRouter from './routes/health.js';
import usersRouter from './routes/users.js';
import friendsRouter from './routes/friends.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(config.isProd ? 'combined' : 'dev'));

  app.get('/', (_req, res) => res.redirect('/health'));
  app.use('/health', healthRouter);
  /* 手机号登录/注册路由已移除：学生端改为学号本机身份。 */
  app.use('/api/users', usersRouter);
  app.use('/api/friends', friendsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

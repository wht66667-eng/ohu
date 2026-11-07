import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ohu',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  smsProvider: process.env.SMS_PROVIDER || 'mock',
  smsMockCode: process.env.SMS_MOCK_CODE || '123456',
  cloudbaseEnvId: process.env.CLOUDBASE_ENV_ID || 'jou-d4gq7a3cqf51e6caa',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:8080').split(','),
};

export const isProd = config.nodeEnv === 'production';

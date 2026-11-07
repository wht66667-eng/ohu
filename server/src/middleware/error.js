import { logger } from '../logger.js';

// 统一错误处理中间件
export function errorHandler(err, _req, res, _next) {
  // Zod 校验错误
  if (err.name === 'ZodError') {
    const message = err.errors.map(e => e.message).join('；');
    return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message });
  }

  // 唯一约束冲突
  if (err.code === '23505') {
    return res.status(409).json({ ok: false, code: 'CONFLICT', message: '数据已存在' });
  }

  logger.error('unhandled error', { message: err.message, stack: err.stack?.slice(0, 300) });
  res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
}

// 404
export function notFound(_req, res) {
  res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '接口不存在' });
}

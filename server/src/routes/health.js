import { Router } from 'express';
import pkg from '../../package.json' with { type: 'json' };
import { query } from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const mask = (v) => (v ? v.slice(0, 14) + '***' + v.slice(-6) : '(unset)');
  let dbStatus = 'untested';
  let dbError = null;
  let dbRows = null;
  try {
    const r = await query('SELECT id FROM v2_users LIMIT 1');
    dbStatus = 'ok';
    dbRows = r.rows;
  } catch (e) {
    dbStatus = 'error';
    dbError = e.message;
  }
  res.json({
    ok: true,
    service: 'ohu-server',
    version: pkg.version,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    db: { status: dbStatus, error: dbError, rows: dbRows },
    env: {
      DATABASE_URL: mask(process.env.DATABASE_URL),
      TCB_ENV_ID: process.env.TCB_ENV_ID || process.env.CLOUDBASE_ENV_ID || '(unset)',
      TCB_SECRET_ID: process.env.TCB_SECRET_ID ? 'set' : 'unset',
    },
  });
});

export default router;

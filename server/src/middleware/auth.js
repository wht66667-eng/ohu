import { verifyToken, extractToken } from '../utils/jwt.js';
import { query } from '../db.js';

// 鉴权中间件：验证 JWT 并加载当前用户到 req.user
export async function authRequired(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: '请先登录' });
  }
  try {
    const payload = verifyToken(token);
    const { rows } = await query(
      `SELECT id, phone, status FROM v2_users WHERE id = $1 AND status = 'active'`,
      [payload.uid]
    );
    if (rows.length === 0) {
      return res.status(401).json({ ok: false, code: 'ACCOUNT_INVALID', message: '账号不存在或已停用' });
    }
    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ ok: false, code: 'TOKEN_INVALID', message: '登录已过期，请重新登录' });
  }
}

// 可选鉴权：有 token 则加载用户，无 token 也放行
export async function authOptional(req, _res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = verifyToken(token);
      const { rows } = await query(
        `SELECT id, phone, status FROM v2_users WHERE id = $1 AND status = 'active'`,
        [payload.uid]
      );
      if (rows.length) req.user = rows[0];
    } catch {
      // 忽略无效 token
    }
  }
  next();
}

// 角色校验：检查当前用户是否拥有指定角色
export function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: '请先登录' });
    // 分两次查询替代 JOIN
    const { rows: grantRows } = await query(
      `SELECT role_id FROM v2_role_grants WHERE user_id = $1 AND revoked_at IS NULL`,
      [req.user.id]
    );
    const roleIds = grantRows.map((r) => r.role_id);
    const userRoles = [];
    for (const rid of roleIds) {
      const { rows } = await query(`SELECT code FROM v2_roles WHERE id = $1`, [rid]);
      if (rows[0]) userRoles.push(rows[0].code);
    }
    const has = userRoles.includes('owner') || roles.some(r => userRoles.includes(r));
    if (!has) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', message: '没有权限执行该操作' });
    }
    req.roles = userRoles;
    next();
  };
}

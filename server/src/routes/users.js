import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

const profileSchema = z.object({
  nickname: z.string().max(20).optional(),
  avatar_url: z.string().url().optional(),
  bio: z.string().max(100).optional(),
  school: z.string().optional(),
  campus: z.string().optional(),
});

// 获取自己的资料
router.get('/me', authRequired, async (req, res, next) => {
  try {
    // 分两次查询避免 JOIN（PostgREST 模式限制）
    const { rows: userRows } = await query(
      `SELECT id, status FROM v2_users WHERE id = $1`,
      [req.user.id]
    );
    const { rows: profileRows } = await query(
      `SELECT nickname, avatar_url, bio, school, campus FROM v2_profiles WHERE user_id = $1`,
      [req.user.id]
    );
    const user = userRows[0] || {};
    const profile = profileRows[0] || {};
    res.json({ ok: true, user: { ...user, ...profile } });
  } catch (e) { next(e); }
});

// 更新自己的资料
router.put('/me', authRequired, async (req, res, next) => {
  try {
    const data = profileSchema.parse(req.body);
    const sets = [];
    const params = [req.user.id];
    let i = 2;
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        sets.push(`${k} = $${i}`);
        params.push(v);
        i++;
      }
    }
    if (sets.length === 0) return res.json({ ok: true });

    await query(
      `UPDATE v2_profiles SET ${sets.join(', ')}, updated_at = NOW() WHERE user_id = $1`,
      params
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 查看他人公开资料
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT user_id, nickname, avatar_url, bio, school, campus FROM v2_profiles WHERE user_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '用户不存在' });
    res.json({ ok: true, profile: rows[0] });
  } catch (e) { next(e); }
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { randomId } from '../utils/crypto.js';

const router = Router();

// 发送好友请求
router.post('/requests', authRequired, async (req, res, next) => {
  try {
    const schema = z.object({ to_user_id: z.string().uuid(), message: z.string().max(100).optional() });
    const { to_user_id, message } = schema.parse(req.body);
    if (to_user_id === req.user.id) {
      return res.status(400).json({ ok: false, code: 'SELF_REQUEST', message: '不能添加自己为好友' });
    }
    // 检查是否已是好友
    const { rows: friends } = await query(
      `SELECT user_id FROM v2_friendships WHERE user_id = $1 AND friend_id = $2`,
      [req.user.id, to_user_id]
    );
    if (friends.length) {
      return res.status(409).json({ ok: false, code: 'ALREADY_FRIEND', message: '你们已经是好友' });
    }
    // 检查是否已有待处理请求（替代 ON CONFLICT）
    const { rows: existing } = await query(
      `SELECT id FROM v2_friend_requests WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'`,
      [req.user.id, to_user_id]
    );
    if (existing.length) {
      return res.status(409).json({ ok: false, code: 'ALREADY_REQUESTED', message: '已发送过好友请求' });
    }
    const id = randomId();
    await query(
      `INSERT INTO v2_friend_requests (id, from_user_id, to_user_id, message, status) VALUES ($1, $2, $3, $4, $5)`,
      [id, req.user.id, to_user_id, message || '', 'pending']
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 处理好友请求
router.post('/requests/:id/respond', authRequired, async (req, res, next) => {
  try {
    const schema = z.object({ action: z.enum(['accept', 'reject']) });
    const { action } = schema.parse(req.body);
    await tx(async (client) => {
      const { rows } = await client.query(
        `SELECT id, from_user_id, to_user_id FROM v2_friend_requests WHERE id = $1 AND to_user_id = $2 AND status = 'pending'`,
        [req.params.id, req.user.id]
      );
      if (rows.length === 0) throw Object.assign(new Error('请求不存在'), { status: 404 });
      const reqRow = rows[0];
      await client.query(`UPDATE v2_friend_requests SET status = $1 WHERE id = $2`, [action, req.params.id]);
      if (action === 'accept') {
        // 分两次插入替代多值 INSERT（PostgREST 模式限制）
        await client.query(`INSERT INTO v2_friendships (user_id, friend_id) VALUES ($1, $2)`, [reqRow.from_user_id, reqRow.to_user_id]);
        await client.query(`INSERT INTO v2_friendships (user_id, friend_id) VALUES ($1, $2)`, [reqRow.to_user_id, reqRow.from_user_id]);
      }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 好友列表
router.get('/', authRequired, async (req, res, next) => {
  try {
    // 先查好友 ID，再查资料（替代 JOIN）
    const { rows: friendshipRows } = await query(
      `SELECT friend_id FROM v2_friendships WHERE user_id = $1`,
      [req.user.id]
    );
    const friendIds = friendshipRows.map((r) => r.friend_id);
    const friends = [];
    for (const fid of friendIds) {
      const { rows } = await query(
        `SELECT user_id, nickname, avatar_url FROM v2_profiles WHERE user_id = $1`,
        [fid]
      );
      if (rows[0]) friends.push(rows[0]);
    }
    friends.sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''));
    res.json({ ok: true, friends });
  } catch (e) { next(e); }
});

export default router;

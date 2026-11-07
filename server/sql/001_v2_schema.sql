-- 哦狐 v2 全新用户体系数据库结构
-- 执行前请勿在生产库直接运行；建议先在测试库验证。
-- 表名前缀 v2_，与旧系统物理隔离，旧数据不继承。

-- ===== 用户与认证 =====

CREATE TABLE IF NOT EXISTS v2_users (
  id                 UUID PRIMARY KEY,
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'suspended', 'deleted')),
  registration_epoch BIGINT NOT NULL,
  session_generation INTEGER NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2_phone_bindings (
  user_id        UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  phone          TEXT NOT NULL,
  password_hash  TEXT,
  verified_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, phone)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_phone ON v2_phone_bindings(phone);

CREATE TABLE IF NOT EXISTS v2_profiles (
  user_id     UUID PRIMARY KEY REFERENCES v2_users(id) ON DELETE CASCADE,
  nickname    TEXT,
  avatar_url  TEXT,
  bio         TEXT,
  school      TEXT,
  campus      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== 角色与权限 =====

CREATE TABLE IF NOT EXISTS v2_roles (
  id    UUID PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,        -- owner / admin / moderator / support
  name  TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS v2_role_grants (
  user_id     UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES v2_roles(id) ON DELETE CASCADE,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ,
  PRIMARY KEY (user_id, role_id)
);

-- ===== 好友关系 =====

CREATE TABLE IF NOT EXISTS v2_friend_requests (
  id           UUID PRIMARY KEY,
  from_user_id UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  to_user_id   UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  message      TEXT DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at   TIMESTAMPTZ,
  UNIQUE (from_user_id, to_user_id)
);

CREATE TABLE IF NOT EXISTS v2_friendships (
  user_id   UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, friend_id)
);

-- ===== 初始化角色 =====

INSERT INTO v2_roles (id, code, name, level) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner', '超级管理员', 100),
  ('00000000-0000-0000-0000-000000000002', 'admin', '管理员', 80),
  ('00000000-0000-0000-0000-000000000003', 'moderator', '版主', 50),
  ('00000000-0000-0000-0000-000000000004', 'support', '客服', 30)
ON CONFLICT (code) DO NOTHING;

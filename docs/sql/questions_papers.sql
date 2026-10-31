-- 英语题库 / 试卷（CloudBase / Postgres）
-- 在控制台执行一次即可；前端表不存在时会静默降级到本地存储。
-- 1.2.33：OP-C 一期（AI 出题入库 + 组卷答题）。

create table if not exists public.questions (
  id text primary key,
  uid text not null,
  subject text not null default '未分类',
  source text not null default 'paste',        -- paste | cet-seed | ai
  qtype text not null default 'single',       -- single | judge
  stem text not null,
  options text not null default '[]',          -- JSON string[]
  answer int not null default 0,              -- 单选：选项下标；判断：1 对 / 0 错
  explain text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.papers (
  id text primary key,
  uid text not null,
  title text not null,
  qids text not null default '[]',             -- JSON string[]，题目 id 顺序即卷面顺序
  best_score int,                              -- 历史最好成绩（分）
  best_total int,
  best_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_questions_uid on public.questions (uid, created_at desc);
create index if not exists idx_papers_uid on public.papers (uid, created_at desc);

-- RLS：仅本人读写（OP-E 真题等私有资料不外泄）
alter table public.questions enable row level security;
alter table public.papers enable row level security;

drop policy if exists questions_self on public.questions;
create policy questions_self on public.questions
  for all using (auth.uid()::text = uid) with check (auth.uid()::text = uid);

drop policy if exists papers_self on public.papers;
create policy papers_self on public.papers
  for all using (auth.uid()::text = uid) with check (auth.uid()::text = uid);

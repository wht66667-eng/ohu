-- 运维参考：pet_reward 白名单应对齐客户端 src/data/pet.ts
-- 请在云函数 / RPC 实现处加入下列 action（名称以现网函数为准）

-- secondhand_publish
-- task_publish
-- feedback_post
-- help_publish
-- help_done
-- teamup_publish
-- teamup_join
-- canteen_review
-- campus_checkin
-- focus_complete
-- wild_win          -- 建议日经验上限 40

-- 示意（若白名单存在于配置表）：
-- insert into pet_reward_actions(action, exp, coins, daily_cap_exp) values
--   ('wild_win', 8, 4, 40),
--   ('focus_complete', 15, 8, 30)
-- on conflict (action) do update set exp = excluded.exp;

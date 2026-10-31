-- 哦狐 PG 容量只读盘点。逐段执行；没有DDL、写入、业务记录或凭证输出。
-- 指标是累计值，不单独证明某一秒峰值；托管平台可能限制统计视图权限。
SELECT current_database() AS database_name,
       current_setting('max_connections') AS max_connections;

SELECT state, count(*) AS connection_count
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state;

SELECT schemaname, relname, n_live_tup, n_dead_tup, seq_scan, idx_scan,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('notifications', 'tasks', 'secondhand_items',
    'canteen_orders', 'shop_orders', 'shop_goods', 'shop_products',
    'shop_movements', 'shop_groups', 'wallet_ledger', 'withdraw_apps',
    'role_apps', 'chat_messages', 'plaza_messages', 'reports')
ORDER BY tablename, indexname;

SELECT relname AS table_name, indexrelname AS index_name,
       idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY relname, indexrelname;

SELECT relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(relid) DESC;

-- 另在测试库对真实查询做 EXPLAIN；不要对写入RPC或状态读取/回收函数
-- 使用 EXPLAIN ANALYZE，因其会实际执行。无需为每个字段盲目建立索引。

import cloudbase from '@cloudbase/node-sdk';
import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

const { Pool } = pg;

let pool = null;
let tcbApp = null;
let pgClient = null;

// 优先使用直连 PostgreSQL（本地开发或容器配置了 DATABASE_URL）
if (config.databaseUrl && !config.databaseUrl.includes('localhost')) {
  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (err) => logger.error('pg pool error', { message: err.message }));
  logger.info('using direct PostgreSQL connection');
} else {
  // CloudBase 云托管容器：通过 SDK 的 rdb 接口返回 PostgREST 客户端
  tcbApp = cloudbase.init({ env: config.cloudbaseEnvId });
  pgClient = tcbApp.rdb();
  logger.info('using CloudBase SDK rdb (PostgREST) client for PostgreSQL');
}

/**
 * 执行查询。
 * - pool 模式：直接执行 SQL
 * - rdb 模式：通过 PostgREST API 执行，支持简单的单表 SELECT / INSERT / UPDATE / DELETE
 */
export async function query(text, params) {
  const start = Date.now();
  try {
    if (pool) {
      const res = await pool.query(text, params);
      logger.debug('pg query', { text: text.slice(0, 80), rows: res.rowCount, ms: Date.now() - start });
      return res;
    }
    // PostgREST 模式：将简单 SQL 转为 API 调用
    const res = await _pgQueryViaRest(text, params);
    logger.debug('rdb query', { text: text.slice(0, 80), ms: Date.now() - start });
    return res;
  } catch (err) {
    logger.error('query failed', { message: err.message, detail: err.detail });
    throw err;
  }
}

export async function tx(fn) {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  // rdb 模式下不支持事务（单语句自动提交）
  return fn({ query: (t, p) => query(t, p) });
}

export async function closeDb() {
  if (pool) await pool.end();
}

// 解析 WHERE col = $1 AND col2 = $2 形式的条件
function _parseWhere(whereStr, params) {
  const conditions = [];
  // 按 AND 分割
  const parts = whereStr.split(/\s+AND\s+/i);
  for (const part of parts) {
    const m = part.match(/(\w+)\s*=\s*(.+)/);
    if (m) {
      const [, col, val] = m;
      let value;
      if (val.startsWith('$')) {
        value = params[parseInt(val.slice(1)) - 1];
      } else if (val.startsWith("'") && val.endsWith("'")) {
        value = val.slice(1, -1);
      } else {
        value = val;
      }
      conditions.push({ col, value });
    }
  }
  return conditions;
}

async function _pgQueryViaRest(text, params) {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  if (upper.startsWith('SELECT')) {
    return _selectViaRest(trimmed, params);
  }
  if (upper.startsWith('INSERT')) {
    return _insertViaRest(trimmed, params);
  }
  if (upper.startsWith('UPDATE')) {
    return _updateViaRest(trimmed, params);
  }
  if (upper.startsWith('DELETE')) {
    return _deleteViaRest(trimmed, params);
  }
  throw new Error(`不支持的 SQL 语句（PostgREST 模式）: ${trimmed.slice(0, 100)}`);
}

function _parseSelect(text) {
  // SELECT cols FROM table [WHERE ...] [LIMIT n]
  const m = text.match(/SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+LIMIT\s+(\d+))?$/i);
  if (!m) return null;
  const [, cols, table, where, limit] = m;
  return { cols: cols.trim(), table, where: where?.trim(), limit: limit ? parseInt(limit) : undefined };
}

async function _selectViaRest(text, params) {
  const parsed = _parseSelect(text);
  if (!parsed) throw new Error(`无法解析 SELECT: ${text.slice(0, 100)}`);
  const { table, where, limit } = parsed;

  let builder = pgClient.from(table).select('*');
  if (where) {
    const conditions = _parseWhere(where, params);
    for (const { col, value } of conditions) {
      builder = builder.eq(col, value);
    }
  }
  if (limit) {
    builder = builder.limit(limit);
  }
  const { data, error } = await builder;
  if (error) throw new Error(error.message || JSON.stringify(error));
  return { rows: data || [], rowCount: data?.length || 0 };
}

function _parseInsert(text) {
  // INSERT INTO table (cols) VALUES (vals)
  const m = text.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (!m) return null;
  const [, table, colsStr, valsStr] = m;
  const cols = colsStr.split(',').map((s) => s.trim());
  const vals = valsStr.split(',').map((s) => s.trim());
  return { table, cols, vals };
}

function _resolveValue(v, params) {
  if (v.startsWith('$')) {
    return params[parseInt(v.slice(1)) - 1];
  }
  const upper = v.toUpperCase();
  if (upper === 'NOW()') return new Date().toISOString();
  if (upper === "EXTRACT(EPOCH FROM NOW())") return Math.floor(Date.now() / 1000);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

async function _insertViaRest(text, params) {
  const parsed = _parseInsert(text);
  if (!parsed) throw new Error(`无法解析 INSERT: ${text.slice(0, 100)}`);
  const { table, cols, vals } = parsed;
  const data = {};
  cols.forEach((col, i) => {
    data[col] = _resolveValue(vals[i], params);
  });
  const { data: result, error } = await pgClient.from(table).insert(data).select();
  if (error) throw new Error(error.message || JSON.stringify(error));
  return { rows: result || [], rowCount: result?.length || 1 };
}

function _parseUpdate(text) {
  // UPDATE table SET col = $1, col2 = $2 WHERE ...
  const m = text.match(/UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)/i);
  if (!m) return null;
  const [, table, setStr, where] = m;
  // 解析 SET col = val, col2 = val2
  const setPairs = [];
  const setParts = setStr.split(',').map((s) => s.trim());
  for (const part of setParts) {
    const sm = part.match(/(\w+)\s*=\s*(.+)/);
    if (sm) {
      const [, col, val] = sm;
      setPairs.push({ col, val: val.trim() });
    }
  }
  return { table, setPairs, where: where.trim() };
}

async function _updateViaRest(text, params) {
  const parsed = _parseUpdate(text);
  if (!parsed) throw new Error(`无法解析 UPDATE: ${text.slice(0, 100)}`);
  const { table, setPairs, where } = parsed;

  const data = {};
  for (const { col, val } of setPairs) {
    data[col] = _resolveValue(val, params);
  }

  let builder = pgClient.from(table).update(data);
  const conditions = _parseWhere(where, params);
  for (const { col, value } of conditions) {
    builder = builder.eq(col, value);
  }
  const { data: result, error } = await builder.select();
  if (error) throw new Error(error.message || JSON.stringify(error));
  return { rows: result || [], rowCount: result?.length || 1 };
}

function _parseDelete(text) {
  const m = text.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+))?/i);
  if (!m) return null;
  const [, table, where] = m;
  return { table, where: where?.trim() };
}

async function _deleteViaRest(text, params) {
  const parsed = _parseDelete(text);
  if (!parsed) throw new Error(`无法解析 DELETE: ${text.slice(0, 100)}`);
  const { table, where } = parsed;

  let builder = pgClient.from(table).delete();
  if (where) {
    const conditions = _parseWhere(where, params);
    for (const { col, value } of conditions) {
      builder = builder.eq(col, value);
    }
  }
  const { data: result, error } = await builder.select();
  if (error) throw new Error(error.message || JSON.stringify(error));
  return { rows: result || [], rowCount: result?.length || 0 };
}

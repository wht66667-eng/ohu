const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = levels[process.env.LOG_LEVEL || 'info'];

function fmt(level, msg, meta) {
  const ts = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `[${ts}] ${level.toUpperCase()} ${msg}${metaStr}`;
}

export const logger = {
  debug: (msg, meta) => { if (levels.debug >= minLevel) console.debug(fmt('debug', msg, meta)); },
  info: (msg, meta) => { if (levels.info >= minLevel) console.info(fmt('info', msg, meta)); },
  warn: (msg, meta) => { if (levels.warn >= minLevel) console.warn(fmt('warn', msg, meta)); },
  error: (msg, meta) => { if (levels.error >= minLevel) console.error(fmt('error', msg, meta)); },
};

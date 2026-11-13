/* Minimal leveled logger (no dependencies). Writes ISO-timestamped lines. */
type Level = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, extra?: Record<string, unknown>) => void;
}

export function createLogger(minLevel: Level = 'info'): Logger {
  const threshold = RANK[minLevel];
  const emit = (level: Level, msg: string, extra?: Record<string, unknown>) => {
    if (RANK[level] < threshold) return;
    const line = extra && Object.keys(extra).length > 0 ? `${msg} ${JSON.stringify(extra)}` : msg;
    const ts = new Date().toISOString();
    if (level === 'error') console.error(`[${ts}] ${level.toUpperCase()} ${line}`);
    else if (level === 'warn') console.warn(`[${ts}] ${level.toUpperCase()} ${line}`);
    else console.log(`[${ts}] ${level.toUpperCase()} ${line}`);
  };
  return {
    debug: (m, x) => emit('debug', m, x),
    info: (m, x) => emit('info', m, x),
    warn: (m, x) => emit('warn', m, x),
    error: (m, x) => emit('error', m, x),
  };
}

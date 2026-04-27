/**
 * Logger
 *
 * MCP は stdio プロトコルなので `console.log` 禁止。
 * `console.error` または `process.stderr` 経由でしかログを出せない。
 *
 * 構造化ログ（JSON）を stderr に流す形にしておくと、CI / 監視で扱いやすい。
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogPayload {
  ts: string;
  level: LogLevel;
  scope: string;
  msg: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: Record<string, any>;
}

function emit(payload: LogPayload): void {
  // stderr に書く（stdio MCP プロトコルを汚染しない）
  process.stderr.write(JSON.stringify(payload) + '\n');
}

function makeLogger(level: LogLevel) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (scope: string, msg: string, meta?: Record<string, any>) => {
    emit({
      ts: new Date().toISOString(),
      level,
      scope,
      msg,
      ...(meta ? { meta } : {}),
    });
  };
}

export const logger = {
  debug: makeLogger('debug'),
  info: makeLogger('info'),
  warn: makeLogger('warn'),
  error: (scope: string, msg: string, err?: Error) => {
    emit({
      ts: new Date().toISOString(),
      level: 'error',
      scope,
      msg,
      ...(err
        ? {
            meta: {
              error: { name: err.name, message: err.message, stack: err.stack },
            },
          }
        : {}),
    });
  },
} as const;

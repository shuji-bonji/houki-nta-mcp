/**
 * Logger
 *
 * MCP は stdio プロトコルなので `console.log` 禁止。
 * `console.error` または `process.stderr` 経由でしかログを出せない。
 *
 * 構造化ログ（JSON）を stderr に流す形にしておくと、CI / 監視で扱いやすい。
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** JSON で書ける値。`meta` に入れたものがそのままの形で stderr に出ることを型で確かめる */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
/**
 * JSON のオブジェクト。`JSON.stringify` は `undefined` のプロパティを出力しないので、
 * プロパティには `undefined` も許す（配列の中の `undefined` は `null` に変わるので、配列には許さない）。
 *
 * `interface` で宣言した型はインデックスシグネチャを持たないため、そのままでは代入できない。
 * その場合は必要なフィールドを取り出して渡す。
 */
export type JsonObject = { [key: string]: JsonValue | undefined };

interface LogPayload {
  ts: string;
  level: LogLevel;
  scope: string;
  msg: string;
  meta?: JsonObject;
}

/**
 * `catch` で受け取った値（型は `unknown`）を、ログの `meta` に入れられる形にする。
 *
 * `Error` をそのまま `JSON.stringify` すると `{}` になる（`name` / `message` / `stack` は
 * 列挙されないプロパティのため）ので、必要なフィールドを取り出す。
 * `stack` は `logger.error` だけで出す。bulk download の fail-soft な警告で 1 件ごとに
 * スタックを出すとログが読めなくなるため。
 */
export function toMeta(err: unknown, options: { stack?: boolean } = {}): JsonObject {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      ...(options.stack && err.stack ? { stack: err.stack } : {}),
    };
  }
  return { value: String(err) };
}

function emit(payload: LogPayload): void {
  // stderr に書く（stdio MCP プロトコルを汚染しない）
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

function makeLogger(level: LogLevel) {
  return (scope: string, msg: string, meta?: JsonObject) => {
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
  /** `err` は `catch` で受け取った値をそのまま渡す（`Error` 以外も受け付ける） */
  error: (scope: string, msg: string, err?: unknown) => {
    emit({
      ts: new Date().toISOString(),
      level: 'error',
      scope,
      msg,
      ...(err !== undefined ? { meta: { error: toMeta(err, { stack: true }) } } : {}),
    });
  },
} as const;

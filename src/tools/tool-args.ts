/**
 * ツールの引数の型を inputSchema から導き、tools/call の受け口を unknown にする仕組み。
 *
 * MCP の tools/call は、ツール名を文字列で、引数を JSON で受け取る。コードの外から来る値なので、
 * 受け口の型は unknown にし、inputSchema で検証してから型を付ける。
 *
 * - 引数の型は `json-schema-to-ts` の `FromSchema` で inputSchema から導く（手書きの型と
 *   inputSchema がずれないようにする）
 * - 検証は SDK の `fromJsonSchema`（同じ inputSchema から作る）。検証を通った値にだけ型を当てる
 * - 型を当てる箇所は `bindTool()` の中の 1 か所だけ
 *
 * v0.13.0 までは server.ts の validateArgs() で検証し、handler 表は `(args: any) => …` だった。
 * houki-egov-mcp v0.6.0 の同名ファイルと同じ形（INVALID_ARGUMENT に `tool` を入れる点だけ違う）。
 */

import {
  fromJsonSchema,
  type JsonSchemaType,
  type StandardSchemaV1,
  type Tool,
} from '@modelcontextprotocol/server';
import type { FromSchema, JSONSchema } from 'json-schema-to-ts';
import { type LawServiceError, makeError } from '../errors.js';

/**
 * inputSchema から導いた引数の型。
 * `default` を持つ引数も省略可能のままにする（検証は default を埋めないため、handler 側で既定値を補う）。
 */
export type ArgsOf<S extends JSONSchema> = FromSchema<S, { keepDefaultedPropertiesOptional: true }>;

/** tools/call の受け口。引数はコードの外から来る JSON なので unknown で受ける */
export type ToolHandler = (args: unknown) => Promise<unknown>;

/** 1 つのツールの定義。inputSchema は型を導くため `as const` で書く */
export interface ToolSpec<S extends JSONSchema = JSONSchema> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: S;
}

/**
 * tools/list に出す形にする。
 *
 * `as const` の inputSchema は readonly の配列（`required` / `enum`）を持つので、SDK の `Tool` 型
 * （書き換え可能な配列）にはそのまま代入できない。値は同じ JSON なので、ここでだけ型を当てる。
 */
export function toMcpTool(spec: ToolSpec): Tool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema as unknown as Tool['inputSchema'],
  };
}

/**
 * ツールの定義と handler をつなぎ、引数を検証してから handler に渡す受け口を作る。
 * 検証に失敗したら family error contract の INVALID_ARGUMENT を返す（handler は呼ばない）。
 */
export function bindTool<T extends ToolSpec>(
  spec: T,
  handler: (args: NoInfer<ArgsOf<T['inputSchema']>>) => Promise<unknown>
): ToolHandler {
  const validator = fromJsonSchema(spec.inputSchema as unknown as JsonSchemaType);
  // 同じ inputSchema から作った validator を通った値だけを handler に渡すので、handler の引数の型
  // （inputSchema から導いた ArgsOf）は成り立つ。関数の中で ArgsOf<T['inputSchema']> を式に書くと、
  // 型引数 T のまま FromSchema を展開しようとして TS2589（型の展開が深すぎる）になるため、
  // 呼び出しの型だけを unknown で受ける形に置き換える
  const call = handler as unknown as ToolHandler;
  return async (raw) => {
    const result = await validator['~standard'].validate(raw ?? {});
    if (result.issues) return invalidArgument(spec, raw, result.issues);
    return call(result.value);
  };
}

/** 検証の問題を INVALID_ARGUMENT の LawServiceError にする */
function invalidArgument(
  spec: ToolSpec,
  raw: unknown,
  issues: ReadonlyArray<StandardSchemaV1.Issue>
): LawServiceError {
  const name = spec.name;
  // `additionalProperties: false` の違反は、既定バリデータの message（must NOT have additional properties）に
  // 引数名が入らないので、inputSchema の properties に無い引数名をここで数えて path に入れる
  const unknownArgs = listUnknownArgs(spec, raw);
  // fromJsonSchema の既定バリデータは path を持たず、message が `data/name must be string` 形式で来る。
  // 先頭の `data/` を剥がして path に、残りを message にする
  const detail = issues.map((i) => {
    const fromPath = (i.path ?? [])
      .map((seg) => (typeof seg === 'object' ? String(seg.key) : String(seg)))
      .join('.');
    const m = /^data(?:\/([^\s]+))?\s+(.*)$/.exec(i.message);
    const message = m ? m[2] : i.message;
    const isAdditional = /additional properties/.test(message);
    const path =
      fromPath ||
      (m?.[1] ?? '').replace(/\//g, '.') ||
      (isAdditional ? unknownArgs.join(', ') : '');
    return { path, message: isAdditional ? 'inputSchema に無い引数です' : message };
  });
  return makeError(
    'INVALID_ARGUMENT',
    `引数が tools/list の inputSchema に合いません: ${detail.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ')}`,
    {
      hint: `tools/list の ${name} の inputSchema を確認してください (型・必須・enum・未知の引数)`,
      next_actions: [
        { action: 'list_tools', reason: 'inputSchema で引数の型と必須項目を確認できます' },
      ],
      detail: { issues: detail },
      tool: name,
    }
  );
}

/** inputSchema の properties に無い引数名の一覧 */
function listUnknownArgs(spec: ToolSpec, raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  const schema = spec.inputSchema;
  const known =
    typeof schema === 'object' && schema !== null && 'properties' in schema && schema.properties
      ? Object.keys(schema.properties)
      : [];
  return Object.keys(raw).filter((k) => !known.includes(k));
}

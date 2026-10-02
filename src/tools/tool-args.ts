/**
 * ツールの引数の型を inputSchema から導き、tools/call の受け口を unknown にする仕組み。
 *
 * MCP の tools/call は、ツール名を文字列で、引数を JSON で受け取る。コードの外から来る値なので、
 * 受け口の型は unknown にし、inputSchema で検証してから型を付ける。
 *
 * - 引数の型は `json-schema-to-ts` の `FromSchema` で inputSchema から導く（手書きの型と
 *   inputSchema がずれないようにする）
 * - 検証は同じ inputSchema を読む `checkArgs()`（v0.22.0 で SDK の `fromJsonSchema` から置き換えた）。
 *   検証を通った値にだけ型を当てる
 * - 型を当てる箇所は `bindTool()` の中の 1 か所だけ
 *
 * v0.13.0 までは server.ts の validateArgs() で検証し、handler 表は `(args: any) => …` だった。
 * houki-egov-mcp v0.6.0 の同名ファイルと同じ形（INVALID_ARGUMENT に `tool` を入れる点だけ違う）。
 */

import type { Tool } from '@modelcontextprotocol/server';
import type { FromSchema, JSONSchema } from 'json-schema-to-ts';
import { type LawServiceError, makeError, type NextAction } from '../errors.js';

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
  // 検証を通った値だけを handler に渡すので、handler の引数の型（inputSchema から導いた ArgsOf）は
  // 成り立つ。関数の中で ArgsOf<T['inputSchema']> を式に書くと、型引数 T のまま FromSchema を
  // 展開しようとして TS2589（型の展開が深すぎる）になるため、呼び出しの型だけを unknown で受ける形に置き換える
  const call = handler as unknown as ToolHandler;
  return async (raw) => {
    const args = raw ?? {};
    const issues = checkArgs(spec.inputSchema, args);
    if (issues.length > 0) return invalidArgument(spec, issues);
    return call(args);
  };
}

/** 引数の検査の問題 1 件。path は引数名（入れ子なら `a.b`）、message は日本語の 1 文 */
export interface ArgIssue {
  path: string;
  message: string;
}

/** checkArgs が読む inputSchema の 1 つの引数 */
interface PropSchema {
  type?: string;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
}

/** 型の違反の message（SPEC-NTA-COMMON-ERRORS-011 の表） */
const TYPE_MESSAGES: Record<string, string> = {
  string: '文字列で指定してください',
  integer: '整数で指定してください',
  number: '数値で指定してください',
  boolean: 'true か false で指定してください',
  array: '配列で指定してください',
  object: 'オブジェクトで指定してください',
};

/** 値が JSON Schema の type に合うか */
function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

/** 1 つの引数の値を確かめ、最初の違反の message を返す（違反が無ければ undefined） */
function checkProp(prop: PropSchema, value: unknown): string | undefined {
  if (prop.type && !matchesType(prop.type, value)) return TYPE_MESSAGES[prop.type];
  if (prop.enum && !prop.enum.includes(value)) {
    return `${prop.enum.map((v) => String(v)).join('・')} のどれかで指定してください`;
  }
  if (typeof value === 'number') {
    if (prop.minimum !== undefined && value < prop.minimum) {
      return `${prop.minimum} 以上で指定してください`;
    }
    if (prop.maximum !== undefined && value > prop.maximum) {
      return `${prop.maximum} 以下で指定してください`;
    }
  }
  if (typeof value === 'string' && prop.minLength !== undefined && value.length < prop.minLength) {
    return '空文字は指定できません';
  }
  return undefined;
}

/**
 * 引数を inputSchema と突き合わせ、違反を 1 件ずつ返す（SPEC-NTA-COMMON-ERRORS-003・010・011）。
 *
 * - inputSchema の properties の順に、必須の引数が無いこと・型・enum・範囲・minLength を確かめる。
 *   1 つの引数につき最初の違反を 1 件にする
 * - その後に、properties に無い引数を渡した順に 1 件ずつ足す
 * - 既定値は埋めない（handler 側で補う）
 *
 * v0.21.3 までは SDK の `fromJsonSchema` の既定のバリデータを使っていた。違反が 2 つ以上あると 1 要素に
 * まとまり、message は検査の部品の英文（`data/limit must be number`）だったので、この関数に置き換えた。
 * このリポジトリの inputSchema は 1 段の object だけなので、入れ子は見ない。
 */
export function checkArgs(schema: JSONSchema, raw: unknown): ArgIssue[] {
  const s = (typeof schema === 'object' && schema !== null ? schema : {}) as {
    properties?: Record<string, PropSchema>;
    required?: readonly string[];
    additionalProperties?: boolean;
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [{ path: 'arguments', message: TYPE_MESSAGES.object }];
  }
  const args = raw as Record<string, unknown>;
  const props = s.properties ?? {};
  const required = s.required ?? [];
  const issues: ArgIssue[] = [];
  for (const [name, prop] of Object.entries(props)) {
    if (!Object.hasOwn(args, name) || args[name] === undefined) {
      if (required.includes(name)) issues.push({ path: name, message: '必須の引数です' });
      continue;
    }
    const message = checkProp(prop, args[name]);
    if (message) issues.push({ path: name, message });
  }
  if (s.additionalProperties === false) {
    for (const name of Object.keys(args)) {
      if (!Object.hasOwn(props, name)) {
        issues.push({ path: name, message: 'inputSchema に無い引数です' });
      }
    }
  }
  return issues;
}

/** 検証の問題を INVALID_ARGUMENT の LawServiceError にする（SPEC-NTA-COMMON-ERRORS-007） */
function invalidArgument(spec: ToolSpec, issues: ArgIssue[]): LawServiceError {
  const name = spec.name;
  return makeError(
    'INVALID_ARGUMENT',
    `引数が tools/list の inputSchema に合いません: ${issues.map((d) => `${d.path}: ${d.message}`).join('; ')}`,
    {
      hint: `tools/list の ${name} の inputSchema を確認してください (型・必須・enum・範囲・形式・未知の引数)`,
      next_actions: [
        { action: 'list_tools', reason: 'inputSchema で引数の型と必須項目を確認できます' },
      ],
      detail: { issues },
      tool: name,
    }
  );
}

/**
 * 必須の文字列の引数が空白だけのときのエラー（SPEC-NTA-COMMON-ERRORS-014）。
 * inputSchema の minLength では止まらないので、各ツールの処理が DB・国税庁サイト・略称辞書を引く前に返す。
 */
export function blankArgument(
  tool: string,
  path: string,
  hint: string,
  next_actions?: NextAction[]
): LawServiceError {
  return makeError('INVALID_ARGUMENT', `${path} が空です`, {
    hint,
    ...(next_actions ? { next_actions } : {}),
    detail: { issues: [{ path, message: '空白だけは指定できません' }] },
    tool,
  });
}

/**
 * 識別子の形が受け付ける形でないときのエラー（SPEC-NTA-COMMON-ERRORS-015）。
 * value は渡された値のまま error に入れる。
 */
export function badFormArgument(
  tool: string,
  path: string,
  value: string,
  message: string,
  hint: string
): LawServiceError {
  return makeError('INVALID_ARGUMENT', `${path} の形が受け付ける形ではありません: ${value}`, {
    hint,
    detail: { issues: [{ path, message }] },
    tool,
  });
}

/** 空白（半角・全角スペース、タブ、改行）だけの文字列か */
export function isBlank(value: string): boolean {
  return value.trim() === '';
}

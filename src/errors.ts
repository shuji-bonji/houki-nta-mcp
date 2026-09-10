/**
 * houki-hub family 共通エラー応答 — houki-nta-mcp 独自実装
 *
 * 設計指針:
 * - family contract に従いつつ、共通パッケージ依存を持たず独立に実装
 * - houki-egov-mcp の src/errors.ts をリファレンスとし、houki-nta-mcp 固有の
 *   情報 (resolved / available_clauses / available_doc_ids 等) を拡張する
 *
 * family contract 仕様:
 * @see https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-CODES.md
 * @see https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-HANDLING.md
 */

/**
 * family 共通エラーコード — houki-nta-mcp で使用する部分集合。
 * 全カテゴリの定義は ERROR-CODES.md (houki-research-skill) を参照。
 */
export type LawErrorCode =
  // 引数・入力 (クライアント責任)
  | 'INVALID_ARGUMENT'
  | 'OUT_OF_SCOPE'
  | 'UNKNOWN_TOOL'
  // リソース未発見
  | 'TSUTATSU_NOT_FOUND'
  | 'ARTICLE_NOT_FOUND'
  | 'ABBREVIATION_NOT_FOUND'
  | 'DOC_NOT_FOUND'
  // 外部ソース由来
  | 'SOURCE_API_ERROR'
  | 'SOURCE_TIMEOUT'
  | 'SOURCE_RATE_LIMITED'
  // システム
  | 'INTERNAL_ERROR';

/**
 * 次に取るべきアクションの提案。
 * LLM がこれを読んで自律的に次のツールを呼ぶことを想定。
 *
 * エラー応答だけでなく成功時の応答にも載せる（v0.11.0 / Issue #20: 通達の応答から
 * houki-egov-mcp の `get_law` へ誘導する）。houki-egov-mcp も `search_fulltext` の
 * `api-fallback` 応答（エラーではない）で `next_actions` を返しており、family の前例がある。
 */
export interface NextAction {
  /** 推奨アクション (tool 名 or 自然言語) */
  action: string;
  /** どんなときに有効か */
  reason: string;
  /** 具体的な引数例 (任意) */
  example?: Record<string, unknown>;
}

/**
 * family-compatible 共通エラー応答。
 * houki-nta-mcp 固有の追加フィールド (resolved / available_* / tool / url) も持つ。
 */
export interface LawServiceError {
  /** 1文の人間可読メッセージ (LLM もここを読む) */
  error: string;
  /** プログラム判定用の安定したコード */
  code: LawErrorCode;
  /** 追加情報 (任意) */
  hint?: string;
  /** LLM が次に呼ぶべき tool / 取るべき手段の候補 */
  next_actions?: NextAction[];
  /** 一時的エラーかどうか (true なら時間をおいて再試行可) */
  retryable?: boolean;
  /** 元のエラー詳細 (debug 用) */
  detail?: {
    status?: number;
    url?: string;
    cause?: string;
    /** INVALID_ARGUMENT: inputSchema 違反の一覧 (path は `a.b` 形式、未特定なら空文字) */
    issues?: Array<{ path: string; message: string }>;
  };
  /** houki-nta-mcp 固有: 略称解決結果 */
  resolved?: unknown;
  /** houki-nta-mcp 固有: DB 内に存在する clause 番号一覧 */
  available_clauses?: unknown;
  /** houki-nta-mcp 固有: DB 内に存在する docId 一覧 */
  available_doc_ids?: unknown;
  /** houki-nta-mcp 固有: ライブ取得 URL が登録されている通達名一覧 */
  supported_for_live?: unknown;
  /** houki-nta-mcp 固有: 発生した tool 名 */
  tool?: string;
  /** houki-nta-mcp 固有: 取得失敗時の URL */
  url?: string;
}

/**
 * エラーレスポンスを構築するヘルパー。
 */
export function makeError(
  code: LawErrorCode,
  message: string,
  options: {
    hint?: string;
    next_actions?: NextAction[];
    retryable?: boolean;
    detail?: LawServiceError['detail'];
    resolved?: unknown;
    available_clauses?: unknown;
    available_doc_ids?: unknown;
    supported_for_live?: unknown;
    tool?: string;
    url?: string;
  } = {}
): LawServiceError {
  const err: LawServiceError = { error: message, code };
  if (options.hint) err.hint = options.hint;
  if (options.next_actions && options.next_actions.length > 0) {
    err.next_actions = options.next_actions;
  }
  if (options.retryable !== undefined) err.retryable = options.retryable;
  if (options.detail) err.detail = options.detail;
  if (options.resolved !== undefined) err.resolved = options.resolved;
  if (options.available_clauses !== undefined) {
    err.available_clauses = options.available_clauses;
  }
  if (options.available_doc_ids !== undefined) {
    err.available_doc_ids = options.available_doc_ids;
  }
  if (options.supported_for_live !== undefined) {
    err.supported_for_live = options.supported_for_live;
  }
  if (options.tool) err.tool = options.tool;
  if (options.url) err.url = options.url;
  return err;
}

/** オブジェクトが LawServiceError かどうかの type guard */
export function isLawServiceError(value: unknown): value is LawServiceError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    'code' in value &&
    typeof (value as { error: unknown }).error === 'string' &&
    typeof (value as { code: unknown }).code === 'string'
  );
}

/**
 * よく使う next_actions のプリセット。
 * houki-nta-mcp 固有の tool 名 (nta_search_*) を含む。
 */
export const NEXT_ACTIONS = {
  resolveAbbreviation: (name: string): NextAction => ({
    action: 'resolve_abbreviation',
    reason: '略称辞書で正式名称と source_mcp_hint を確認できます',
    example: { name },
  }),
  searchTsutatsu: (keyword: string): NextAction => ({
    action: 'nta_search_tsutatsu',
    reason: 'キーワード検索で該当通達を探せます',
    example: { keyword },
  }),
  searchTaxAnswer: (keyword: string): NextAction => ({
    action: 'nta_search_tax_answer',
    reason: 'タックスアンサー検索で関連事例を探せます',
    example: { keyword },
  }),
  bulkDownload: (target?: string): NextAction => ({
    action: 'cli_bulk_download',
    reason: 'ローカル DB に未投入のため bulk download が必要',
    example: target
      ? { command: `houki-nta-mcp --bulk-download --tsutatsu="${target}"` }
      : { command: 'houki-nta-mcp --bulk-download' },
  }),
  retryLater: (): NextAction => ({
    action: 'retry_later',
    reason: '一時的な API/ネットワークエラーの可能性。30秒〜数分後に再試行してください',
  }),
  delegateTo: (mcpHint: string): NextAction => ({
    action: 'delegate_to_mcp',
    reason: `${mcpHint} の管轄リソースです。該当 MCP に切り替えてください`,
    example: { mcp: mcpHint },
  }),
  /** Issue #20: 通達が解釈している法律の本文を houki-egov-mcp で読むよう案内する（成功時の応答用） */
  readBaseLaw: (lawName: string): NextAction => ({
    action: 'delegate_to_mcp',
    reason: '通達は国民・裁判所を拘束しない。根拠は法律本文で確認する',
    example: { mcp: 'houki-egov', tool: 'get_law', law_name: lawName },
  }),
} as const;

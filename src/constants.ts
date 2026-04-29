/**
 * Shared Constants — houki-nta-mcp 固有
 *
 * 略称辞書系の定数（DOMAINS / Domain）は @shuji-bonji/houki-abbreviations
 * から re-export している。Single Source of Truth はそちら。
 */

// houki-abbreviations から共有定数を re-export
export { DOMAINS, CATEGORIES, SOURCE_MCP_HINTS } from '@shuji-bonji/houki-abbreviations';
export type { Domain, Category, SourceMcpHint } from '@shuji-bonji/houki-abbreviations';

/** このMCPが管轄する source_mcp_hint */
export const NTA_HINT = 'houki-nta' as const;

/** 国税庁サイトの基底 URL */
export const NTA_BASE_URLS = {
  root: 'https://www.nta.go.jp',
  /** 通達索引 */
  tsutatsu: 'https://www.nta.go.jp/law/tsutatsu/menu.htm',
  /** 質疑応答事例索引 */
  qaJirei: 'https://www.nta.go.jp/law/shitsugi/01.htm',
  /** タックスアンサー索引 */
  taxAnswer: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/index2.htm',
  /** 文書回答事例 */
  bunshoKaitou: 'https://www.nta.go.jp/about/organization/ntc/bunsyokaito/index.htm',
} as const;

/**
 * 法令解釈通達の本文ルート URL（trailing slash 必須）。
 *
 * houki-abbreviations 側は URL を持たないため、ここで通達 formal 名 → ルート URL を保持する。
 * 各通達の節ページは `${root}{章2桁}/{節2桁}.htm` で組み立てる（buildSectionUrl 参照）。
 *
 * Phase 1c では **消費税法基本通達のみ** 本実装。
 * 他の基本通達（所基通・法基通 等）は URL を実地確認した上で Phase 1d で追加する。
 */
export const TSUTATSU_URL_ROOTS: Readonly<Record<string, string>> = {
  消費税法基本通達: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/',
} as const;

/**
 * 通達の法的位置付け。`legal_status` フィールドとしてレスポンスに付与する。
 * 最高裁 昭和43.12.24（墓地埋葬法事件）の論理に基づく定義。
 */
export const TSUTATSU_LEGAL_STATUS = {
  binds_citizens: false,
  binds_courts: false,
  binds_tax_office: true,
  note: '通達は行政内部文書。納税者・裁判所には直接的拘束力なし。ただし税務署員は職務として守る義務あり（最高裁 昭和43.12.24）',
} as const;

/** このMCPが扱う category（houki-abbreviations の Category 型のサブセット） */
export const NTA_CATEGORIES = [
  'kihon-tsutatsu',
  'kobetsu-tsutatsu',
  'qa-jirei',
  'tax-answer',
] as const;
export type NtaCategory = (typeof NTA_CATEGORIES)[number];

/** 検索結果・取得件数の上限 */
export const LIMITS = {
  searchDefault: 10,
  searchMax: 50,
} as const;

/** 出力フォーマットの列挙 */
export const OUTPUT_FORMATS = ['markdown', 'json'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

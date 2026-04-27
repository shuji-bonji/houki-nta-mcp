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

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
 * ## スコープ制限（v0.1.x）
 *
 * v0.1.x では **消費税法基本通達のみ** 対応。他通達（所基通・法基通・相基通 等）は
 * Phase 1d の実地調査で **URL 規則と clause 番号体系が消基通と異なる** ことが判明し、
 * 単純な URL マッピング追加では対応できないため、Phase 2 (bulk DL + SQLite) で
 * 「TOC 事前 DL → clause→URL lookup table」を構築する形で一括対応する設計とした。
 *
 * 通達ごとの差異の概要:
 *   - 消基通: 3 階層 clause "1-4-13の2"（章-節-条）→ URL: `{root}{章}/{節}.htm` 直接組立可
 *   - 所基通: 2 階層 clause "2-4の2"（条-項）→ URL は `{root}{章}/{節}.htm` だが
 *             clause だけでは章/節を一意に特定できない（TOC lookup 必須）
 *   - 法基通: URL 規則が違う `{root}{章}/{章}_{節}.htm`
 *   - 相基通: URL 規則が違う `{root}{章}/00.htm` 等
 *
 * 詳細は docs/DESIGN.md の Phase 2 設計と docs/DATA-SOURCES.md の調査結果を参照。
 */
export const TSUTATSU_URL_ROOTS: Readonly<Record<string, string>> = {
  消費税法基本通達: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/',
  所得税基本通達: 'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/',
  法人税基本通達: 'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/',
  相続税法基本通達: 'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/',
} as const;

/**
 * 通達ごとの TOC ページ HTML スタイル。
 *
 * 通達ごとに TOC HTML 構造が異なるため、bulk-downloader 側で parser を切り替える必要がある。
 *
 *   - 'shohi'   : 消基通スタイル `<p><strong>第N章</strong></p>` + `<p class="indent2">第N節 <a></a></p>`
 *   - 'shotoku' : 所基通スタイル `<h2>第N編</h2>` / `<h3>第N章</h3>` + `<ul><li><a></a></li></ul>`
 *
 * 未登録の formal_name はデフォルトで 'shohi' として扱う（後方互換）。
 */
export type TsutatsuTocStyle = 'shohi' | 'shotoku' | 'hojin' | 'sozoku';
export const TSUTATSU_TOC_STYLES: Readonly<Record<string, TsutatsuTocStyle>> = {
  消費税法基本通達: 'shohi',
  所得税基本通達: 'shotoku',
  法人税基本通達: 'hojin',
  相続税法基本通達: 'sozoku',
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

/**
 * タックスアンサーのカテゴリ ベース URL。
 */
export const TAX_ANSWER_BASE_URL = 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/';

/**
 * タックスアンサー番号の先頭桁 → 税目フォルダのマッピング。
 *
 * 例: 6101 → "shohi" → /taxes/shiraberu/taxanswer/shohi/6101.htm
 *
 * 8xxx 帯は要追加調査（2026-05 時点で sake/8001 は 404）。Phase 2 で対応予定。
 */
export const TAX_ANSWER_FOLDER_MAP: Readonly<Record<string, string>> = {
  '1': 'shotoku', // 所得税
  '2': 'gensen', // 源泉徴収
  '3': 'joto', // 譲渡所得
  '4': 'sozoku', // 相続税・贈与税
  '5': 'hojin', // 法人税
  '6': 'shohi', // 消費税
  '7': 'inshi', // 印紙税
  '9': 'osirase', // お知らせ（税目横断）
} as const;

/**
 * タックスアンサー / 質疑応答事例の法的位置付け。
 * これらは行政の解説資料であり、通達よりさらに参考性が低い（拘束力ゼロ）。
 */
export const NTA_GENERAL_INFO_LEGAL_STATUS = {
  binds_citizens: false,
  binds_courts: false,
  binds_tax_office: false,
  note: 'タックスアンサー・質疑応答事例は国税庁の参考解説資料。法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある',
} as const;

/**
 * 質疑応答事例のベース URL。
 * 個別事例 URL は `${base}{税目}/{カテゴリ}/{事例番号}.htm` の形式。
 */
export const QA_BASE_URL = 'https://www.nta.go.jp/law/shitsugi/';

/**
 * 質疑応答事例の税目フォルダ一覧（DATA-SOURCES.md より、実地確認済み）。
 */
export const QA_TOPICS = [
  'shotoku', // 所得税
  'gensen', // 源泉所得税
  'joto', // 譲渡所得
  'sozoku', // 相続税・贈与税
  'hyoka', // 財産の評価
  'hojin', // 法人税
  'shohi', // 消費税
  'inshi', // 印紙税
  'hotei', // 法定調書
] as const;
export type QaTopic = (typeof QA_TOPICS)[number];

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

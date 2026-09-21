/**
 * MCP Tool Definitions — houki-nta-mcp
 *
 * 国税庁 6 大コンテンツ（基本通達 / 質疑応答事例 / タックスアンサー /
 * 改正通達 / 事務運営指針 / 文書回答事例）の検索・取得ツール定義。
 *
 * - search 系: SQLite FTS5（trigram）の全文検索。事前 bulk DL（CLI: `--bulk-download-*`）が前提
 * - get 系: DB lookup → 未投入時はライブ fetch（write-through cache）
 *
 * inputSchema は `as const` で書き、引数の型は `ArgsOf<typeof xxxTool.inputSchema>` で導く（v0.14.0）。
 * すべての inputSchema に `additionalProperties: false` を付け、未知の引数は INVALID_ARGUMENT にする。
 */

import type { Tool } from '@modelcontextprotocol/server';
import { DOMAINS, LIMITS, OUTPUT_FORMATS, QA_TOPICS } from '../constants.js';
import { type ToolSpec, toMcpTool } from './tool-args.js';

export const ntaSearchTsutatsuTool = {
  name: 'nta_search_tsutatsu',
  description:
    '国税庁の基本通達（消基通・所基通・法基通・相基通の 4 通達）を FTS5 でキーワード検索する。事前に `--bulk-download-all` で DB 投入が必要。結果に現れた通達ごとに、解釈の対象になる法律の対応表（base_laws_by_tsutatsu）と、houki-egov-mcp の get_law を案内する next_actions を付ける。',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description:
          '検索キーワード。例: "軽減税率", "電子帳簿", "棚卸資産"。略称も可（例: "電帳法"）。3 文字以上の語を推奨（FTS5 trigram のため）。2 文字の語は本文の部分一致で補完し、その旨を応答の search_notes に示す',
      },
      limit: {
        type: 'number',
        description: `取得件数（デフォルト: ${LIMITS.searchDefault}、最大: ${LIMITS.searchMax}）`,
        default: LIMITS.searchDefault,
      },
    },
    required: ['keyword'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const ntaGetTsutatsuTool = {
  name: 'nta_get_tsutatsu',
  description:
    '基本通達の本文を取得する。略称（消基通・所基通・法基通・相基通）対応、条項指定可能。DB 投入済（`--bulk-download-all`）の場合は DB から、未投入の場合はライブ fetch（結果は DB に書き戻し）。応答に解釈の対象になる法律（base_laws）を付け、next_actions で houki-egov-mcp の get_law を案内する。',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          '通達名または略称。例: "消費税法基本通達", "消基通", "所得税基本通達", "所基通"',
      },
      clause: {
        type: 'string',
        description: '通達番号。例: "5-1-9", "11-2-10"（章-項-号 形式）',
      },
      format: {
        type: 'string',
        enum: [...OUTPUT_FORMATS],
        description: '出力形式',
        default: 'markdown',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const ntaSearchQaTool = {
  name: 'nta_search_qa',
  description:
    '国税庁の質疑応答事例（9 税目: 所得税/源泉所得税/譲渡所得/相続税・贈与税/財産の評価/法人税/消費税/印紙税/法定調書）を FTS5 でキーワード検索する。事前に `--bulk-download-qa` で DB 投入が必要。この種別の文書が DB に 1 件も無いときはエラー DOC_NOT_FOUND を返す（キーワードに合わないだけの 0 件は results: [] で返す）。',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description:
          '検索キーワード。例: "社内会議 軽減税率", "テレワーク 必要経費"。3 文字以上の語を推奨（FTS5 trigram のため）。2 文字の語は本文の部分一致で補完し、その旨を応答の search_notes に示す',
      },
      domain: {
        type: 'string',
        enum: [...DOMAINS],
        description:
          '分野で絞り込み。質疑応答事例はすべて税務なので、"tax" は絞り込まず、それ以外は 0 件になる。税目で絞り込むときは topic を使う',
      },
      topic: {
        type: 'string',
        enum: [...QA_TOPICS],
        description:
          '税目で絞り込み。shotoku=所得税 / gensen=源泉所得税 / joto=譲渡所得 / sozoku=相続税・贈与税 / hyoka=財産の評価 / hojin=法人税 / shohi=消費税 / inshi=印紙税 / hotei=法定調書',
      },
      limit: {
        type: 'number',
        description: `取得件数（デフォルト: ${LIMITS.searchDefault}、最大: ${LIMITS.searchMax}）`,
        default: LIMITS.searchDefault,
      },
      hasPdf: {
        type: 'boolean',
        description:
          '添付 PDF の有無で絞り込む（true=PDF 付き / false=PDF 無し / 未指定=絞らない）。質疑応答事例は現状すべて HTML のみで PDF を持たないため true 指定時は空配列になる',
      },
    },
    required: ['keyword'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const ntaGetQaTool = {
  name: 'nta_get_qa',
  description:
    '国税庁の質疑応答事例 1 件を取得する。URL 形式: /law/shitsugi/{topic}/{category}/{id}.htm。format=json では【関係法令通達】を法令（related_laws）と通達（related_tsutatsu）に分け、next_actions で houki-egov-mcp の get_law と nta_get_tsutatsu を案内する。',
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        enum: ['shotoku', 'gensen', 'joto', 'sozoku', 'hyoka', 'hojin', 'shohi', 'inshi', 'hotei'],
        description:
          '税目フォルダ。shotoku=所得税, gensen=源泉所得税, joto=譲渡所得, sozoku=相続税・贈与税, hyoka=財産の評価, hojin=法人税, shohi=消費税, inshi=印紙税, hotei=法定調書',
      },
      category: {
        type: 'string',
        description:
          'カテゴリ番号（章相当）。例: "01", "02"。/law/shitsugi/{topic}/01.htm の TOC で確認できる',
      },
      id: {
        type: 'string',
        description: '事例番号。例: "19"',
      },
      format: {
        type: 'string',
        enum: [...OUTPUT_FORMATS],
        description: '出力形式',
        default: 'markdown',
      },
    },
    required: ['topic', 'category', 'id'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const ntaSearchTaxAnswerTool = {
  name: 'nta_search_tax_answer',
  description:
    'タックスアンサー（一般納税者向け解説、約 750 件）を FTS5 でキーワード検索する。事前に `--bulk-download-tax-answer` で DB 投入が必要。この種別の文書が DB に 1 件も無いときはエラー DOC_NOT_FOUND を返す（キーワードに合わないだけの 0 件は results: [] で返す）。',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description:
          '検索キーワード。例: "ふるさと納税", "医療費控除"。3 文字以上の語を推奨（FTS5 trigram のため）。2 文字の語は本文の部分一致で補完し、その旨を応答の search_notes に示す',
      },
      limit: {
        type: 'number',
        description: `取得件数（デフォルト: ${LIMITS.searchDefault}、最大: ${LIMITS.searchMax}）`,
        default: LIMITS.searchDefault,
      },
      hasPdf: {
        type: 'boolean',
        description:
          '添付 PDF の有無で絞り込む（true=PDF 付き / false=PDF 無し / 未指定=絞らない）。様式・別表系の説明など PDF 添付がある重要トピックを抽出したい時に true を指定',
      },
    },
    required: ['keyword'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const ntaGetTaxAnswerTool = {
  name: 'nta_get_tax_answer',
  description:
    '国税庁のタックスアンサー（よくある税の質問）本文を番号で取得する。番号の先頭桁から税目フォルダを自動判定。例: 6101 → 消費税の基本的なしくみ',
  inputSchema: {
    type: 'object',
    properties: {
      no: {
        type: 'string',
        description:
          'タックスアンサー番号。先頭桁で税目決定: 1xxx=所得税, 2xxx=源泉, 3xxx=譲渡, 4xxx=相続・贈与, 5xxx=法人税, 6xxx=消費税, 7xxx=印紙税, 9xxx=お知らせ。例: "6101", "1120"',
      },
      format: {
        type: 'string',
        enum: [...OUTPUT_FORMATS],
        description: '出力形式',
        default: 'markdown',
      },
    },
    required: ['no'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const ntaSearchKaiseiTsutatsuTool = {
  name: 'nta_search_kaisei_tsutatsu',
  description:
    '改正通達（一部改正通達）を FTS5 でキーワード検索する。事前に `--bulk-download-kaisei` で DB 投入が必要。この種別の文書が DB に 1 件も無いときはエラー DOC_NOT_FOUND を返す（キーワードに合わないだけの 0 件は results: [] で返す）。',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description:
          '検索キーワード。例: "電子帳簿", "インボイス", "軽減税率"。3 文字以上の語を推奨（FTS5 trigram のため）。2 文字の語は本文の部分一致で補完し、その旨を応答の search_notes に示す',
      },
      taxonomy: {
        type: 'string',
        description:
          '税目フォルダで絞り込み。"shohi" / "shotoku" / "hojin" / "sisan/sozoku" のいずれか',
      },
      limit: {
        type: 'number',
        description: `取得件数（デフォルト: ${LIMITS.searchDefault}、最大: ${LIMITS.searchMax}）`,
        default: LIMITS.searchDefault,
      },
      hasPdf: {
        type: 'boolean',
        description:
          '添付 PDF の有無で絞り込む（true=PDF 付き / false=PDF 無し / 未指定=絞らない）。改正通達は新旧対照表 PDF を持つことが多く、改正点だけ知りたい時は true 推奨',
      },
    },
    required: ['keyword'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const ntaGetKaiseiTsutatsuTool = {
  name: 'nta_get_kaisei_tsutatsu',
  description:
    '改正通達の本文を docId で取得する（DB 経由）。本文 + 添付 PDF URL（pdf-reader-mcp で読み取り推奨）を返す。',
  inputSchema: {
    type: 'object',
    properties: {
      docId: {
        type: 'string',
        description:
          '文書 ID。新形式 "0026003-067" または旧形式 "240401" 等。`nta_search_kaisei_tsutatsu` 結果や DB hint で取得',
      },
      format: {
        type: 'string',
        enum: [...OUTPUT_FORMATS],
        description: '出力形式',
        default: 'markdown',
      },
    },
    required: ['docId'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const ntaSearchJimuUneiTool = {
  name: 'nta_search_jimu_unei',
  description:
    '事務運営指針（jimu-unei）を FTS5 でキーワード検索する。事前に `--bulk-download-jimu-unei` で DB 投入が必要。この種別の文書が DB に 1 件も無いときはエラー DOC_NOT_FOUND を返す（キーワードに合わないだけの 0 件は results: [] で返す）。',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description:
          '検索キーワード。例: "書面添付", "重加算税"。3 文字以上の語を推奨（FTS5 trigram のため）。2 文字の語は本文の部分一致で補完し、その旨を応答の search_notes に示す',
      },
      taxonomy: {
        type: 'string',
        description: '税目で絞り込み。"shotoku" / "hojin" / "sozoku" / "shohi" 等',
      },
      limit: {
        type: 'number',
        description: `取得件数（デフォルト: ${LIMITS.searchDefault}、最大: ${LIMITS.searchMax}）`,
        default: LIMITS.searchDefault,
      },
      hasPdf: {
        type: 'boolean',
        description:
          '添付 PDF の有無で絞り込む（true=PDF 付き / false=PDF 無し / 未指定=絞らない）。別紙・別表 PDF を伴う指針だけを抽出したい時に true を指定',
      },
    },
    required: ['keyword'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const ntaGetJimuUneiTool = {
  name: 'nta_get_jimu_unei',
  description:
    '事務運営指針の本文を docId で取得する（DB 経由）。本文 + 添付 PDF URL（pdf-reader-mcp で読み取り推奨）を返す。',
  inputSchema: {
    type: 'object',
    properties: {
      docId: {
        type: 'string',
        description:
          '文書 ID。例: "shotoku/shinkoku/170331" / "sozoku/170111_1"。`nta_search_jimu_unei` 結果や DB hint で取得',
      },
      format: {
        type: 'string',
        enum: [...OUTPUT_FORMATS],
        description: '出力形式',
        default: 'markdown',
      },
    },
    required: ['docId'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const ntaSearchBunshokaitouTool = {
  name: 'nta_search_bunshokaitou',
  description:
    '文書回答事例（bunshokaitou）を FTS5 でキーワード検索する。事前に `--bulk-download-bunshokaitou` で DB 投入が必要。この種別の文書が DB に 1 件も無いときはエラー DOC_NOT_FOUND を返す（キーワードに合わないだけの 0 件は results: [] で返す）。',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description:
          '検索キーワード。例: "電子帳簿", "適格請求書", "災害損失"。3 文字以上の語を推奨（FTS5 trigram のため）。2 文字の語は本文の部分一致で補完し、その旨を応答の search_notes に示す',
      },
      taxonomy: {
        type: 'string',
        description:
          '税目で絞り込み。"shotoku" / "hojin" / "sozoku" / "gensen" / "joto-sanrin" / "shohi" 等（URL の税目フォルダ名）。国税局のページの別表記（"souzoku" / "gensenshotoku" / "joto_sanrin"）は、同じ税目としてまとめて検索する。DB にある値は、該当が無いときの応答の available_taxonomies で分かる',
      },
      limit: {
        type: 'number',
        description: `取得件数（デフォルト: ${LIMITS.searchDefault}、最大: ${LIMITS.searchMax}）`,
        default: LIMITS.searchDefault,
      },
      hasPdf: {
        type: 'boolean',
        description:
          '添付 PDF の有無で絞り込む（true=PDF 付き / false=PDF 無し / 未指定=絞らない）。回答書本文 PDF を持つ事例だけを抽出したい時に true を指定',
      },
    },
    required: ['keyword'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const ntaGetBunshokaitouTool = {
  name: 'nta_get_bunshokaitou',
  description:
    '文書回答事例の本文を docId で取得する（DB 経由）。本庁系は "shotoku/250416"、国税局系は "tokyo/shotoku/260218" のような形式。',
  inputSchema: {
    type: 'object',
    properties: {
      docId: {
        type: 'string',
        description: '文書 ID。例: "shotoku/250416" (本庁) / "tokyo/shotoku/260218" (東京国税局)',
      },
      format: {
        type: 'string',
        enum: [...OUTPUT_FORMATS],
        description: '出力形式',
        default: 'markdown',
      },
    },
    required: ['docId'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const ntaInspectPdfMetaTool = {
  name: 'nta_inspect_pdf_meta',
  description:
    '指定した文書の添付 PDF の一覧を返す。本文は読まない。各 PDF に kind（comparison=新旧対照表 / attachment=別紙・別表 / qa-pdf / related / notice / unknown）と、読み方（read_strategy: tables=表として取る / text=本文として読む / sample=先頭を見て決める、layout_note: 紙面の組み方）を付ける。save: true のときだけ PDF をサーバー側の保存先（既定は XDG_CACHE_HOME か ~/.cache の下の houki-nta-mcp/files/。環境変数 HOUKI_NTA_FILES_DIR で変更）に取得し、saved[] に絶対パスを返す。next_actions に pdf-reader-mcp の呼び出し例（保存済みなら extract_tables / read_text に file_path、未保存なら read_url に url）と、他の PDF 読み取りツール向けの汎用の 1 件を置く。読み手は固定しない。`nta_get_*` で全文を取得すると重い場合や、PDF だけを確認したい時に使う。',
  inputSchema: {
    type: 'object',
    properties: {
      docType: {
        type: 'string',
        enum: ['kaisei', 'jimu-unei', 'bunshokaitou', 'tax-answer'],
        description:
          '文書種別。改正通達 (kaisei) / 事務運営指針 (jimu-unei) / 文書回答事例 (bunshokaitou) / タックスアンサー (tax-answer)。質疑応答事例 (qa-jirei) は PDF を持たないため対象外',
      },
      docId: {
        type: 'string',
        description:
          '文書 ID。各 docType の `nta_search_*` 結果や `nta_get_*` のレスポンスから得られる',
      },
      kind: {
        type: 'string',
        enum: ['comparison', 'attachment', 'qa-pdf', 'related', 'notice', 'unknown'],
        description: 'この種別の PDF だけを返す。改正点だけ見たいときは comparison。省略すると全件',
      },
      save: {
        type: 'boolean',
        description:
          'true のとき、返す PDF をサーバー側の保存先に取得し、saved[] に絶対パスを返す。pdf-reader-mcp の extract_tables / read_text はローカルファイルしか読まないので、表として取るときに使う。既に保存済みなら再取得しない（saved[].cached が true）。既定 false',
      },
    },
    required: ['docType', 'docId'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

export const resolveAbbreviationTool = {
  name: 'resolve_abbreviation',
  description:
    '略称・通称から houki-abbreviations 経由でエントリを解決する。houki-nta-mcp 管轄外（法令系等）の場合は「他 MCP に誘導」のヒントを返す。',
  inputSchema: {
    type: 'object',
    properties: {
      abbr: {
        type: 'string',
        description: '略称。例: "消基通", "所基通", "電帳法"',
      },
    },
    required: ['abbr'],
    additionalProperties: false,
  },
} as const satisfies ToolSpec;

/** tools/list に出すツールの一覧（定義の順） */
export const tools: Tool[] = [
  ntaSearchTsutatsuTool,
  ntaGetTsutatsuTool,
  ntaSearchQaTool,
  ntaGetQaTool,
  ntaSearchTaxAnswerTool,
  ntaGetTaxAnswerTool,
  ntaSearchKaiseiTsutatsuTool,
  ntaGetKaiseiTsutatsuTool,
  ntaSearchJimuUneiTool,
  ntaGetJimuUneiTool,
  ntaSearchBunshokaitouTool,
  ntaGetBunshokaitouTool,
  ntaInspectPdfMetaTool,
  resolveAbbreviationTool,
].map(toMcpTool);

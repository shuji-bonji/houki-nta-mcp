/**
 * MCP Tool Definitions — houki-nta-mcp Phase 0 (スタブ)
 *
 * Phase 1 で本実装。現状はツール定義のみ存在し、ハンドラは
 * 「未実装」エラーを返すスタブ実装になっている。
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { DOMAINS, LIMITS, OUTPUT_FORMATS } from '../constants.js';

export const tools: Tool[] = [
  {
    name: 'nta_search_tsutatsu',
    description: '国税庁の通達（法令解釈通達・個別通達）をキーワード検索する。Phase 0 ではスタブ。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description:
            '検索キーワード。例: "軽減税率", "電子帳簿", "棚卸資産"。略称も可（例: "電帳法"）',
        },
        type: {
          type: 'string',
          enum: ['kihon-tsutatsu', 'kobetsu-tsutatsu'],
          description: '通達種別で絞り込み。kihon-tsutatsu=法令解釈通達, kobetsu-tsutatsu=個別通達',
        },
        domain: {
          type: 'string',
          enum: [...DOMAINS],
          description: '分野タグで絞り込み（略称辞書ベース）',
        },
        limit: {
          type: 'number',
          description: `取得件数（デフォルト: ${LIMITS.searchDefault}、最大: ${LIMITS.searchMax}）`,
          default: LIMITS.searchDefault,
        },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'nta_get_tsutatsu',
    description:
      '通達本文を取得する。略称（消基通・所基通・法基通 等）対応。条項指定可能。Phase 0 ではスタブ。',
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
    },
  },
  {
    name: 'nta_search_qa',
    description: '国税庁の質疑応答事例をキーワード検索する。Phase 0 ではスタブ。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '検索キーワード。例: "社内会議 軽減税率", "テレワーク 必要経費"',
        },
        domain: {
          type: 'string',
          enum: [...DOMAINS],
          description: '税目で絞り込み',
        },
        limit: {
          type: 'number',
          description: `取得件数（デフォルト: ${LIMITS.searchDefault}、最大: ${LIMITS.searchMax}）`,
          default: LIMITS.searchDefault,
        },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'nta_get_qa',
    description:
      '国税庁の質疑応答事例 1 件を取得する。URL 形式: /law/shitsugi/{topic}/{category}/{id}.htm',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: [
            'shotoku',
            'gensen',
            'joto',
            'sozoku',
            'hyoka',
            'hojin',
            'shohi',
            'inshi',
            'hotei',
          ],
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
    },
  },
  {
    name: 'nta_search_tax_answer',
    description: 'タックスアンサー（一般納税者向け解説）をキーワード検索する。Phase 0 ではスタブ。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '検索キーワード。例: "ふるさと納税", "医療費控除"',
        },
        limit: {
          type: 'number',
          description: `取得件数（デフォルト: ${LIMITS.searchDefault}、最大: ${LIMITS.searchMax}）`,
          default: LIMITS.searchDefault,
        },
      },
      required: ['keyword'],
    },
  },
  {
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
    },
  },
  {
    name: 'nta_search_kaisei_tsutatsu',
    description:
      '改正通達（一部改正通達）を FTS5 でキーワード検索する。事前に `--bulk-download-kaisei` で DB 投入が必要。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '検索キーワード。例: "電子帳簿", "インボイス", "軽減税率"',
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
      },
      required: ['keyword'],
    },
  },
  {
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
    },
  },
  {
    name: 'nta_search_jimu_unei',
    description:
      '事務運営指針（jimu-unei）を FTS5 でキーワード検索する。事前に `--bulk-download-jimu-unei` で DB 投入が必要。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '検索キーワード。例: "書面添付", "重加算税"',
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
      },
      required: ['keyword'],
    },
  },
  {
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
    },
  },
  {
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
    },
  },
];

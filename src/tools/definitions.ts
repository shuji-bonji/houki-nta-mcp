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
    description: '質疑応答事例の本文を取得する。Phase 0 ではスタブ。',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: {
          type: 'string',
          description: '事例タイトル or ID',
        },
        format: {
          type: 'string',
          enum: [...OUTPUT_FORMATS],
          description: '出力形式',
          default: 'markdown',
        },
      },
      required: ['identifier'],
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
    description: 'タックスアンサー本文を取得する。Phase 0 ではスタブ。',
    inputSchema: {
      type: 'object',
      properties: {
        no: {
          type: 'string',
          description: 'タックスアンサー番号。例: "6101", "1100"',
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

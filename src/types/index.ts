/**
 * Shared Types — houki-nta-mcp
 *
 * AbbreviationEntry は @shuji-bonji/houki-abbreviations から re-export。
 */

import type { Domain, OutputFormat, NtaCategory } from '../constants.js';

// houki-abbreviations から re-export
export type { AbbreviationEntry } from '@shuji-bonji/houki-abbreviations';

/** 通達検索引数 */
export interface SearchTsutatsuArgs {
  /** 検索キーワード */
  keyword: string;
  /** 通達種別で絞り込み */
  type?: Extract<NtaCategory, 'kihon-tsutatsu' | 'kobetsu-tsutatsu'>;
  /** 分野タグで絞り込み */
  domain?: Domain;
  /** 取得件数 */
  limit?: number;
}

/** 通達取得引数 */
export interface GetTsutatsuArgs {
  /** 通達名または略称。例: "消基通", "所基通" */
  name: string;
  /** 通達番号。例: "5-1-9", "11-2-10"（章-項-号 形式） */
  clause?: string;
  /** 出力形式 */
  format?: OutputFormat;
}

/** 質疑応答事例検索引数 */
export interface SearchQaArgs {
  /** 検索キーワード */
  keyword: string;
  /** 税目で絞り込み */
  domain?: Domain;
  /** 取得件数 */
  limit?: number;
}

/** 質疑応答事例取得引数 */
export interface GetQaArgs {
  /** タイトル or ID */
  identifier: string;
  /** 出力形式 */
  format?: OutputFormat;
}

/** タックスアンサー取得引数 */
export interface GetTaxAnswerArgs {
  /** タックスアンサー番号。例: "6101" */
  no: string;
  /** 出力形式 */
  format?: OutputFormat;
}

/** タックスアンサー検索引数 */
export interface SearchTaxAnswerArgs {
  /** 検索キーワード */
  keyword: string;
  /** 取得件数 */
  limit?: number;
}

/**
 * Shared Types — houki-nta-mcp
 *
 * AbbreviationEntry は @shuji-bonji/houki-abbreviations から re-export。
 */

import type {
  ntaGetBunshokaitouTool,
  ntaGetJimuUneiTool,
  ntaGetKaiseiTsutatsuTool,
  ntaGetQaTool,
  ntaGetTaxAnswerTool,
  ntaGetTsutatsuTool,
  ntaInspectPdfMetaTool,
  ntaSearchBunshokaitouTool,
  ntaSearchJimuUneiTool,
  ntaSearchKaiseiTsutatsuTool,
  ntaSearchQaTool,
  ntaSearchTaxAnswerTool,
  ntaSearchTsutatsuTool,
  resolveAbbreviationTool,
} from '../tools/definitions.js';
import type { ArgsOf } from '../tools/tool-args.js';

// houki-abbreviations から re-export
export type { AbbreviationEntry } from '@shuji-bonji/houki-abbreviations';

/**
 * ツールの引数の型（v0.14.0 から inputSchema から導く。手書きの interface はやめた）。
 * inputSchema は src/tools/definitions.ts。導き方は src/tools/tool-args.ts の `ArgsOf`。
 */

/** 基本通達の検索 */
export type SearchTsutatsuArgs = ArgsOf<typeof ntaSearchTsutatsuTool.inputSchema>;

/** 基本通達の取得 */
export type GetTsutatsuArgs = ArgsOf<typeof ntaGetTsutatsuTool.inputSchema>;

/** 質疑応答事例の検索 */
export type SearchQaArgs = ArgsOf<typeof ntaSearchQaTool.inputSchema>;

/** 質疑応答事例の取得 */
export type GetQaArgs = ArgsOf<typeof ntaGetQaTool.inputSchema>;

/** タックスアンサーの取得 */
export type GetTaxAnswerArgs = ArgsOf<typeof ntaGetTaxAnswerTool.inputSchema>;

/** タックスアンサーの検索 */
export type SearchTaxAnswerArgs = ArgsOf<typeof ntaSearchTaxAnswerTool.inputSchema>;

/** 改正通達の検索 */
export type SearchKaiseiTsutatsuArgs = ArgsOf<typeof ntaSearchKaiseiTsutatsuTool.inputSchema>;

/** 改正通達の取得 */
export type GetKaiseiTsutatsuArgs = ArgsOf<typeof ntaGetKaiseiTsutatsuTool.inputSchema>;

/** 事務運営指針の検索 */
export type SearchJimuUneiArgs = ArgsOf<typeof ntaSearchJimuUneiTool.inputSchema>;

/** 事務運営指針の取得 */
export type GetJimuUneiArgs = ArgsOf<typeof ntaGetJimuUneiTool.inputSchema>;

/** 文書回答事例の検索 */
export type SearchBunshokaitouArgs = ArgsOf<typeof ntaSearchBunshokaitouTool.inputSchema>;

/** 文書回答事例の取得 */
export type GetBunshokaitouArgs = ArgsOf<typeof ntaGetBunshokaitouTool.inputSchema>;

/** 添付 PDF のメタ情報 */
export type InspectPdfMetaArgs = ArgsOf<typeof ntaInspectPdfMetaTool.inputSchema>;

/** 略称の解決 */
export type ResolveAbbreviationArgs = ArgsOf<typeof resolveAbbreviationTool.inputSchema>;

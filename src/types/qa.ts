/**
 * QA (質疑応答事例) data model
 *
 * 国税庁の「質疑応答事例」1 件を表す。
 * URL 例: https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm
 *
 * 構造は h2 で「【照会要旨】」「【回答要旨】」「【関係法令通達】」の 3 セクションが標準。
 */

import type { QaTopic } from '../constants.js';

/** 質疑応答事例 1 件 */
export interface QaJirei {
  /** 税目フォルダ。例: "shohi" */
  topic: QaTopic;
  /** カテゴリ番号。例: "02"（章相当） */
  category: string;
  /** 事例番号。例: "19" */
  id: string;
  /** タイトル。例: "個人事業者が所有するゴルフ会員権の譲渡" */
  title: string;
  /** 【照会要旨】の段落配列 */
  question: string[];
  /** 【回答要旨】の段落配列 */
  answer: string[];
  /** 【関係法令通達】の段落配列（消基通 5-1-9 等の参照） */
  relatedLaws: string[];
  /** リクエスト URL */
  sourceUrl: string;
  /** 取得時刻 ISO 8601 */
  fetchedAt: string;
}

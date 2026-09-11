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
  /**
   * 【関係法令通達】の段落配列（消基通 5-1-9 等の参照）。
   * v0.12.0 からページ下部の「注記」を含まない（`notice` に分けた。Issue #22）
   */
  relatedLaws: string[];
  /**
   * ページ下部の「注記」の本文（v0.12.0、Issue #22）。作成時点と、一般的な回答であり
   * 具体的な取引に当てはめると異なる課税関係が生じうる旨の断り書き。無ければ省略
   */
  notice?: string;
  /** 注記の「令和7年8月1日現在の法令・通達等に基づいて作成」から取った作成の基準日（ISO 8601）。無ければ省略 */
  basisDate?: string;
  /** リクエスト URL */
  sourceUrl: string;
  /** 取得時刻 ISO 8601 */
  fetchedAt: string;
}

/**
 * Phase 3b: document テーブル系の型定義。
 *
 * 改正通達 / 事務運営指針 / 文書回答事例の共通型。`doc_type` で種別を区別。
 *
 * Phase 4-1-3 (v0.7.0): AttachedPdf に kind を追加。後方互換のため optional。
 */

import type { PdfKind } from '../services/pdf-meta.js';
import type { QaJirei } from './qa.js';
import type { TaxAnswer } from './tax-answer.js';

export type DocType = 'kaisei' | 'jimu-unei' | 'bunshokaitou' | 'tax-answer' | 'qa-jirei';

/**
 * PDF 添付の hint 情報。本文取得は pdf-reader-mcp に委譲。
 *
 * `kind` は Phase 4-1 (v0.7.0) で追加された分類フィールド。タイトルから
 * `extractPdfKind()` で自動推定する。後方互換のため optional とし、kind
 * が無い古いレコード（v0.6.0 までの bulk DL 結果）も無修正で読める。
 *
 * @see {@link ../services/pdf-meta.ts}
 */
export interface AttachedPdf {
  /** リンクテキスト。例: '別紙（PDF/470KB）' */
  title: string;
  /** 絶対 URL */
  url: string;
  /** タイトルから推測したファイルサイズ KB（取得できれば） */
  sizeKb?: number;
  /**
   * タイトルから自動分類した PDF 種別 (Phase 4-1, v0.7.0+)。
   * v0.6.0 以前に bulk DL されたレコードでは undefined になりうる。
   */
  kind?: PdfKind;
}

/**
 * `document.structured_json` に入れる、質疑応答事例の構造（Issue #29）。
 *
 * `sourceUrl` と `fetchedAt` は `document` の列を正とするため、ここには入れない。
 * DB から読むときに列の値を足して `QaJirei` に戻す。
 */
export type StoredQaStructure = Omit<QaJirei, 'sourceUrl' | 'fetchedAt'>;

/**
 * `document.structured_json` に入れる、タックスアンサーの構造（Issue #29）。
 *
 * `StoredQaStructure` と同じく `sourceUrl` / `fetchedAt` は持たない。
 */
export type StoredTaxAnswerStructure = Omit<TaxAnswer, 'sourceUrl' | 'fetchedAt'>;

/** `structured_json` に入る構造。`no` を持つかどうかでタックスアンサーと質疑応答事例を見分けられる */
export type StoredStructure = StoredQaStructure | StoredTaxAnswerStructure;

/** 改正通達 / 事務運営指針 / 文書回答事例の共通レコード */
export interface NtaDocument {
  /** 種別 */
  docType: DocType;
  /** 種別内ユニーク ID。例: '0026003-067' / '240401' / '170331' */
  docId: string;
  /** 税目フォルダ。例: 'shohi' / 'shotoku' / 'hojin' / 'sisan/sozoku' */
  taxonomy: string | undefined;
  /** タイトル */
  title: string;
  /** 発出日 (ISO YYYY-MM-DD)。取得失敗時は undefined */
  issuedAt: string | undefined;
  /** 宛先・発出者の文字列（複数行を改行 join） */
  issuer: string | undefined;
  /** 個別 HTML の URL */
  sourceUrl: string;
  /** ISO 8601 取得時刻 */
  fetchedAt: string;
  /** 本文（normalize 済み） */
  fullText: string;
  /** 添付 PDF のリスト */
  attachedPdfs: AttachedPdf[];
  /**
   * パーサが組み立てた構造（Issue #29、v0.16.0 から）。
   *
   * 質疑応答事例とタックスアンサーだけが持つ。`nta_get_qa` / `nta_get_tax_answer` が
   * DB から live と同じ形の応答を返すために使う。改正通達・事務運営指針・文書回答事例は
   * 本文が 1 続きの平文なので持たない。
   */
  structured?: StoredStructure;
}

/** 改正通達索引（kaisei_a.htm 等）のリンクエントリ */
export interface KaiseiIndexEntry {
  /** タイトル文字列。例: '消費税法基本通達の一部改正について（法令解釈通達）（令和8年4月1日）' */
  title: string;
  /** 個別改正通達ページの絶対 URL */
  url: string;
  /** タイトルから抽出した発出日 (ISO YYYY-MM-DD) — 抽出できれば */
  issuedAt: string | undefined;
}

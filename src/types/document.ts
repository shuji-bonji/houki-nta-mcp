/**
 * Phase 3b: document テーブル系の型定義。
 *
 * 改正通達 / 事務運営指針 / 文書回答事例の共通型。`doc_type` で種別を区別。
 */

export type DocType = 'kaisei' | 'jimu-unei' | 'bunshokaitou';

/** PDF 添付の hint 情報。本文取得は pdf-reader-mcp に委譲 */
export interface AttachedPdf {
  /** リンクテキスト。例: '別紙（PDF/470KB）' */
  title: string;
  /** 絶対 URL */
  url: string;
  /** タイトルから推測したファイルサイズ KB（取得できれば） */
  sizeKb?: number;
}

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

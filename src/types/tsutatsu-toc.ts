/**
 * Tsutatsu TOC (目次) data model
 *
 * 通達トップページ（消基通なら /law/tsutatsu/kihon/shohi/01.htm）から抽出した
 * 章 → 節 → 款 の階層構造を表す。
 */

/** 「款」エントリ（節の下位区分。第N章 第M節 のさらに第K款） */
export interface TsutatsuTocSubsection {
  /** 款番号。1〜N */
  number: number;
  /** タイトル。例: "個人事業者の家事消費等" */
  title: string;
  /**
   * セクションページ URL（`/law/tsutatsu/kihon/shohi/05/03/01.htm` のような款単位の URL）。
   * リンク欠落の場合は undefined（節タイトルだけ存在し、款の本文ページが無いケース）。
   */
  url?: string;
}

/** 「節」エントリ */
export interface TsutatsuTocSection {
  /** 節番号。1〜N */
  number: number;
  /** タイトル。例: "個人事業者の納税義務" */
  title: string;
  /** 節ページの URL。款で分かれている場合 undefined */
  url?: string;
  /** 款で分かれている節のみ持つ */
  subsections?: TsutatsuTocSubsection[];
}

/** 「章」エントリ */
export interface TsutatsuTocChapter {
  /** 章番号。1〜N */
  number: number;
  /** タイトル。例: "納税義務者" */
  title: string;
  /** 章配下の節 */
  sections: TsutatsuTocSection[];
}

/** 通達 TOC ページ全体 */
export interface TsutatsuToc {
  /** リクエスト URL */
  sourceUrl: string;
  /** 取得時刻 */
  fetchedAt: string;
  /** ページタイトル。例: "消費税法基本通達" */
  pageTitle: string;
  /** 章一覧 */
  chapters: TsutatsuTocChapter[];
}

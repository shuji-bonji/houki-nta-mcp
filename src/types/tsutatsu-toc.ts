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
  /**
   * houki-nta-mcp#54: この項目が属する、リンクの無い見出しの題。
   * 法人税基本通達の款のページでは、款が属する節の題（例: "第1節 収益等の計上に関する通則"）。
   * 国税庁サイトから条項を取るときに、番号の節に当たるページを選ぶために使う
   */
  parentTitle?: string;
  /**
   * houki-nta-mcp#54: 目次でこのページに結び付いている、条を示す題の一覧（目次の順、重複なし）。
   * 所得税基本通達では項目の題（「法第31条…関係」）と、「〔…〕」の項目が属する見出しの題
   * （「法第2条《定義》関係」）。相続税法基本通達では、このページを指す項目が属する見出しの題
   * （「第3条《…》関係」「第1条の3《…》及び第1条の4《…》共通関係」）。
   * 同じページを指す項目が複数あるとき（`#a-02` などの見出しへのリンク）も、全部の題を持つ。
   * 国税庁サイトから条項を取るときに、番号の条に当たるページを選ぶために使う
   */
  articleTitles?: string[];
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

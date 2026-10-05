/**
 * Tax Answer (タックスアンサー) data model
 *
 * 国税庁の「タックスアンサー（よくある税の質問）」記事 1 件を表す。
 * URL 例: https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6101.htm
 */

/**
 * タックスアンサーの 1 節（ページの h2 か h3 の見出し + 段落配列。SPEC-NTA-GET-TAX-ANSWER-019）。
 *
 * 節は入れ子にせず、ページの順に 1 つの配列に並ぶ。h3 の節の親は、配列の中でその前にある
 * 最も近い `level: 2` の節。
 */
export interface TaxAnswerSection {
  /** 見出しテキスト。例: "概要", "消費税の負担者", "申告・納付" */
  heading: string;
  /**
   * 節の本文の段落（plain text）。空になるのは、次の見出しが h3 の h2 の節
   * （例: No.1222 の「手続き」）だけ
   */
  paragraphs: string[];
  /** ページの見出しの段。h2 の節は 2、h3 の節は 3（0.25.1、#147） */
  level: 2 | 3;
}

/** タックスアンサー記事 1 件 */
export interface TaxAnswer {
  /** 記事番号。例: "6101" */
  no: string;
  /** タイトル。例: "消費税の基本的なしくみ" */
  title: string;
  /** 法令時点。例: "令和7年4月1日現在法令等"。無ければ undefined */
  effectiveDate?: string;
  /** 対象税目。例: "消費税"。無ければ undefined */
  taxCategory?: string;
  /** 節の配列（h2・h3 の見出しごとに分割し、ページの順に並べる。「対象税目」の節は含まない） */
  sections: TaxAnswerSection[];
  /** リクエスト URL */
  sourceUrl: string;
  /** 取得時刻 ISO 8601 */
  fetchedAt: string;
}

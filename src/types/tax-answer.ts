/**
 * Tax Answer (タックスアンサー) data model
 *
 * 国税庁の「タックスアンサー（よくある税の質問）」記事 1 件を表す。
 * URL 例: https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6101.htm
 */

/** タックスアンサーの 1 セクション（h2 見出し + 段落配列） */
export interface TaxAnswerSection {
  /** 見出しテキスト。例: "概要", "課税のしくみ", "申告・納付" */
  heading: string;
  /** セクション本文の段落（plain text） */
  paragraphs: string[];
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
  /** セクション配列（h2 単位で分割。「対象税目」セクションは含まない） */
  sections: TaxAnswerSection[];
  /** リクエスト URL */
  sourceUrl: string;
  /** 取得時刻 ISO 8601 */
  fetchedAt: string;
}

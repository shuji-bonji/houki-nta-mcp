/**
 * Tsutatsu (通達) parser data model
 *
 * 国税庁の通達セクションページ（例: 消基通 第1章 第1節）から抽出した
 * 章-項-号構造を表す。parser 層が `parseTsutatsuSection()` で組み立て、
 * handler 層が Markdown / JSON にレンダリングする。
 */

/** 段落のインデントレベル */
export type ParagraphIndent = 1 | 2 | 3;

/**
 * Issue #17 (v0.10.1): 段落に含まれていた画像（算式の GIF 等）。
 * 画像そのものは取得しないが、位置と alt テキストを失わないために残す。
 * 本文 `text` には `[画像: alt]` のプレースホルダが同じ位置に入る。
 */
export interface TsutatsuImage {
  /** `<img alt>`。無い場合は空文字 */
  alt: string;
  /** 画像 URL（sourceUrl 基準で絶対化済み） */
  src: string;
}

/** 1 つの段落（本文 1 行 / サブ項目 / 注 等） */
export interface TsutatsuParagraph {
  /**
   * インデントレベル
   *  - 1 = 本文（`<p class="indent1">`）
   *  - 2 = サブ項目 (1)(2) や (注) の親（`<p class="indent2">`）
   *  - 3 = サブのサブ（`<p class="indent3">`、または インライン `style="margin-left:..."` の段落）
   */
  indent: ParagraphIndent;
  /** プレーンテキスト。`<br>` は改行に正規化済み。画像は `[画像: alt]` に置換済み */
  text: string;
  /** Issue #17: この段落に含まれていた画像（無ければ省略） */
  images?: TsutatsuImage[];
}

/**
 * 1 つの「号」または「条」相当のまとまり。
 * 例: 1-4-1「納税義務が免除される課税期間」
 */
export interface TsutatsuClause {
  /**
   * 通達番号。ハイフンは ASCII に正規化済み。
   * 例: "1-1-1", "1-4-1", "1-4-13の2", "1-4-15の2"
   */
  clauseNumber: string;
  /** 見出しタイトル（カッコ抜き）。例: "個人事業者と給与所得者の区分" */
  title: string;
  /** 段落の配列（本文 + サブ項目 + 注） */
  paragraphs: TsutatsuParagraph[];
  /** 検索用の連結テキスト（タイトル + 全段落） */
  fullText: string;
}

/**
 * 1 つのセクションページ全体。
 */
export interface TsutatsuSection {
  /** リクエスト URL（一次情報源） */
  sourceUrl: string;
  /** 取得時刻 ISO 8601 */
  fetchedAt: string;
  /** ページの `<title>` タグ。例: "第1節　個人事業者の納税義務｜国税庁" */
  pageTitle: string;
  /** 章タイトル。例: "第1章　納税義務者"。ページに章見出しが無ければ undefined */
  chapterTitle?: string;
  /** 節タイトル。例: "第1節　個人事業者の納税義務" */
  sectionTitle: string;
  /** ページに含まれる全 clause */
  clauses: TsutatsuClause[];
}

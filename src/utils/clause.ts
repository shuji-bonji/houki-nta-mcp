/**
 * 通達番号 (clause number) のパースと URL 組み立てユーティリティ。
 *
 * 通達番号: "1-4-1" / "1-4-13の2" / "11-5-7" のような「章-節-条」形式。
 * セクションページ URL: `${root}{章2桁}/{節2桁}.htm`
 *
 * 例: 消基通 5-1-9
 *   parseClauseNumber("5-1-9") → { chapter: 5, section: 1, article: "9" }
 *   buildSectionUrl("https://www.nta.go.jp/law/tsutatsu/kihon/shohi/", 5, 1)
 *     → "https://www.nta.go.jp/law/tsutatsu/kihon/shohi/05/01.htm"
 */

/** 通達番号をパースした結果 */
export interface ParsedClauseNumber {
  /** 章番号（1〜13 程度） */
  chapter: number;
  /** 節番号（1〜13 程度） */
  section: number;
  /**
   * 条番号。"1", "13の2" のように「の」サフィックスを含む文字列のまま保持。
   * 数値化しない理由: "13の2" のような形式が壊れるため。
   */
  article: string;
}

/**
 * 通達番号文字列をパースする。半角ハイフン専用（全角ハイフンは事前に正規化されている前提）。
 *
 * - "1-4-1" → { chapter: 1, section: 4, article: "1" }
 * - "1-4-13の2" → { chapter: 1, section: 4, article: "13の2" }
 * - "11-5-7" → { chapter: 11, section: 5, article: "7" }
 * - 不正な形式（"5-1" 等）は null
 */
export function parseClauseNumber(s: string): ParsedClauseNumber | null {
  const m = s.trim().match(/^(\d+)-(\d+)-(\d+(?:の\d+)?)$/);
  if (!m) return null;
  return {
    chapter: parseInt(m[1], 10),
    section: parseInt(m[2], 10),
    article: m[3],
  };
}

/**
 * 章/節番号からセクションページ URL を組み立てる。
 *
 * - root URL は trailing slash 必須
 * - chapter / section は 1-99 を 2 桁ゼロパディング
 *
 * @example
 *   buildSectionUrl("https://www.nta.go.jp/law/tsutatsu/kihon/shohi/", 1, 4)
 *     // "https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm"
 */
export function buildSectionUrl(rootUrl: string, chapter: number, section: number): string {
  if (!rootUrl.endsWith('/')) {
    throw new Error(`buildSectionUrl: rootUrl must end with '/'. got: ${rootUrl}`);
  }
  if (chapter < 1 || section < 1) {
    throw new Error(`buildSectionUrl: chapter/section must be >= 1. got: ${chapter}/${section}`);
  }
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  return `${rootUrl}${pad2(chapter)}/${pad2(section)}.htm`;
}

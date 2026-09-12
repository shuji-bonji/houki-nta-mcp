/**
 * Text Normalization — 国税庁通達 HTML の全角ゆらぎを吸収する正規化レイヤー
 *
 * 国税庁の HTML は Shift_JIS 由来で、半角・全角の混在が多い:
 *   - 全角ハイフン `－` (U+FF0D) と ASCII `-` (U+002D) が同じ文書内に混在
 *   - 全角チルダ `～` (U+FF5E) と JIS WAVE DASH `〜` (U+301C) のゆらぎ
 *   - 全角数字 `０-９` (U+FF10-U+FF19) と半角数字
 *   - 全角英字 `Ａ-Ｚ` `ａ-ｚ` と半角英字（`ＮＩＳＡ` と `NISA` が同じ庁内で混在）
 *   - 全角スペース `　` (U+3000) と半角スペース・タブ
 *
 * このゆらぎを DB / FTS5 / 検索クエリの **すべてに同じ関数で適用** することで、
 * ユーザーが半角で打っても全角で打ってもヒットする「Normalize-everywhere」パターンを実現する。
 *
 * ## 実体は共通パッケージにある
 *
 * `normalizeJpText` / `normalizeSearchQuery` の実装は
 * [`@shuji-bonji/houki-abbreviations`](https://www.npmjs.com/package/@shuji-bonji/houki-abbreviations)
 * にあり、houki-hub family の MCP はすべてそれを通す。本ファイルはその再 export と、
 * houki-nta-mcp 固有の `normalizeClauseNumber` だけを持つ。
 *
 * v0.14.2 までは本ファイルに独自実装を置いていたが、共通実装と違って全角英字を
 * 半角にせず、`ＮＩＳＡ` と `NISA` で検索結果が分断されていた（Issue #27）。
 *
 * 適用箇所:
 *   - bulk-downloader: clause.title / full_text / paragraphs_json 投入時
 *   - db-search:        FTS5 検索クエリ受信時
 *   - tsutatsu-parser:  extractClauseNumber 内部（重複ロジックを集約）
 *
 * **触らないもの**:
 *   - 中黒 `・`: 「1の3・1の4共」のように意味のある区切り
 *   - 「共」「の」「条」「項」「章」「節」「款」: 意味のある日本語キーワード
 *   - 漢数字 (一二三): clause 番号には使われないが、本文には登場するので変換しない
 *   - 全角カナ・ひらがな: 検索の表記ゆれは別レイヤー（FTS5 trigram に任せる）
 */

import { normalizeJpText, normalizeSearchQuery } from '@shuji-bonji/houki-abbreviations';

export { normalizeJpText, normalizeSearchQuery };

/**
 * clause 番号文字列の正規化。`normalizeJpText` + 空白の全除去。
 *
 * 条番号に空白は現れないので、内部の空白も含めてすべて落とす。
 * houki-nta-mcp 固有の関心事なので共通パッケージには置かない。
 *
 * 例:
 *   - "1－4－13の2"      → "1-4-13の2"
 *   - "183～193共－1"    → "183~193共-1"
 *   - "1の3・1の4共－1"  → "1の3・1の4共-1"
 */
export function normalizeClauseNumber(s: string): string {
  return normalizeJpText(s).replace(/\s+/g, '');
}

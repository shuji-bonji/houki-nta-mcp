/**
 * Text Normalization — 国税庁通達 HTML の全角ゆらぎを吸収する正規化レイヤー
 *
 * 国税庁の通達 HTML は Shift_JIS 由来で、半角・全角の混在が多い:
 *   - 全角ハイフン `－` (U+FF0D) と ASCII `-` (U+002D) が同じ文書内に混在
 *   - 全角チルダ `～` (U+FF5E) と JIS WAVE DASH `〜` (U+301C) のゆらぎ
 *   - 全角数字 `０-９` (U+FF10-U+FF19) と半角数字
 *   - 全角スペース `　` (U+3000) と半角スペース・タブ
 *   - 中黒 `・` (U+30FB) は意味のある区切り文字なので残す
 *
 * このゆらぎを DB / FTS5 / 検索クエリの **すべてに同じ関数で適用** することで、
 * ユーザーが半角で打っても全角で打ってもヒットする「Normalize-everywhere」パターンを実現する。
 *
 * 適用箇所（v0.3.0-alpha.6 以降）:
 *   - bulk-downloader: clause.title / full_text / paragraphs_json 投入時
 *   - db-search:        FTS5 検索クエリ受信時
 *   - tsutatsu-parser:  extractClauseNumber 内部（重複ロジックを集約）
 *
 * **触らないもの**:
 *   - 中黒 `・`: 「1の3・1の4共」のように意味のある区切り
 *   - 「共」「の」「条」「項」「章」「節」「款」: 意味のある日本語キーワード
 *   - 漢数字 (一二三): clause 番号には使われないが、本文には登場するので変換しない
 *   - 全角カナ ・ ひらがな: 検索の表記ゆれは別レイヤー（FTS5 trigram に任せる）
 */

/**
 * 全角→半角の基本正規化。clause 番号・本文・検索クエリすべてに適用する。
 *
 * - 全角ハイフン `－` → ASCII `-`
 * - 全角チルダ `～` / JIS WAVE DASH `〜` → ASCII `~`
 * - 全角数字 `０-９` → 半角数字 `0-9`
 * - 全角スペース `　` → 半角スペース ` `
 * - タブ・改行は維持
 *
 * NB: 中黒 `・` (U+30FB) は意味のある区切りなので残す。
 *     「1の3・1の4共-1」のような複数条共通通達を判別できなくなるため。
 */
export function normalizeJpText(s: string): string {
  return s
    .replace(/－/g, '-')
    .replace(/[～〜]/g, '~')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

/**
 * clause 番号文字列の正規化。`normalizeJpText` のサブセット + 内部空白除去。
 *
 * 例:
 *   - "1－4－13の2"      → "1-4-13の2"
 *   - "183～193共－1"    → "183~193共-1"
 *   - "1の3・1の4共－1"  → "1の3・1の4共-1"
 */
export function normalizeClauseNumber(s: string): string {
  return normalizeJpText(s).replace(/\s+/g, '');
}

/**
 * 検索クエリ用の正規化。`normalizeJpText` + 連続空白を 1 つに圧縮 + 前後 trim。
 *
 * FTS5 trigram は文字列バイト一致なので、DB 側と検索側の両方で同じ関数を通すことが重要。
 */
export function normalizeSearchQuery(s: string): string {
  return normalizeJpText(s).replace(/\s+/g, ' ').trim();
}

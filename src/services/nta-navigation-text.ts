/**
 * NTA Navigation Text — 国税庁サイトの案内文を本文から除くための判定
 */

/**
 * 国税庁サイトの案内文（ページの間を移動するためのリンクの文言）かどうか。
 * 本文の <p> に混ざるが、国税庁の見解ではないので fullText に入れない（Issue #45）。
 * 文書回答事例・改正通達・事務運営指針の parser と、DB の移行（schema v8 / v9）で使う。
 *
 *   - 本庁系の別紙 (another.htm) の末尾にある、index.htm へ戻るリンク
 *     `<p class="right"><a href="…/index.htm">←上記照会の内容に対する回答はこちら</a></p>`
 *     国税局系 (tokyo/shohi/251017 の 01.htm) にも同じ文言があるが、そちらは #bodyArea の外に
 *     置かれていて、もともと本文に入らない
 *   - サイト共通の PDF の案内
 *     `<p>※<a href="/taxes/tetsuzuki/…">PDFファイルが開けない、印刷できないなどの場合はこちらをご覧ください。</a></p>`
 *     文書回答事例では 2008 年の 081102 の別紙のように `#bodyArea` の中の `#cntPDFarea` に、
 *     改正通達・事務運営指針では本文の直後に置かれている（0026003-067 / 170331）
 *
 * 「←」「→」で始まる行と、「…はこちら」「…こちらをご覧ください」で終わる行を案内文とみなす。
 */
export function isNtaNavigationText(text: string): boolean {
  const t = text.trim();
  if (t === '') return false;
  if (/^[←→]/.test(t)) return true;
  if (/はこちら[。．]?$/.test(t)) return true;
  if (/こちらをご覧ください[。．]?$/.test(t)) return true;
  return false;
}

/**
 * 保存済みの fullText から案内文の行を除く。DB に入っている本文を、再ダウンロードせずに
 * 各 parser の今の出力と同じにするために使う（schema v7 → v8、v8 → v9 の移行）。
 * 案内文の行を落とすだけなので、今の parser を通した本文に掛けても何も変わらない（冪等）。
 */
export function stripNtaNavigationLines(fullText: string): string {
  return fullText
    .split('\n')
    .filter((line) => !isNtaNavigationText(line))
    .join('\n');
}

/**
 * Tax Answer Parser — 国税庁タックスアンサーページの cheerio パーサ
 *
 * 入力: `nta-scraper.ts` がデコードした HTML（UTF-8 のページが多い）
 * 出力: `TaxAnswer` 構造体
 *
 * 想定する HTML 構造:
 *   <div class="imp-cnt" id="bodyArea">  ← 通達と違い "imp-cnt-tsutatsu" ではなく "imp-cnt"
 *     <ol class="breadcrumb">...</ol>
 *     <div class="page-header"><h1>No.6101 消費税の基本的なしくみ</h1></div>
 *     <p>[令和7年4月1日現在法令等]</p>
 *     <h2>対象税目</h2>
 *     <p>消費税</p>
 *     <h2>概要</h2>
 *     <p>消費税は…</p>
 *     <h3>消費税の負担者</h3>          ← 小見出し。h2 と同じく本文の直下の兄弟（#147）
 *     <p>...</p>
 *     <h3>課税のしくみ</h3>
 *     <p>...</p>
 *     <h2>手続き</h2>                  ← 直後に段落が無く、すぐ h3 が続く h2 もある
 *     <h3>申告等の方法</h3>
 *     <p>...</p>
 *     ...
 *
 * 節（`sections`）は h2 と h3 の見出しごとに切り、1 つの配列にページの順で並べる。
 * 各節の `level` は h2 なら 2、h3 なら 3（SPEC-NTA-GET-TAX-ANSWER-019）。
 */

import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

import type { TaxAnswer, TaxAnswerSection } from '../types/tax-answer.js';
import { normalizeJpText } from './text-normalize.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

/**
 * タックスアンサーページをパースして `TaxAnswer` を組み立てる。
 *
 * @param html  デコード済み HTML 文字列
 * @param sourceUrl リクエスト URL
 * @param fetchedAt ISO 8601 時刻。未指定なら `new Date().toISOString()`
 */
export function parseTaxAnswer(
  html: string,
  sourceUrl: string,
  fetchedAt: string = new Date().toISOString()
): TaxAnswer {
  const $ = cheerio.load(html);
  $('br').replaceWith('\n');

  // タックスアンサーは "imp-cnt" だが、フォールバックで #bodyArea も見る
  const $body =
    $('div.imp-cnt#bodyArea').first().length > 0
      ? $('div.imp-cnt#bodyArea').first()
      : $('#bodyArea').first();

  if ($body.length === 0) {
    throw new TsutatsuParseError(
      'タックスアンサー本体 (div.imp-cnt#bodyArea) が見つかりません',
      sourceUrl
    );
  }

  // ノイズ要素を除去
  $body.find('ol.breadcrumb, .page-top-link, .contents-feedback, .surbey-link').remove();

  // タイトル: <div class="page-header"><h1>No.6101 消費税の基本的なしくみ</h1></div>
  const h1Text = cleanText($body.find('.page-header h1').first().text());
  const titleMatch = h1Text.match(/^No\.\s*(\d+)\s*(.*)$/);
  const no = titleMatch ? titleMatch[1] : '';
  const title = titleMatch ? titleMatch[2].trim() : h1Text;

  // 法令時点: <p>[令和7年4月1日現在法令等]</p>（page-header 直後の最初の p）
  let effectiveDate: string | undefined;
  const $firstP = $body.find('.page-header').first().nextAll('p').first();
  if ($firstP.length > 0) {
    const t = cleanText($firstP.text());
    const m = t.match(/^\[(.+)\]$/);
    if (m) effectiveDate = m[1];
  }

  // h2・h3 の見出しごとに分割（SPEC-NTA-GET-TAX-ANSWER-019）
  const allSections = extractSections($, $body);

  // 「対象税目」セクションは taxCategory に持っていく
  let taxCategory: string | undefined;
  const sections: TaxAnswerSection[] = [];
  for (const sec of allSections) {
    if (sec.heading === '対象税目') {
      // 「対象税目」は段落が無くても（直後に h3 が続いても）節にしない（SPEC-NTA-GET-TAX-ANSWER-019）
      if (sec.paragraphs.length > 0) taxCategory = sec.paragraphs[0];
      continue; // sections には入れない
    }
    sections.push(sec);
  }

  const result: TaxAnswer = {
    no,
    title,
    sections,
    sourceUrl,
    fetchedAt,
  };
  if (effectiveDate) result.effectiveDate = effectiveDate;
  if (taxCategory) result.taxCategory = taxCategory;
  return result;
}

/** 節を切る見出しの要素名と `level` の対応（SPEC-NTA-GET-TAX-ANSWER-019） */
const SECTION_HEADING_LEVEL: Record<string, TaxAnswerSection['level']> = { h2: 2, h3: 3 };

/** 節にしない見出し（ページの下の「サイトマップ」「お問い合わせ先」）。h2 にも h3 にも効かせる */
function isExcludedHeading(heading: string): boolean {
  return heading.startsWith('サイトマップ') || heading.startsWith('お問い合わせ先');
}

/**
 * 本文の h2 と h3 の見出しごとに節を切る（SPEC-NTA-GET-TAX-ANSWER-019）。
 *
 * - 節の段落は、その見出しの次の兄弟要素から、次の h2 か h3 の前までの `p`・`div`・`li` の文字列
 * - 節はページの順に 1 つの配列に並べ、入れ子にしない。`level` は h2 が 2、h3 が 3。
 *   h3 の節の親は、配列の中でその前にある最も近い `level: 2` の節
 * - 段落が 0 件の節は作らない。ただし h2 の次の見出しが h3 のときは、h2 の見出しを残すために
 *   `paragraphs: []` で作る
 * - 「サイトマップ」「お問い合わせ先」で始まる見出しは h2 でも h3 でも節にしない。h4 以下は区切りにも段落にもしない
 */
function extractSections($: CheerioAPI, $body: cheerio.Cheerio<Element>): TaxAnswerSection[] {
  const sections: TaxAnswerSection[] = [];

  $body.find('h2, h3').each((_, headingEl) => {
    const level = SECTION_HEADING_LEVEL[headingEl.tagName];
    const heading = cleanText($(headingEl).text());
    if (!heading) return;
    if (isExcludedHeading(heading)) return;

    const paragraphs: string[] = [];
    let nextHeadingTag: string | undefined;
    let node = headingEl.nextSibling;
    while (node) {
      if (node.type === 'tag') {
        const el = node as Element;
        if (Object.hasOwn(SECTION_HEADING_LEVEL, el.tagName)) {
          nextHeadingTag = el.tagName;
          break;
        }
        if (el.tagName === 'p' || el.tagName === 'div' || el.tagName === 'li') {
          const text = cleanText($(el).text());
          if (text) paragraphs.push(text);
        }
      }
      node = node.nextSibling;
    }

    if (paragraphs.length > 0) {
      sections.push({ heading, paragraphs, level });
    } else if (level === 2 && nextHeadingTag === 'h3') {
      // h2 の直後にすぐ小見出しが続く節（「手続き」「計算方法・計算式」など）は、見出しを残すために空で作る
      sections.push({ heading, paragraphs: [], level });
    }
  });

  return sections;
}

function cleanText(s: string): string {
  return s
    .replace(/　/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * DB の `full_text` に入れる平文を組み立てる（Issue #29）。
 *
 * `--bulk-download-tax-answer` と `nta_get_tax_answer` の書き戻しで同じ文字列を作るために
 * 共有する。ここが分かれると、取得ツールが書いた行を次の bulk download が
 * 「内容が変わった」と判定してしまう。
 */
export function buildTaxAnswerFullText(ta: TaxAnswer): string {
  return normalizeJpText(
    [
      ta.title,
      ta.effectiveDate ? `[${ta.effectiveDate}]` : '',
      ta.taxCategory ? `税目: ${ta.taxCategory}` : '',
      ...ta.sections.map((s) => `【${s.heading}】\n${s.paragraphs.join('\n')}`),
    ]
      .filter(Boolean)
      .join('\n\n')
  );
}

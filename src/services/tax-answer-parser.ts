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
 *     <h2>課税のしくみ</h2>
 *     <p>...</p>
 *     ...
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import type { TaxAnswer, TaxAnswerSection } from '../types/tax-answer.js';
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

  // h2 ごとに分割
  const allSections = extractSections($, $body);

  // 「対象税目」セクションは taxCategory に持っていく
  let taxCategory: string | undefined;
  const sections: TaxAnswerSection[] = [];
  for (const sec of allSections) {
    if (sec.heading === '対象税目' && sec.paragraphs.length > 0) {
      taxCategory = sec.paragraphs[0];
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

/**
 * h2 ごとにセクションを切る。
 * h2 の次の h2 に至るまでの p をすべて当該セクションの paragraphs に集める。
 */
function extractSections($: CheerioAPI, $body: cheerio.Cheerio<Element>): TaxAnswerSection[] {
  const sections: TaxAnswerSection[] = [];

  $body.find('h2').each((_, h2) => {
    const heading = cleanText($(h2).text());
    if (!heading) return;
    // ノイズ的な見出し（footer の「サイトマップ」など）は除外
    if (heading.startsWith('サイトマップ')) return;
    if (heading.startsWith('お問い合わせ先')) return;

    const paragraphs: string[] = [];
    let node = h2.nextSibling;
    while (node) {
      if (node.type === 'tag') {
        const el = node as Element;
        if (el.tagName === 'h2') break;
        if (el.tagName === 'p' || el.tagName === 'div' || el.tagName === 'li') {
          const text = cleanText($(el).text());
          if (text) paragraphs.push(text);
        }
      }
      node = node.nextSibling;
    }

    if (paragraphs.length > 0) {
      sections.push({ heading, paragraphs });
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

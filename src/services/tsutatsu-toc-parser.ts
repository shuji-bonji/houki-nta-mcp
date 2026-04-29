/**
 * Tsutatsu TOC Parser — 通達 TOC ページの cheerio パーサ
 *
 * 入力例: `/law/tsutatsu/kihon/shohi/01.htm`（消基通の目次）
 *
 * 観察される HTML 構造:
 *   <div class="imp-cnt-tsutatsu" id="bodyArea">
 *     <h1>消費税法基本通達</h1>
 *     <p><strong>第1章　納税義務者</strong></p>
 *     <p class="indent2">第1節　<a href="/law/tsutatsu/kihon/shohi/01/01.htm">個人事業者の納税義務</a></p>
 *     <p class="indent2">第2節　<a href="...">法人の納税義務</a></p>
 *     ...
 *     <p><strong>第5章　課税範囲</strong></p>
 *     <p class="indent2">第3節　みなし譲渡</p>   (← URL 無し、款で分かれている)
 *     <p class="indent3">第1款　<a href="...">個人事業者の家事消費等</a></p>
 *     <p class="indent3">第2款　<a href="...">役員に対するみなし譲渡</a></p>
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import type {
  TsutatsuToc,
  TsutatsuTocChapter,
  TsutatsuTocSection,
  TsutatsuTocSubsection,
} from '../types/tsutatsu-toc.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

/**
 * 通達 TOC ページをパースする。
 *
 * @param html  デコード済み HTML 文字列
 * @param sourceUrl リクエスト URL（href の相対 URL を絶対化するためにも使う）
 * @param fetchedAt ISO 8601 時刻
 */
export function parseTsutatsuToc(
  html: string,
  sourceUrl: string,
  fetchedAt: string = new Date().toISOString()
): TsutatsuToc {
  const $ = cheerio.load(html);
  const $body =
    $('div.imp-cnt-tsutatsu#bodyArea').first().length > 0
      ? $('div.imp-cnt-tsutatsu#bodyArea').first()
      : $('#bodyArea').first();

  if ($body.length === 0) {
    throw new TsutatsuParseError(
      '通達本体 (div.imp-cnt-tsutatsu#bodyArea) が見つかりません',
      sourceUrl
    );
  }

  $body.find('ol.breadcrumb, .page-top-link').remove();

  const pageTitle =
    cleanText($body.find('.page-header h1').first().text()) ||
    cleanText($body.find('h1').first().text()) ||
    cleanText($('title').first().text()).replace(/｜国税庁$/, '');

  const chapters = extractChapters($, $body, sourceUrl);

  return {
    sourceUrl,
    fetchedAt,
    pageTitle,
    chapters,
  };
}

/* -------------------------------------------------------------------------- */

function extractChapters(
  $: CheerioAPI,
  $body: cheerio.Cheerio<Element>,
  sourceUrl: string
): TsutatsuTocChapter[] {
  const chapters: TsutatsuTocChapter[] = [];
  let currentChapter: TsutatsuTocChapter | null = null;
  let currentSection: TsutatsuTocSection | null = null;

  // bodyArea 直下の `<p>` を順に走査
  $body.children('p').each((_, p) => {
    const $p = $(p);
    const cls = $p.attr('class') ?? '';
    const text = cleanText($p.text());
    if (!text) return;

    // 章見出し: <p><strong>第N章　…</strong></p> （クラス無し or page-header）
    const chapterMatch = text.match(/^第([0-9０-９]+)章\s*[　 ]?(.*)$/);
    const isChapterHeading =
      ($p.children('strong').length > 0 || $p.is('p.page-header')) &&
      chapterMatch !== null &&
      !cls.includes('indent');

    if (isChapterHeading && chapterMatch) {
      currentChapter = {
        number: parseDigits(chapterMatch[1]),
        title: cleanText(chapterMatch[2]),
        sections: [],
      };
      currentSection = null;
      chapters.push(currentChapter);
      return;
    }

    if (!currentChapter) return;

    // 節見出し: <p class="indent2">第N節　<a ...>...</a> 等</p>
    if (cls.includes('indent2')) {
      const sectionMatch = text.match(/^第([0-9０-９]+)節\s*[　 ]?(.*)$/);
      if (sectionMatch) {
        const url = absolutize($p.find('a').first().attr('href'), sourceUrl);
        const sec: TsutatsuTocSection = {
          number: parseDigits(sectionMatch[1]),
          title: cleanText(sectionMatch[2]),
        };
        if (url) sec.url = url;
        currentChapter.sections.push(sec);
        currentSection = sec;
        return;
      }
    }

    // 款見出し: <p class="indent3">第N款　<a ...>...</a></p>
    if (cls.includes('indent3') && currentSection) {
      const subMatch = text.match(/^第([0-9０-９]+)款\s*[　 ]?(.*)$/);
      if (subMatch) {
        const url = absolutize($p.find('a').first().attr('href'), sourceUrl);
        const sub: TsutatsuTocSubsection = {
          number: parseDigits(subMatch[1]),
          title: cleanText(subMatch[2]),
        };
        if (url) sub.url = url;
        if (!currentSection.subsections) currentSection.subsections = [];
        currentSection.subsections.push(sub);
        return;
      }
    }
  });

  return chapters;
}

/** 全角 → 半角を含む整数化 */
function parseDigits(s: string): number {
  const ascii = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  return parseInt(ascii, 10);
}

function cleanText(s: string): string {
  return s.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
}

function absolutize(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

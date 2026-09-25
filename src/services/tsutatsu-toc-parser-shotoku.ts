/**
 * Tsutatsu TOC Parser (Shotoku style) — 所得税基本通達など、編/章/節/款 4 階層 + ul/li リンクの目次
 *
 * 入力例 URL: `/law/tsutatsu/kihon/shotoku/01.htm`
 *
 * 観察される HTML 構造:
 *   <div class="imp-cnt-tsutatsu" id="bodyArea">
 *     <h2 class="center txt-big">第1編 総則</h2>           ← 編（無視）
 *     <h3 class="center">第1章 通則</h3>                    ← 章
 *     <p>法第2条《定義》関係</p>                            ← グループ見出し（無視）
 *     <ul><li><a href="/shotoku/01/01.htm">〔...〕</a></li></ul>  ← section（条文単位）
 *     <p><a href="/shotoku/01/08.htm">法第3条...関係</a></p>      ← section（条単位）
 *     <h3 class="center">第2章 課税所得の範囲</h3>
 *     ...
 *
 * 消基通の `parseTsutatsuToc` とは別 parser として実装。出力型は同じ `TsutatsuToc`。
 */

import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

import type { TsutatsuToc, TsutatsuTocChapter, TsutatsuTocSection } from '../types/tsutatsu-toc.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

/**
 * 所基通スタイルの TOC ページをパースする。
 *
 * @param html  デコード済み HTML 文字列
 * @param sourceUrl リクエスト URL
 * @param fetchedAt ISO 8601 時刻
 */
export function parseTsutatsuTocShotoku(
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

  const chapters = extractShotokuChapters($, $body, sourceUrl);

  return {
    sourceUrl,
    fetchedAt,
    pageTitle,
    chapters,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * h3.center「第N章 …」を章として、後続 a[href] を section として収集する。
 * h2「第N編」は編タイトルとして拾い、章タイトルにプレフィックスとして付与する。
 * 所基通は編をまたいで章番号がリセットされるため、TOC 出現順で chapter.number を
 * 1 から連番化する（DB の `(tsutatsu_id, chapter_number)` UNIQUE 制約に適合させるため）。
 * 同 URL は #anchor を剥がして重複除去する。
 */
function extractShotokuChapters(
  $: CheerioAPI,
  $body: cheerio.Cheerio<Element>,
  sourceUrl: string
): TsutatsuTocChapter[] {
  const chapters: TsutatsuTocChapter[] = [];
  let chapterCounter = 0;
  let currentBukanLabel: string | null = null;

  // h2 (編) と h3 (章) を順番に走査。h2 が来たら currentBukanLabel を更新、
  // h3 が来たらその直前の編ラベルを title にプレフィックスする。
  $body.find('h2, h3').each((_, el) => {
    if (el.tagName === 'h2') {
      const t = cleanText($(el).text());
      const mm = t.match(/^第[0-9０-９]+編\s*[　 ]?.*$/);
      if (mm) {
        currentBukanLabel = t;
      }
      return;
    }

    // h3
    const text = cleanText($(el).text());
    const m = text.match(/^第([0-9０-９]+)章\s*[　 ]?(.*)$/);
    if (!m) return;

    chapterCounter += 1;
    const originalChapterNumber = parseDigits(m[1]);
    const chapterTitle = cleanText(m[2]);
    const fullTitle = currentBukanLabel
      ? `${currentBukanLabel} 第${originalChapterNumber}章 ${chapterTitle}`
      : `第${originalChapterNumber}章 ${chapterTitle}`;

    const chapter: TsutatsuTocChapter = {
      number: chapterCounter,
      title: fullTitle,
      sections: [],
    };
    const h3 = el;

    // 次の h3 までの a[href] を集める（兄弟ノード走査）
    const sectionsByUrl = new Map<string, TsutatsuTocSection>();
    let sectionCounter = 0;
    // houki-nta-mcp#54: 直前のリンクの無い見出し（`<p>法第2条《定義》関係</p>`）。
    // 後に続く「〔…〕」の項目は、この見出しの条に属する
    let groupTitle: string | null = null;
    let node = h3.nextSibling;
    while (node) {
      if (node.type === 'tag') {
        const el = node as Element;
        if (el.tagName === 'h3') break;
        if (/^h[1-6]$/.test(el.tagName)) {
          groupTitle = null;
        } else if (el.tagName === 'p' && $(el).find('a[href]').length === 0) {
          const t = cleanText($(el).text());
          if (/関係$/.test(t)) groupTitle = t;
        }
        // a[href] を探す（直接の a でも、p > a / ul > li > a でも拾う）
        $(el)
          .find('a[href]')
          .add(($(el).is('a[href]') ? $(el) : $()) as cheerio.Cheerio<Element>)
          .each((_i, a) => {
            const href = $(a).attr('href');
            if (!href) return;
            const abs = absolutize(href, sourceUrl);
            if (!abs) return;
            // anchor を剥がして URL を正規化
            const normalized = abs.replace(/#.*$/, '');
            // .htm 以外（外部リンク等）はスキップ
            if (!normalized.endsWith('.htm') && !normalized.endsWith('.html')) return;
            // 同じ通達ツリー外の URL（footer・menu 等）は除外
            if (!normalized.includes('/law/tsutatsu/kihon/')) return;

            const linkText = cleanText($(a).text());
            // 「〔…〕」の項目は条を示さないので、属する見出しの題を使う
            const articleTitle = linkText.startsWith('〔') ? groupTitle : linkText;

            const seen = sectionsByUrl.get(normalized);
            if (seen) {
              addArticleTitle(seen, articleTitle);
              return;
            }

            sectionCounter += 1;
            const section: TsutatsuTocSection = {
              number: sectionCounter,
              title: linkText || `第${sectionCounter}節`,
              url: normalized,
            };
            addArticleTitle(section, articleTitle);
            sectionsByUrl.set(normalized, section);
            chapter.sections.push(section);
          });
      }
      node = node.nextSibling;
    }

    if (chapter.sections.length > 0) {
      chapters.push(chapter);
    }
  });

  return chapters;
}

/** houki-nta-mcp#54: 条を示す題を重複なしで足す */
function addArticleTitle(section: TsutatsuTocSection, title: string | null): void {
  if (!title) return;
  if (!section.articleTitles) section.articleTitles = [];
  if (!section.articleTitles.includes(title)) section.articleTitles.push(title);
}

/** 全角 → 半角を含む整数化 */
function parseDigits(s: string): number {
  const ascii = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  return parseInt(ascii, 10);
}

function cleanText(s: string): string {
  return s.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
}

function absolutize(href: string, base: string): string | undefined {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

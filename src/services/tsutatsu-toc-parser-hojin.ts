/**
 * Tsutatsu TOC Parser (Hojin style) — 法基通など、`<h2>第N章 ...</h2>` + `<ul>...<li><a></a></li></ul>`
 * の TOC ページ用 parser。
 *
 * 入力例 URL: `/law/tsutatsu/kihon/hojin/01.htm`
 *
 * 観察される HTML 構造:
 *   <div class="imp-cnt-tsutatsu" id="bodyArea">
 *     <h1>基本通達･法人税法</h1>
 *     <h2>第1章 総則</h2>
 *     <ul class="noListImg indent1">
 *       <li><a href="/law/tsutatsu/kihon/hojin/01/01_01.htm">第1節 納税地及び納税義務</a></li>
 *       ...
 *     </ul>
 *     <h2>第2章 収益並びに費用及び損失の計算</h2>
 *     <ul class="noListImg indent1">
 *       <li>第1節 収益等の計上に関する通則
 *         <ul>
 *           <li><a href="/law/tsutatsu/kihon/hojin/02/02_01_01.htm">第1款 ...</a></li>
 *           ...
 *         </ul>
 *       </li>
 *       ...
 *     </ul>
 *     <h2>附則</h2>
 *     ...
 *
 * 所基通 parser との違い:
 *   - 章ヘッダが h2（所基通は h2=編 / h3=章）
 *   - 節は a[href] を直接 ul/li で列挙（所基通は p[href] / li[href] が混在）
 *   - 入れ子 ul で款を含む（4 階層 URL: /{章}/{章}_{節}_{款}.htm）
 *
 * 出力型は所基通と同じ TsutatsuToc。款を独立した section として登録するか
 * subsections にまとめるかは選択肢があるが、消基通 parser と同様、款も section
 * として連番化して登録（DB は flat 構造で構わない）する。
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import type { TsutatsuToc, TsutatsuTocChapter } from '../types/tsutatsu-toc.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

/**
 * 法基通スタイルの TOC ページをパースする。
 */
export function parseTsutatsuTocHojin(
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

  const chapters = extractHojinChapters($, $body, sourceUrl);

  return {
    sourceUrl,
    fetchedAt,
    pageTitle,
    chapters,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * h2「第N章 …」または「附則」を章として、後続 a[href] を section として収集する。
 *
 * - 「附則」「法令等」「サイトマップ」などの h2 は章として扱わない（章番号が抽出できないので）
 * - 章番号は HTML の番号をそのまま使う。「第12章の2」のような枝番は title に保持し、
 *   number は連番化する（DB の `(tsutatsu_id, chapter_number)` UNIQUE 制約のため）
 * - 同 URL は #anchor を剥がして重複除去する
 */
function extractHojinChapters(
  $: CheerioAPI,
  $body: cheerio.Cheerio<Element>,
  sourceUrl: string
): TsutatsuTocChapter[] {
  const chapters: TsutatsuTocChapter[] = [];
  let chapterCounter = 0;

  $body.find('h2').each((_, h2) => {
    const text = cleanText($(h2).text());

    // 「第N章 ...」「第N章の2 ...」を章として認識。「附則」は枠外（個別判定）
    const m = text.match(/^第([0-9０-９]+(?:の[0-9０-９]+)?)章\s*(.*)$/);
    const isFusoku = /^附則$/.test(text);
    if (!m && !isFusoku) return;

    chapterCounter += 1;
    const originalNumber = m ? m[1] : '附則';
    const titleText = m ? cleanText(m[2]) : '附則';
    const fullTitle = m ? `第${originalNumber}章 ${titleText}` : '附則';

    const chapter: TsutatsuTocChapter = {
      number: chapterCounter,
      title: fullTitle,
      sections: [],
    };

    const seenUrls = new Set<string>();
    let sectionCounter = 0;
    let node = h2.nextSibling;
    while (node) {
      if (node.type === 'tag') {
        const el = node as Element;
        if (el.tagName === 'h2') break;
        $(el)
          .find('a[href]')
          .each((_i, a) => {
            const href = $(a).attr('href');
            if (!href) return;
            const abs = absolutize(href, sourceUrl);
            if (!abs) return;
            const normalized = abs.replace(/#.*$/, '');
            if (!normalized.endsWith('.htm') && !normalized.endsWith('.html')) return;
            if (!normalized.includes('/law/tsutatsu/kihon/')) return;
            if (seenUrls.has(normalized)) return;
            seenUrls.add(normalized);

            sectionCounter += 1;
            const linkText = cleanText($(a).text());
            chapter.sections.push({
              number: sectionCounter,
              title: linkText || `第${sectionCounter}節`,
              url: normalized,
            });
          });
      }
      node = node.nextSibling;
    }

    if (chapter.sections.length > 0) {
      chapters.push(chapter);
    } else {
      // この章は section が無いので連番を巻き戻す
      chapterCounter -= 1;
    }
  });

  return chapters;
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

/**
 * Tsutatsu TOC Parser (Sozoku style) — 相続税法基本通達 (相基通) の flat 構造 TOC parser
 *
 * 入力例 URL: `/law/tsutatsu/kihon/sisan/sozoku2/01.htm`
 *
 * 観察される HTML 構造（flat、章/節は p[align="center"] / p.center で区切られる）:
 *   <div class="imp-cnt-tsutatsu" id="bodyArea">
 *     <p align="center">前文・説明文</p>
 *     <p align="center">第1章 総則</p>                            ← 章
 *     <p align="center">第1節 通則</p>                            ← 節（無視。clause リンクが直接 section）
 *     <p class="indent1">第1条の2((定義))関係</p>                  ← 条グループ（無視可）
 *     <p class="indent2">1の2－1<a href="...">「扶養義務者」の意義</a></p>
 *     <p class="indent1">第1条の3《...》及び第1条の4《...》共通関係</p>
 *     <p class="indent2">1の3・1の4共－1<a href="...">「個人」の意義</a></p>
 *     ...
 *
 * ## 設計判断
 *
 * 相基通は **各 clause が独立した URL を持つ** ため、消基通 / 所基通 / 法基通の
 * 「節 = 1 URL」モデルとは異なる。bulk-downloader と DB スキーマを無理に
 * 揃えるため、TOC parser は **各 clause リンクを「擬似 section」として展開** する:
 *
 *   - chapter = 「第N章 ...」
 *   - section = 各 clause リンク（番号は連番、title は「第K条 ... {clauseタイトル}」を複合）
 *
 * 節と条グループの情報は section.title に折りたたんで保持する。
 *
 * ## 出力
 *
 * 既存の TsutatsuToc 型をそのまま使う。subsections は使用しない。
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import type { TsutatsuToc, TsutatsuTocChapter } from '../types/tsutatsu-toc.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

/**
 * 相基通スタイルの TOC ページをパースする。
 */
export function parseTsutatsuTocSozoku(
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

  const chapters = extractSozokuChapters($, $body, sourceUrl);

  return {
    sourceUrl,
    fetchedAt,
    pageTitle,
    chapters,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * 状態機械的に走査:
 *   - p.center / p[align="center"] のテキストが「第N章 ...」なら章を切り替え
 *   - p.center / p[align="center"] のテキストが「第N節 ...」なら節ラベル更新
 *   - p.indent1 のテキストが「第N条...」なら条グループラベル更新
 *   - p.indent2 の中の a[href] を擬似 section として登録
 *     section.title = 「第N節 / 第M条 ... / {clauseタイトル}」のように複合
 */
function extractSozokuChapters(
  $: CheerioAPI,
  $body: cheerio.Cheerio<Element>,
  sourceUrl: string
): TsutatsuTocChapter[] {
  const chapters: TsutatsuTocChapter[] = [];
  let currentChapter: TsutatsuTocChapter | null = null;
  let currentChapterCounter = 0;
  let currentSectionLabel: string | null = null;
  let currentJoGroupLabel: string | null = null;
  let sectionCounter = 0;
  const seenUrls = new Set<string>();

  $body.find('p').each((_, p) => {
    const $p = $(p);
    const tag = $p.get(0)?.tagName;
    if (tag !== 'p') return;

    const text = cleanText($p.text());
    if (!text) return;

    const isCenter = $p.is('p.center, p[align="center"]');
    const isIndent1 = $p.is('p.indent1');
    const isIndent2 = $p.is('p.indent2');

    if (isCenter) {
      const chMatch = text.match(/^第([0-9０-９]+(?:の[0-9０-９]+)?)章\s*(.*)$/);
      const secMatch = text.match(/^第([0-9０-９]+(?:の[0-9０-９]+)?)節\s*(.*)$/);
      if (chMatch) {
        // 章切り替え。未確定の chapter があれば push
        const prev = currentChapter;
        if (prev && prev.sections.length > 0) {
          chapters.push(prev);
        }
        currentChapterCounter += 1;
        currentChapter = {
          number: currentChapterCounter,
          title: `第${chMatch[1]}章 ${cleanText(chMatch[2])}`.trim(),
          sections: [],
        };
        currentSectionLabel = null;
        currentJoGroupLabel = null;
      } else if (secMatch) {
        currentSectionLabel = `第${secMatch[1]}節 ${cleanText(secMatch[2])}`.trim();
        currentJoGroupLabel = null;
      }
      return;
    }

    if (isIndent1) {
      // 旧スタイル: 「第N条((関係))」「第N条《...》及び第M条《...》共通関係」など
      if (/(第[0-9０-９]+|第[0-9０-９]+条|共通関係|関係)$/.test(text)) {
        currentJoGroupLabel = text;
      }
      return;
    }

    // 新スタイル: 素の <p><strong>第N条《...》関係</strong></p>
    // class も align も無い p の中の <strong> から条グループラベルを拾う
    const cls = $p.attr('class');
    const align = $p.attr('align');
    if (!cls && !align) {
      const strongText = cleanText($p.find('strong').first().text());
      if (strongText && /(関係|共通関係)$/.test(strongText)) {
        currentJoGroupLabel = strongText;
        return;
      }
    }

    if (isIndent2) {
      // p.indent2 の中の a[href] を 1 つの擬似 section として登録
      $p.find('a[href]').each((_i, a) => {
        const href = $(a).attr('href');
        if (!href) return;
        const abs = absolutize(href, sourceUrl);
        if (!abs) return;
        const normalized = abs.replace(/#.*$/, '');
        if (!normalized.endsWith('.htm') && !normalized.endsWith('.html')) return;
        if (!normalized.includes('/law/tsutatsu/kihon/')) return;
        if (seenUrls.has(normalized)) return;
        seenUrls.add(normalized);

        if (!currentChapter) {
          // 章が未確定（章ヘッダ前の clause）。仮 chapter を作る
          currentChapterCounter += 1;
          currentChapter = {
            number: currentChapterCounter,
            title: '（章未指定）',
            sections: [],
          };
        }

        const ch = currentChapter;
        sectionCounter += 1;
        const linkText = cleanText($(a).text());
        const titleParts = [
          currentSectionLabel,
          currentJoGroupLabel,
          linkText || `第${sectionCounter}節`,
        ].filter((s): s is string => Boolean(s));
        ch.sections.push({
          number: sectionCounter,
          title: titleParts.join(' / '),
          url: normalized,
        });
      });
    }
  });

  // 末尾の chapter を push
  // NB: TS の制御フロー解析が forEach の closure 越しに `let currentChapter` の
  //     型を `never` に絞ってしまうため、明示 cast で逃がす（実害なし）
  const last = currentChapter as TsutatsuTocChapter | null;
  if (last && last.sections.length > 0) {
    chapters.push(last);
  }

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

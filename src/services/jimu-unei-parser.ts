/**
 * Jimu-unei Parser — 事務運営指針の索引 + 個別ページ用 parser
 *
 * 索引 URL: `https://www.nta.go.jp/law/jimu-unei/jimu.htm`
 * 個別 URL: `/law/jimu-unei/{税目}/{...サブパス}/{YYMMDD}/{index|01}.htm`
 *
 * 個別ページの構造（kaisei と類似）:
 *   <div class="imp-cnt-tsutatsu" id="bodyArea">
 *     <h1>個人の恒久的施設帰属所得に係る各種所得に関する調査等に係る事務運営要領の制定について（事務運営指針）</h1>
 *     <p>標題のことについては、別添のとおり定めたから、…</p>  ← 本文
 *     ...
 *     <a href="...pdf">…(PDFファイル/154KB)</a>             ← 様式 PDF
 *
 * doc_id は taxonomy 後の URL パスを採用。例:
 *   `/jimu-unei/shotoku/shinkoku/170331/index.htm` → doc_id = "shotoku/shinkoku/170331"
 *   `/jimu-unei/sozoku/170111_1/01.htm`            → doc_id = "sozoku/170111_1"
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import { normalizeJpText } from './text-normalize.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';
import { extractIssuedAt } from './kaisei-toc-parser.js';
import { parsePdfSizeKb } from './kaisei-parser.js';
import type { AttachedPdf, NtaDocument, KaiseiIndexEntry } from '../types/document.js';

/**
 * 索引 (`jimu.htm`) から個別ページのリンク一覧を返す。
 *
 * `kaisei` リンク（`/jimu-unei/.../kaisei/...`）は事務運営指針の改正通達なので、
 * jimu-unei 本体としては除外する（重複格納を避ける）。
 */
export function parseJimuUneiIndex(html: string, sourceUrl: string): KaiseiIndexEntry[] {
  const $ = cheerio.load(html);
  const $body =
    $('div.imp-cnt-tsutatsu#bodyArea').first().length > 0
      ? $('div.imp-cnt-tsutatsu#bodyArea').first()
      : $('div.imp-cnt#bodyArea').first().length > 0
        ? $('div.imp-cnt#bodyArea').first()
        : $('#bodyArea').first();

  if ($body.length === 0) {
    throw new TsutatsuParseError(
      '事務運営指針索引本体 (div.imp-cnt#bodyArea) が見つかりません',
      sourceUrl
    );
  }

  $body.find('ol.breadcrumb, .page-top-link').remove();

  const seen = new Set<string>();
  const entries: KaiseiIndexEntry[] = [];

  $body.find('a[href]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href');
    if (!href) return;
    // /jimu-unei/.../{index|01}.htm のみ対象、`kaisei` を含むパスは除外
    if (!/\/jimu-unei\/.+\/(index|01)\.htm$/.test(href)) return;
    if (/\/jimu-unei\/.*\/kaisei\//.test(href)) return;

    let abs: string;
    try {
      abs = new URL(href, sourceUrl).toString();
    } catch {
      return;
    }
    const normalized = abs.replace(/#.*$/, '');
    if (seen.has(normalized)) return;
    seen.add(normalized);

    const title = cleanText($a.text());
    if (!title) return;

    entries.push({
      title,
      url: normalized,
      issuedAt: extractIssuedAt(title),
    });
  });

  return entries;
}

/**
 * 個別事務運営指針ページをパースして NtaDocument を返す。
 */
export function parseJimuUneiPage(
  html: string,
  sourceUrl: string,
  fetchedAt: string = new Date().toISOString()
): NtaDocument {
  const $ = cheerio.load(html);
  $('br').replaceWith('\n');

  const $body =
    $('div.imp-cnt-tsutatsu#bodyArea').first().length > 0
      ? $('div.imp-cnt-tsutatsu#bodyArea').first()
      : $('div.imp-cnt#bodyArea').first().length > 0
        ? $('div.imp-cnt#bodyArea').first()
        : $('#bodyArea').first();

  if ($body.length === 0) {
    throw new TsutatsuParseError('事務運営指針本体が見つかりません', sourceUrl);
  }

  $body.find('ol.breadcrumb, .page-top-link').remove();

  const title = cleanText(
    $body.find('.page-header h1').first().text() || $body.find('h1').first().text()
  );
  if (!title) {
    throw new TsutatsuParseError('事務運営指針のタイトル（h1）が見つかりません', sourceUrl);
  }

  // 段落収集（kaisei と同じ要領）
  const paragraphs: string[] = [];
  $body.find('p').each((_, p) => {
    const t = cleanText($(p).text());
    if (!t) return;
    if (/^ページの先頭へ戻る$/.test(t)) return;
    if (/^法令等$/.test(t)) return;
    paragraphs.push(t);
  });
  // h2/h3 (章節タイトル) も本文として取り込む
  $body.find('h2, h3').each((_, h) => {
    const t = cleanText($(h).text());
    if (!t) return;
    if (/^法令等$/.test(t)) return;
    if (/^サイトマップ/.test(t)) return;
    paragraphs.push(`【${t}】`);
  });

  const fullText = normalizeJpText(paragraphs.join('\n'));

  // 発出日候補: 段落 + タイトル + URL のフォルダ名 (YYMMDD)
  const issuedAt =
    extractIssuedAt(paragraphs[0] ?? '') ??
    extractIssuedAt(title) ??
    extractIssuedAtFromUrlFolder(sourceUrl);

  // 発出者・宛先抽出 (kaisei と同じパターン)
  const issuer = extractIssuer(paragraphs.slice(0, 8));

  const attachedPdfs = extractAttachedPdfs($, $body, sourceUrl);

  return {
    docType: 'jimu-unei',
    docId: extractDocIdFromJimuUrl(sourceUrl) ?? '',
    taxonomy: extractTaxonomyFromJimuUrl(sourceUrl),
    title,
    issuedAt,
    issuer,
    sourceUrl,
    fetchedAt,
    fullText,
    attachedPdfs,
  };
}

function extractAttachedPdfs(
  $: CheerioAPI,
  $body: cheerio.Cheerio<Element>,
  sourceUrl: string
): AttachedPdf[] {
  const seen = new Set<string>();
  const pdfs: AttachedPdf[] = [];
  $body.find('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href || !/\.pdf(\?|$)/i.test(href)) return;
    let abs: string;
    try {
      abs = new URL(href, sourceUrl).toString();
    } catch {
      return;
    }
    if (seen.has(abs)) return;
    seen.add(abs);
    const text = cleanText($(a).text());
    pdfs.push({ title: text || 'PDF', url: abs, sizeKb: parsePdfSizeKb(text) });
  });
  return pdfs;
}

function extractIssuer(firstParagraphs: string[]): string | undefined {
  const lines: string[] = [];
  for (const p of firstParagraphs) {
    if (/(殿|国税庁長官|（官印省略）|\(官印省略\))/.test(p)) {
      lines.push(p);
    }
  }
  return lines.length ? lines.join('\n') : undefined;
}

/**
 * URL から doc_id を抽出。
 * 例: `/jimu-unei/shotoku/shinkoku/170331/index.htm` → `'shotoku/shinkoku/170331'`
 *     `/jimu-unei/sozoku/170111_1/01.htm` → `'sozoku/170111_1'`
 */
export function extractDocIdFromJimuUrl(url: string): string | undefined {
  const m = url.match(/\/law\/jimu-unei\/(.+?)\/(?:index|01)\.htm$/);
  return m ? m[1] : undefined;
}

/**
 * URL から税目フォルダを抽出（先頭セグメントのみ）。
 * 例: `shotoku/shinkoku/170331` → `'shotoku'`
 */
export function extractTaxonomyFromJimuUrl(url: string): string | undefined {
  const m = url.match(/\/law\/jimu-unei\/([^/]+)\//);
  return m ? m[1] : undefined;
}

/**
 * URL のフォルダ名（YYMMDD 形式）から発出日を推定。
 * 例: `/jimu-unei/shotoku/shinkoku/170331/index.htm` → `'2005-03-31'`（17 = 平成17年 = 2005）
 */
export function extractIssuedAtFromUrlFolder(url: string): string | undefined {
  // 末尾セグメントの ID 部分を取り出す（170331, 090401, 170111_1 等）
  const m = url.match(/\/jimu-unei\/.+\/(\d{6})(?:[_-]\d+)?\/(?:index|01)\.htm$/);
  if (!m) return undefined;
  const yymmdd = m[1];
  // YY の解釈は曖昧だが、ファイル ID は概ね「平成 YY 年 MM 月 DD 日」という慣習
  // YY が小さければ平成、大きければ昭和… の範囲を絞る試み（誤差は許容、index 由来は補助情報）
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = parseInt(yymmdd.slice(2, 4), 10);
  const dd = parseInt(yymmdd.slice(4, 6), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  // 平成は 1989-2019。YY: 01=平成1, 18=平成18, 30=平成30 (=2018)
  // 令和は 2019- (令和元=2019)。実際の国税庁ファイル ID は平成期が多い
  let year: number;
  if (yy >= 1 && yy <= 31)
    year = 1988 + yy; // 平成
  else if (yy >= 32 && yy <= 60)
    year = 1925 + yy; // 昭和（万一の遡及。実例は無い想定）
  else return undefined;
  const yyyy = String(year).padStart(4, '0');
  const mmStr = String(mm).padStart(2, '0');
  const ddStr = String(dd).padStart(2, '0');
  return `${yyyy}-${mmStr}-${ddStr}`;
}

function cleanText(s: string): string {
  return s.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
}

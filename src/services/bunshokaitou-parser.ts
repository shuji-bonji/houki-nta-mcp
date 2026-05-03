/**
 * Bunshokaitou Parser — 文書回答事例の索引・税目別索引・個別事例 parser
 *
 * 3 階層構造:
 *   1. メイン索引: `/law/bunshokaito/01.htm` → 税目別索引リンク（11 税目 × 2 形式）
 *   2. 税目別索引: `/law/bunshokaito/{税目}/{02 等}.htm` → 個別事例リンク（数百件）
 *   3. 個別事例:
 *      - 本庁系: `/law/bunshokaito/{税目}/{ID}/index.htm`
 *      - 国税局系: `/about/organization/{国税局}/bunshokaito/{税目}/{ID}/index.htm`
 *
 * doc_id 設計（UNIQUE 性のため URL パスを反映）:
 *   - 本庁系: `{税目}/{ID}` 例: `'shotoku/250416'`
 *   - 国税局系: `{国税局}/{税目}/{ID}` 例: `'tokyo/shotoku/260218'`
 *
 * 個別事例ページの本文は概ね以下の構造（kaisei/jimu-unei と類似）:
 *   <div class="imp-cnt-tsutatsu" id="bodyArea">
 *     <h1>タイトル</h1>
 *     <p>取引等に係る税務上の取扱い等に関する照会…</p>
 *     <p>〔照会〕</p>  ←  本文セクション 1
 *     <p>本文…</p>
 *     <p>〔回答〕</p>  ←  本文セクション 2
 *     <p>本文…</p>
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import { normalizeJpText } from './text-normalize.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';
import { extractIssuedAt } from './kaisei-toc-parser.js';
import { parsePdfSizeKb } from './kaisei-parser.js';
import type { AttachedPdf, NtaDocument, KaiseiIndexEntry } from '../types/document.js';

/** 税目別索引 URL のエントリ */
export interface BunshoTaxonomyEntry {
  taxonomy: string;
  taxonomyTitle: string;
  /** 税目別索引（回答年月日順）の URL */
  indexUrl: string;
}

/**
 * メイン索引 (`/law/bunshokaito/01.htm`) から税目別索引（回答年月日順）の
 * URL リストを返す。`02_1.htm` 等の「項目別」は重複データなので除外する。
 */
export function parseBunshoMainIndex(html: string, sourceUrl: string): BunshoTaxonomyEntry[] {
  const $ = cheerio.load(html);
  const $body =
    $('div.imp-cnt-tsutatsu#bodyArea').first().length > 0
      ? $('div.imp-cnt-tsutatsu#bodyArea').first()
      : $('div.imp-cnt#bodyArea').first().length > 0
        ? $('div.imp-cnt#bodyArea').first()
        : $('#bodyArea').first();

  if ($body.length === 0) {
    throw new TsutatsuParseError(
      '文書回答事例索引本体 (div.imp-cnt#bodyArea) が見つかりません',
      sourceUrl
    );
  }
  $body.find('ol.breadcrumb, .page-top-link').remove();

  // 「（回答年月日順）」「（項目別）」の前にある税目見出しを拾うため、リンクを順番に走査
  const seenTaxonomies = new Set<string>();
  const entries: BunshoTaxonomyEntry[] = [];

  $body.find('a[href]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href');
    if (!href) return;
    // /law/bunshokaito/{税目}/02.htm のように、末尾に `_1` が付かない数字のみ採用
    if (!/\/law\/bunshokaito\/([^/]+)\/(\d+)\.htm$/.test(href)) return;

    let abs: string;
    try {
      abs = new URL(href, sourceUrl).toString();
    } catch {
      return;
    }
    const m = abs.match(/\/law\/bunshokaito\/([^/]+)\/\d+\.htm$/);
    if (!m) return;
    const taxonomy = m[1];
    if (seenTaxonomies.has(taxonomy)) return;
    seenTaxonomies.add(taxonomy);

    // 直前の見出し（h2 など）を税目タイトルとして取得（不可能なら空文字）
    const taxonomyTitle =
      cleanText($a.closest('section, dl, ul, dd, div').prev('h2, h3').first().text()) ||
      cleanText($a.closest('section, dl, ul, dd, div').find('h2, h3').first().text()) ||
      taxonomy;

    entries.push({
      taxonomy,
      taxonomyTitle,
      indexUrl: abs,
    });
  });

  return entries;
}

/**
 * 税目別索引 (`/law/bunshokaito/{税目}/02.htm` 等) から個別事例 URL のリストを返す。
 *
 * 個別事例は 2 系統の URL がある:
 *   - 本庁系:   `/law/bunshokaito/{税目}/{ID}/index.htm`
 *   - 国税局系: `/about/organization/{国税局}/bunshokaito/{税目}/{ID}/index.htm`
 *   - 国税局系の中には末尾が `.htm`（`/index.htm` でない）パターンも稀にある
 */
export function parseBunshoTaxonomyIndex(html: string, sourceUrl: string): KaiseiIndexEntry[] {
  const $ = cheerio.load(html);
  const $body =
    $('div.imp-cnt-tsutatsu#bodyArea').first().length > 0
      ? $('div.imp-cnt-tsutatsu#bodyArea').first()
      : $('div.imp-cnt#bodyArea').first().length > 0
        ? $('div.imp-cnt#bodyArea').first()
        : $('#bodyArea').first();
  if ($body.length === 0) {
    throw new TsutatsuParseError(
      '税目別索引本体 (div.imp-cnt#bodyArea) が見つかりません',
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
    // 個別事例 URL は以下のいずれか
    //   /law/bunshokaito/{税目}/{ID}/index.htm
    //   /about/organization/{国税局}/bunshokaito/{税目}/{ID}/index.htm
    //   /about/organization/{国税局}/bunshokaito/{税目}/{ID}.htm
    if (
      !/\/law\/bunshokaito\/[^/]+\/[^/]+\/index\.htm$/.test(href) &&
      !/\/about\/organization\/[^/]+\/bunshokaito\/[^/]+\/[^/]+\/index\.htm$/.test(href) &&
      !/\/about\/organization\/[^/]+\/bunshokaito\/[^/]+\/[^/]+\.htm$/.test(href)
    ) {
      return;
    }

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

/** 個別事例ページをパースして NtaDocument を返す。 */
export function parseBunshoPage(
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
    throw new TsutatsuParseError('文書回答事例本体が見つかりません', sourceUrl);
  }
  $body.find('ol.breadcrumb, .page-top-link').remove();

  const title = cleanText(
    $body.find('.page-header h1').first().text() || $body.find('h1').first().text()
  );
  if (!title) {
    throw new TsutatsuParseError('文書回答事例のタイトル（h1）が見つかりません', sourceUrl);
  }

  // 段落を順に収集（h1 / nav 系を除く）
  const paragraphs: string[] = [];
  $body.find('p, h2, h3').each((_, el) => {
    const tag = el.tagName;
    const t = cleanText($(el).text());
    if (!t) return;
    if (/^ページの先頭へ戻る$/.test(t)) return;
    if (/^法令等$/.test(t)) return;
    if (/^サイトマップ/.test(t)) return;
    if (tag === 'h2' || tag === 'h3') {
      paragraphs.push(`【${t}】`);
    } else {
      paragraphs.push(t);
    }
  });

  const fullText = normalizeJpText(paragraphs.join('\n'));

  const issuedAt = extractIssuedAt(paragraphs[0] ?? '') ?? extractIssuedAt(title);
  const issuer = extractIssuer(paragraphs.slice(0, 8), sourceUrl);
  const attachedPdfs = extractAttachedPdfs($, $body, sourceUrl);

  return {
    docType: 'bunshokaitou',
    docId: extractDocIdFromBunshoUrl(sourceUrl) ?? '',
    taxonomy: extractTaxonomyFromBunshoUrl(sourceUrl),
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

/**
 * 発出者を推定。本庁系は「国税庁長官」、国税局系は URL から国税局名を取り出す。
 */
function extractIssuer(firstParagraphs: string[], sourceUrl: string): string | undefined {
  for (const p of firstParagraphs) {
    if (/(殿|国税庁長官|（官印省略）|\(官印省略\))/.test(p)) return p;
  }
  // URL から国税局名を推測（東京国税局 / 大阪国税局 等）
  const m = sourceUrl.match(/\/about\/organization\/([^/]+)\/bunshokaito\//);
  if (m) {
    const localeMap: Record<string, string> = {
      tokyo: '東京国税局',
      osaka: '大阪国税局',
      nagoya: '名古屋国税局',
      sendai: '仙台国税局',
      sapporo: '札幌国税局',
      kantoshinetsu: '関東信越国税局',
      kanazawa: '金沢国税局',
      hiroshima: '広島国税局',
      takamatsu: '高松国税局',
      fukuoka: '福岡国税局',
      kumamoto: '熊本国税局',
      okinawa: '沖縄国税事務所',
    };
    return localeMap[m[1]] ?? m[1];
  }
  // 本庁系 `/law/bunshokaito/...` は国税庁本庁
  if (/\/law\/bunshokaito\//.test(sourceUrl)) return '国税庁';
  return undefined;
}

/**
 * URL から doc_id を抽出。
 *   `/law/bunshokaito/shotoku/250416/index.htm` → `shotoku/250416`
 *   `/about/organization/tokyo/bunshokaito/shotoku/260218/index.htm` → `tokyo/shotoku/260218`
 *   `/about/organization/sendai/bunshokaito/shotoku/230919.htm` → `sendai/shotoku/230919`
 */
export function extractDocIdFromBunshoUrl(url: string): string | undefined {
  // 本庁系
  let m = url.match(/\/law\/bunshokaito\/(.+?)\/index\.htm$/);
  if (m) return m[1];
  // 国税局系 /index.htm
  m = url.match(/\/about\/organization\/([^/]+)\/bunshokaito\/(.+?)\/index\.htm$/);
  if (m) return `${m[1]}/${m[2]}`;
  // 国税局系 末尾 .htm のみ
  m = url.match(/\/about\/organization\/([^/]+)\/bunshokaito\/(.+?)\.htm$/);
  if (m) return `${m[1]}/${m[2]}`;
  return undefined;
}

/**
 * URL から税目フォルダを抽出（先頭の税目セグメントのみ）。
 *   `/law/bunshokaito/shotoku/...` → `shotoku`
 *   `/about/organization/tokyo/bunshokaito/shotoku/...` → `shotoku`
 */
export function extractTaxonomyFromBunshoUrl(url: string): string | undefined {
  let m = url.match(/\/law\/bunshokaito\/([^/]+)\//);
  if (m) return m[1];
  m = url.match(/\/about\/organization\/[^/]+\/bunshokaito\/([^/]+)\//);
  if (m) return m[1];
  return undefined;
}

function cleanText(s: string): string {
  return s.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
}

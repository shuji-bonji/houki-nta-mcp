/**
 * Kaisei Page Parser — 個別改正通達ページから本文・添付 PDF を抽出する。
 *
 * 入力例: `/law/tsutatsu/kihon/{税目}/kaisei/{文書ID}/index.htm`
 *
 * 観察される HTML 構造:
 *   <div class="imp-cnt-tsutatsu" id="bodyArea">
 *     <h1>消費税法基本通達の一部改正について（法令解釈通達）</h1>
 *     <p>課消２－11 課総12－14 …  令和８年４月１日</p>     ← 文書番号 + 発出日
 *     <p>各国税局長 殿 沖縄国税事務所長 殿 各税関長 殿 沖縄地区税関長 殿</p>  ← 宛先
 *     <p>国税庁長官 （官印省略）</p>                       ← 発出者
 *     <p>消費税法基本通達（…）を下記のとおり改正したから、…</p>  ← 本文
 *     <p>（理由）…</p>
 *     <p>記</p>
 *     <p>別紙「…」の…部分を…のとおり改める。…</p>
 *     ...
 *     <a href="...pdf">別紙（PDF/470KB）</a>            ← 添付 PDF
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import { normalizeJpText } from './text-normalize.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';
import { extractIssuedAt } from './kaisei-toc-parser.js';
import type { AttachedPdf, NtaDocument } from '../types/document.js';

/** 個別改正通達ページをパースして NtaDocument を返す。 */
export function parseKaiseiPage(
  html: string,
  sourceUrl: string,
  fetchedAt: string = new Date().toISOString()
): NtaDocument {
  const $ = cheerio.load(html);
  // <br> を改行に正規化
  $('br').replaceWith('\n');

  const $body =
    $('div.imp-cnt-tsutatsu#bodyArea').first().length > 0
      ? $('div.imp-cnt-tsutatsu#bodyArea').first()
      : $('div.imp-cnt#bodyArea').first().length > 0
        ? $('div.imp-cnt#bodyArea').first()
        : $('#bodyArea').first();

  if ($body.length === 0) {
    throw new TsutatsuParseError(
      '改正通達本体 (div.imp-cnt-tsutatsu#bodyArea) が見つかりません',
      sourceUrl
    );
  }

  $body.find('ol.breadcrumb, .page-top-link').remove();

  const title = cleanText(
    $body.find('.page-header h1').first().text() || $body.find('h1').first().text()
  );
  if (!title) {
    throw new TsutatsuParseError('改正通達のタイトル（h1）が見つかりません', sourceUrl);
  }

  // 本文段落を順に収集（h1 とサイドナビ等を除く）
  const paragraphs: string[] = [];
  $body.find('p').each((_, p) => {
    const t = cleanText($(p).text());
    if (!t) return;
    // ナビ系で混入しがちな短いテキストは除外（キーワードベース）
    if (/^ページの先頭へ戻る$/.test(t)) return;
    if (/^法令等$/.test(t)) return;
    paragraphs.push(t);
  });

  const fullText = normalizeJpText(paragraphs.join('\n'));

  // 文書番号 + 発出日: 最初の段落（h1 直後）に課税局番号 + 元号日付が並ぶ典型パターン
  const issuedAt = extractIssuedAt(paragraphs[0] ?? '') ?? extractIssuedAt(title);

  // 発出者・宛先: 最初の数段落から「殿」「国税庁長官」「（官印省略）」のキーワードを拾う
  const issuer = extractIssuer(paragraphs.slice(0, 6));

  // 添付 PDF
  const attachedPdfs = extractAttachedPdfs($, $body, sourceUrl);

  return {
    docType: 'kaisei',
    docId: extractDocIdFromKaiseiUrl(sourceUrl) ?? '',
    taxonomy: extractTaxonomyFromKaiseiUrl(sourceUrl),
    title,
    issuedAt,
    issuer,
    sourceUrl,
    fetchedAt,
    fullText,
    attachedPdfs,
  };
}

/** 添付 PDF を抽出。「リンクテキスト」と「絶対 URL」を取り、サイズ KB も推定する */
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
    pdfs.push({
      title: text || 'PDF',
      url: abs,
      sizeKb: parsePdfSizeKb(text),
    });
  });
  return pdfs;
}

/** リンクテキストから「PDF/470KB」「PDF/1.18MB」等のサイズを KB に正規化して取り出す */
export function parsePdfSizeKb(text: string): number | undefined {
  // 「(PDF/470KB)」「(PDFファイル/76KB)」「(PDF/1,594KB)」「(PDF/1.18MB)」
  const m = text.match(/(?:PDF[^/]*\/)\s*([0-9,.]+)\s*(KB|MB)/i);
  if (!m) return undefined;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(num)) return undefined;
  const unit = m[2].toUpperCase();
  return unit === 'MB' ? Math.round(num * 1024) : Math.round(num);
}

/** 段落の中から発出者・宛先らしい行を抽出して改行 join */
function extractIssuer(firstParagraphs: string[]): string | undefined {
  const lines: string[] = [];
  for (const p of firstParagraphs) {
    if (/(殿|国税庁長官|（官印省略）|\(官印省略\))/.test(p)) {
      lines.push(p);
    }
  }
  return lines.length ? lines.join('\n') : undefined;
}

/** URL から doc_id を抽出 */
function extractDocIdFromKaiseiUrl(url: string): string | undefined {
  const m = url.match(/\/kaisei\/([^/]+)\/index\.htm/);
  return m ? m[1] : undefined;
}

/** URL から税目フォルダを抽出 */
function extractTaxonomyFromKaiseiUrl(url: string): string | undefined {
  const m = url.match(/\/law\/tsutatsu\/kihon\/([^/]+(?:\/[^/]+)?)\/kaisei\//);
  return m ? m[1] : undefined;
}

function cleanText(s: string): string {
  return s.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
}

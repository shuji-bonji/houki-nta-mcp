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
 * 個別事例ページの本文は「表 + 別紙」でできている（2008 年の 081102 と 2025 年の 250416 で同じ）:
 *   <div class="imp-cnt imp-data" id="bodyArea">
 *     <h1>タイトル</h1>
 *     <p>取引等に係る税務上の取扱い等に関する照会（同業者団体等用）</p>
 *     <p>〔照会〕</p>
 *     <table class="table table-bordered kaito">   ← 照会者 / 照会の内容 / 関係する法令条項等 / 添付書類
 *       <tr><th>…</th><td>…</td></tr>               照会の趣旨・事実関係・理由は「<a href="another.htm">別紙</a>のとおり」
 *     </table>
 *     <p>〔回答〕</p>
 *     <table class="table table-bordered kaito">   ← 回答年月日 / 回答者 / 回答内容
 *     </table>
 *   別紙 (同ディレクトリの another.htm) は <p> / <h2> / <h3> 主体で、照会文の本文がある。
 *
 * v0.10.2 までは <p> / <h2> / <h3> しか集めていなかったため、fullText が
 * 「〔照会〕」「〔回答〕」の見出しだけになり、issuedAt も null だった（houki-hub 側の実測で発見）。
 * v0.10.3 から表の行を「見出し: 値」の 1 行にして取り込み、回答年月日から issuedAt を取り、
 * 別紙は呼び出し側 (bulk downloader) が取得して appendices に渡すと【別紙】として末尾に連結する。
 */

import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { AttachedPdf, KaiseiIndexEntry, NtaDocument } from '../types/document.js';
import { parsePdfSizeKb } from './kaisei-parser.js';
import { extractIssuedAt } from './kaisei-toc-parser.js';
import { extractPdfKind } from './pdf-meta.js';
import { normalizeJpText } from './text-normalize.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

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
/** 別紙ページ (another.htm) の取得結果。呼び出し側が取得して渡す */
export interface BunshoAppendix {
  url: string;
  html: string;
}

/**
 * index.htm から別紙ページの URL を集める。
 *
 * 別紙の置き場所は 2 通りある:
 *   本庁系   `another.htm`（「別紙」リンクが 3 本とも同じ URL）
 *   国税局系 `01.htm#a01` / `#a02` / `#a03`（1 ページに 3 項目、アンカーで分かれる）
 * どちらも「リンクの文字に別紙が入っている」「同じディレクトリの .htm」で拾える。
 * フラグメントは落として重複を除くので、返るのは実際に取得すべきページだけ。
 */
export function extractBunshoAppendixUrls(html: string, sourceUrl: string): string[] {
  const $ = cheerio.load(html);
  const dir = sourceUrl.replace(/[^/]*$/, '');
  const urls: string[] = [];
  const seen = new Set<string>();
  $('#bodyArea a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    const text = cleanText($(a).text());
    const looksLikeAppendix = /別紙|another/i.test(text) || /another[^/]*\.htm/i.test(href);
    if (!looksLikeAppendix) return;
    let abs: string;
    try {
      abs = new URL(href, sourceUrl).toString();
    } catch {
      return;
    }
    abs = abs.replace(/#.*$/, '');
    // 同じディレクトリの .htm だけ。自分自身と、他ディレクトリへの参照は除く
    if (!abs.startsWith(dir) || !/\.html?$/i.test(abs)) return;
    if (abs === sourceUrl.replace(/#.*$/, '')) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    urls.push(abs);
  });
  return urls;
}

export function parseBunshoPage(
  html: string,
  sourceUrl: string,
  fetchedAt: string = new Date().toISOString(),
  appendices: BunshoAppendix[] = []
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

  // 段落と表を文書順に収集（h1 / nav 系を除く）
  const { paragraphs, answeredAt } = collectBodyText($, $body);

  // 別紙 (another.htm) を【別紙】として末尾に連結。別紙内の PDF も添付に加える
  const appendixPdfs: AttachedPdf[] = [];
  for (const appendix of appendices) {
    const $$ = cheerio.load(appendix.html);
    $$('br').replaceWith('\n');
    const $$body = $$('#bodyArea').first();
    if ($$body.length === 0) continue;
    $$body.find('ol.breadcrumb, .page-top-link').remove();
    const { paragraphs: appendixParagraphs } = collectBodyText($$, $$body);
    if (appendixParagraphs.length === 0) continue;
    paragraphs.push('【別紙】');
    paragraphs.push(...appendixParagraphs);
    appendixPdfs.push(...extractAttachedPdfs($$, $$body, appendix.url));
  }

  const fullText = normalizeJpText(paragraphs.join('\n'));

  // 回答年月日（回答の表）を最優先。無ければ従来どおり先頭段落・タイトルから
  const issuedAt = answeredAt ?? extractIssuedAt(paragraphs[0] ?? '') ?? extractIssuedAt(title);
  const issuer = extractIssuer(paragraphs.slice(0, 8), sourceUrl);
  const attachedPdfs = mergePdfs(extractAttachedPdfs($, $body, sourceUrl), appendixPdfs);

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

/**
 * 本文を文書順に集める。
 *   - <p> / <h2> / <h3>: そのまま（h2/h3 は【】で囲む）
 *   - <table>: 各行を「見出し: 値」の 1 行にする（th を見出し、td を値として空白で連結）
 *     表の中の <p> は行として取り込まれるので、個別には拾わない（二重取りを防ぐ）
 * 回答の表の「回答年月日」行が見つかれば、その値を ISO 日付にして answeredAt で返す。
 */
function collectBodyText(
  $: CheerioAPI,
  $body: cheerio.Cheerio<Element>
): { paragraphs: string[]; answeredAt: string | undefined } {
  const paragraphs: string[] = [];
  let answeredAt: string | undefined;
  $body.find('p, h2, h3, li, table').each((_, el) => {
    const tag = el.tagName;
    if (tag === 'table') {
      $(el)
        .find('tr')
        .each((__, tr) => {
          const heads = $(tr)
            .find('th')
            .map((___, th) => cleanText($(th).text()))
            .get()
            .filter(Boolean);
          const values = $(tr)
            .find('td')
            .map((___, td) => cleanText($(td).text()))
            .get()
            .filter(Boolean);
          if (heads.length === 0 && values.length === 0) return;
          const head = heads.join(' ');
          const value = values.join(' ');

          // 回答年月日は 2 通りの並びで書かれている:
          //   本庁系   <th>回答年月日</th><td>令和7年4月7日</td>
          //   国税局系 <td>回答年月日</td><td>令和7年10月17日</td><td>回答者</td><td>…</td>
          // どちらも「回答年月日 の次のセル」を見れば取れるので、th/td を文書順に並べて探す。
          if (answeredAt === undefined) {
            const cells = $(tr)
              .find('th, td')
              .map((___, c) => cleanText($(c).text()))
              .get();
            const at = cells.findIndex((c) => /回答年月日/.test(c));
            if (at >= 0) {
              // 「回答年月日」と同じセルに日付が入っている場合もあるので、次のセル → 同じセルの順で見る
              answeredAt = extractIssuedAt(cells[at + 1] ?? '') ?? extractIssuedAt(cells[at]);
            }
          }

          paragraphs.push(head && value ? `${head}: ${value}` : head || value);
        });
      return;
    }
    // 表の中の p / h / li は表の行として取り込み済み
    if ($(el).closest('table').length > 0) return;

    // <li>: 別紙 (01.htm) の照会本文は ol/li で書かれている。
    // 入れ子の ol/ul は各 li として別に拾うので、ここでは自分の直下の文だけを取る
    // （親 li の「(1) 本件サービスについて」と子 li の「イ ロケットの準備…」が両方残る）。
    // パンくず以外にもページ下部の案内リンクが li で並ぶので、
    // 「中身がリンク 1 本だけ」の li はナビゲーションとみなして落とす。
    if (tag === 'li') {
      const $li = $(el).clone();
      $li.find('ol, ul').remove();
      const own = cleanText($li.text());
      if (!own) return;
      const $links = $li.find('a');
      if ($links.length === 1 && cleanText($links.first().text()) === own) return;
      paragraphs.push(own);
      return;
    }

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
  return { paragraphs, answeredAt };
}

/** URL で重複を除いて連結 */
function mergePdfs(...lists: AttachedPdf[][]): AttachedPdf[] {
  const seen = new Set<string>();
  const out: AttachedPdf[] = [];
  for (const list of lists) {
    for (const pdf of list) {
      if (seen.has(pdf.url)) continue;
      seen.add(pdf.url);
      out.push(pdf);
    }
  }
  return out;
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
    const title = text || 'PDF';
    pdfs.push({
      title,
      url: abs,
      sizeKb: parsePdfSizeKb(text),
      kind: extractPdfKind(title),
    });
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

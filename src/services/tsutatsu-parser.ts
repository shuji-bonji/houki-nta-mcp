/**
 * Tsutatsu Parser — 国税庁通達セクションページの cheerio パーサ
 *
 * 入力: `nta-scraper.ts` がデコードした HTML 文字列
 * 出力: 章-項-号構造の `TsutatsuSection`
 *
 * 想定するページ:
 *  - 消費税法基本通達のセクションページ（例: /law/tsutatsu/kihon/shohi/01/01.htm）
 *  - 同形式の他の基本通達（所基通・法基通 等）も同じパーサで扱える想定
 *
 * 想定外:
 *  - 目次ページ（章一覧）→ Phase 1b' で別 parser
 *  - PDF 形式の通達 → 別 service
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import type {
  ParagraphIndent,
  TsutatsuClause,
  TsutatsuParagraph,
  TsutatsuSection,
} from '../types/tsutatsu.js';

/* -------------------------------------------------------------------------- */
/* public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 国税庁通達セクションページをパースして `TsutatsuSection` を組み立てる。
 *
 * @param html  デコード済み HTML 文字列
 * @param sourceUrl リクエスト URL（一次情報源として埋め込む）
 * @param fetchedAt ISO 8601 時刻。未指定なら `new Date().toISOString()`
 */
export function parseTsutatsuSection(
  html: string,
  sourceUrl: string,
  fetchedAt: string = new Date().toISOString()
): TsutatsuSection {
  const $ = cheerio.load(html);

  // <br> を改行に正規化（cheerio.text() が <br> を空文字にしてしまうため）
  $('br').replaceWith('\n');

  const pageTitle = $('title').first().text().trim();

  // 通達本体は `<div class="imp-cnt-tsutatsu" id="bodyArea">`。
  // セレクタが不安定でもいいよう id="bodyArea" 単独でもフォールバック。
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

  // ナビ要素を除去（breadcrumb, page-top-link 等）
  $body.find('ol.breadcrumb, .page-top-link').remove();

  const chapterTitle = extractChapterTitle($, $body);
  const sectionTitle = extractSectionTitle($, $body);
  const clauses = extractClauses($, $body);

  const section: TsutatsuSection = {
    sourceUrl,
    fetchedAt,
    pageTitle,
    sectionTitle,
    clauses,
  };
  if (chapterTitle !== undefined) {
    section.chapterTitle = chapterTitle;
  }
  return section;
}

/** パース失敗時の例外 */
export class TsutatsuParseError extends Error {
  public readonly sourceUrl: string;

  constructor(message: string, sourceUrl: string) {
    super(message);
    this.name = 'TsutatsuParseError';
    this.sourceUrl = sourceUrl;
  }
}

/* -------------------------------------------------------------------------- */
/* internal helpers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 章タイトルを抽出する。
 * 多くのページで `<p align="center"><strong>第N章　…</strong></p>` の形で出る。
 * 各セクションページの先頭にあるとは限らないため、見つからなくてもエラーにしない。
 */
function extractChapterTitle($: CheerioAPI, $body: cheerio.Cheerio<Element>): string | undefined {
  let result: string | undefined;
  $body.find('p').each((_, el) => {
    const $p = $(el);
    const text = normalizeWhitespace($p.text());
    if (/^第[0-9０-９]+章/.test(text) && text.length < 60) {
      result = text;
      return false; // break
    }
    return true;
  });
  return result;
}

/**
 * 節タイトルを抽出する。`<div class="page-header">` 配下の `<h1>` から拾う。
 * 見つからなければ `<title>` から「｜国税庁」を除いたテキストでフォールバック。
 */
function extractSectionTitle($: CheerioAPI, $body: cheerio.Cheerio<Element>): string {
  const fromH1 = normalizeWhitespace($body.find('.page-header h1').first().text());
  if (fromH1) return fromH1;

  const fromBodyH1 = normalizeWhitespace($body.find('h1').first().text());
  if (fromBodyH1) return fromBodyH1;

  const pageTitle = normalizeWhitespace($('title').first().text());
  return pageTitle.replace(/｜国税庁$/, '').trim();
}

/**
 * 各 clause を抽出する。
 *  1. `<h2>` を見つけたら新しい clause を開始
 *  2. 直後の `<p class="indent1">` 等から本文と clause 番号を取り出す
 *  3. 続く indent2/indent3/style ベースの段落を sub-paragraph として収集
 *  4. 次の `<h2>` が現れるか body 末尾に達したら clause を確定
 */
function extractClauses($: CheerioAPI, $body: cheerio.Cheerio<Element>): TsutatsuClause[] {
  const clauses: TsutatsuClause[] = [];

  // body の直下要素を順序通りに並べる
  // （ネストした div の中の h2 も拾えるよう descendant にする）
  const $h2s = $body.find('h2');

  $h2s.each((_, h2) => {
    const $h2 = $(h2);
    const titleRaw = normalizeWhitespace($h2.text());
    const title = stripParens(titleRaw);

    // 次の h2 までの要素を集める
    const followingEls = collectUntilNextH2($, $h2);

    if (followingEls.length === 0) {
      // 本文がない見出しは skip（footer 等の見出しが紛れる場合）
      return true;
    }

    const result = buildClauseFromFollowing($, followingEls);
    if (!result) return true;

    const { clauseNumber, paragraphs } = result;
    const fullText = [title, ...paragraphs.map((p) => p.text)].join('\n');

    clauses.push({
      clauseNumber,
      title,
      paragraphs,
      fullText,
    });
    return true;
  });

  return clauses;
}

/**
 * `<h2>` の次の兄弟以降を集めて、次の `<h2>` または `<h1>` の手前で止める。
 *
 * 所基通の節ページ（例: /shotoku/04/01.htm）は **同一ファイル内に複数の `<h1>`**
 * （別節タイトル）が並ぶ構造なので、h1 も境界に含める必要がある。h1 を境界に
 * しなければ、前 clause の paragraph に隣接節のタイトルが混入する。
 *
 * h2 が異なる親（div でラップ）の中にあっても対応するため、body 内の全要素の
 * DOM 順を組み立てて切り出す。
 */
function collectUntilNextH2(
  $: CheerioAPI,
  $h2: cheerio.Cheerio<Element>
): cheerio.Cheerio<Element>[] {
  const collected: cheerio.Cheerio<Element>[] = [];
  let node = $h2[0]?.nextSibling;
  while (node) {
    if (node.type === 'tag') {
      const el = node as Element;
      if (el.tagName === 'h2' || el.tagName === 'h1') break;
      // 所基通の節ページは別節タイトル <h1> が <div class="page-header"> でラップされて
      // 兄弟ノードとして登場する。これも境界として break する必要がある。
      if (el.tagName === 'div') {
        const $el = $(el);
        if ($el.is('.page-header') || $el.find('> h1, > h2').length > 0) break;
      }
      collected.push($(el));
    }
    node = node.nextSibling;
  }
  return collected;
}

/**
 * h2 直下に続く要素群から clause 番号と段落配列を構築する。
 * 最初の `p.indent1` を本文 (indent=1) とし、それ以降の段落を sub-paragraph として並べる。
 * 番号取得に失敗したら null を返してその clause を skip する。
 */
function buildClauseFromFollowing(
  $: CheerioAPI,
  followingEls: cheerio.Cheerio<Element>[]
): { clauseNumber: string; paragraphs: TsutatsuParagraph[] } | null {
  // 最初に出てくる p.indent1 を本文と見なす
  const $bodyP = followingEls.find(($el) => $el.is('p.indent1'));
  if (!$bodyP) return null;

  const rawText = normalizeWhitespace($bodyP.text());
  const parsed = extractClauseNumber(rawText);
  if (!parsed) return null;

  const { clauseNumber, body } = parsed;

  const paragraphs: TsutatsuParagraph[] = [{ indent: 1, text: body }];

  // body の後続要素から sub-paragraph を集める
  let foundBody = false;
  for (const $el of followingEls) {
    if (!foundBody) {
      if ($el.is('p.indent1')) {
        foundBody = true;
        continue;
      }
      // body p.indent1 より前の要素は無視（ノイズ対策）
      continue;
    }
    const indent = classifyIndent($el);
    if (indent === null) continue;
    const text = normalizeWhitespace($el.text());
    if (!text) continue;
    paragraphs.push({ indent, text });
  }

  return { clauseNumber, paragraphs };
}

/**
 * 段落要素のインデントレベルを判定する。
 * 該当しない要素（script / table 等）は null を返す。
 */
function classifyIndent($el: cheerio.Cheerio<Element>): ParagraphIndent | null {
  if ($el.is('p.indent1, div.indent1')) return 1;
  if ($el.is('p.indent2, div.indent2')) return 2;
  if ($el.is('p.indent3, div.indent3')) return 3;

  // style="margin-left: ..."ベースの段落（注 等）。indent=2 として扱う
  if ($el.is('p[style], div[style]')) {
    const style = $el.attr('style') ?? '';
    if (/margin-left/i.test(style)) return 2;
  }

  // クラスも style も無い p は本文に絡むことがあるので 2 とみなす
  if ($el.is('p, div')) {
    const text = $el.text().trim();
    if (text.length > 0) return 2;
  }

  return null;
}

/**
 * `1－4－13の2 本文…` の形から clauseNumber と本文を切り出す。
 *
 * 全角ハイフン `－` (U+FF0D) はパース後 ASCII `-` に正規化する。
 *
 * 対応形式（所基通の実調査結果より）:
 *  - 消基通: `1-4-1` / `1－4－13の2` / `11-5-7`（章-節-条 3 階層）
 *  - 所基通: `2-1` / `2-4の2` / `2-4の3`（条-項 2 階層）
 *  - 所基通: `23-1` / `24-6の2` / `90-2` / `161-1の2` / `161-1の3`（複数バリエーション）
 *  - 所基通源泉: `183～193共-1` / `204～206共-2`（複数条の共通通達。`～` は U+301C / U+FF5E、`共` を含む）
 */
export function extractClauseNumber(
  rawText: string
): { clauseNumber: string; body: string } | null {
  const trimmed = rawText.replace(/^\s+/, '');

  // 「183～193共－1」形式（複数条共通通達）の検出を先に試みる。
  // ～ には U+301C, U+30FC, U+FF5E のいずれも入りうる（HTML エンコードのゆらぎを許容）
  // `s` フラグ: <br>→改行 含みの本文末尾まで取り込めるよう dotall にする。
  const kyoMatch = trimmed.match(
    /^([0-9０-９]+[〜ー～～][0-9０-９]+共[-－][0-9０-９]+(?:の[0-9０-９]+)?)([\s　]*)(.*)$/s
  );
  if (kyoMatch) {
    return {
      clauseNumber: normalizeClauseNumber(kyoMatch[1]),
      body: kyoMatch[3].trim(),
    };
  }

  // 通常形式: "1－1－1" / "1－4－13の2" / "23-1" / "2-4の2"
  const match = trimmed.match(
    /^([0-9０-９]+(?:[-－][0-9０-９]+)+(?:の[0-9０-９]+)?)([\s　]*)(.*)$/s
  );
  if (!match) return null;

  return {
    clauseNumber: normalizeClauseNumber(match[1]),
    body: match[3].trim(),
  };
}

/** 全角ハイフン → ASCII、全角数字 → 半角数字に正規化。`～` `共` はそのまま残す */
function normalizeClauseNumber(s: string): string {
  return s
    .replace(/－/g, '-')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/** 全角／半角空白の連続をスペース 1 つに、改行はトリム。前後 trim 済み */
function normalizeWhitespace(s: string): string {
  return s
    .replace(/　/g, ' ') // 全角スペース → 半角スペース
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * `（…）` の全角カッコを剥がす。半角の () も対応。
 * 例: "（個人事業者と給与所得者の区分）" → "個人事業者と給与所得者の区分"
 */
function stripParens(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^（(.*)）$/s) ?? trimmed.match(/^\((.*)\)$/s);
  return m ? m[1].trim() : trimmed;
}

/**
 * Kaisei Index Parser — 改正通達一覧（kaisei_*.htm）から個別ページのリンクを抽出
 *
 * 入力例: `/law/tsutatsu/kihon/{税目}/kaisei/kaisei_a.htm`
 *
 * 観察される HTML 構造:
 *   <div class="imp-cnt" id="bodyArea">                ← 通達 TOC とは違う class（imp-cnt のみ）
 *     <h1>消費税法 一部改正通達</h1>
 *     ...
 *     <a href="/law/tsutatsu/kihon/shohi/kaisei/0026003-067/index.htm">
 *       消費税法基本通達の一部改正について（法令解釈通達）（令和8年4月1日）
 *     </a>
 *     ...
 *   </div>
 *
 * 個別改正通達 URL のパターン: `/kaisei/{文書ID}/index.htm`
 *   - 新形式: `0026003-067` (10 桁ハイフン区切り)
 *   - 旧形式: `240401` (年月日 6 桁)
 */

import * as cheerio from 'cheerio';

import { TsutatsuParseError } from './tsutatsu-parser.js';
import { normalizeJpText } from './text-normalize.js';
import type { KaiseiIndexEntry } from '../types/document.js';

/** 改正通達索引の HTML をパースして個別ページ URL のリストを返す */
export function parseKaiseiIndex(html: string, sourceUrl: string): KaiseiIndexEntry[] {
  const $ = cheerio.load(html);
  // 改正索引は `imp-cnt` だが、念のため tsutatsu 系もフォールバック
  const $body =
    $('div.imp-cnt#bodyArea').first().length > 0
      ? $('div.imp-cnt#bodyArea').first()
      : $('div.imp-cnt-tsutatsu#bodyArea').first().length > 0
        ? $('div.imp-cnt-tsutatsu#bodyArea').first()
        : $('#bodyArea').first();

  if ($body.length === 0) {
    throw new TsutatsuParseError(
      '改正通達索引本体 (div.imp-cnt#bodyArea) が見つかりません',
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
    // /kaisei/{ID}/index.htm 形式の個別改正通達リンクのみ対象
    // kaisei_a.htm（自身）や法令等メニュー系は除外
    if (!/\/kaisei\/[^/]+\/index\.htm$/.test(href)) return;

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
 * タイトルから発出日を抽出する。
 *
 * 国税庁のタイトル末尾には「（令和8年4月1日）」「（平成30年4月1日）」のような
 * 元号付き日付が頻出する。これを ISO 8601 (YYYY-MM-DD) に変換する。
 *
 * 抽出できない場合は undefined を返す（生 fixture を見ると一定割合で抽出不能なものがある）。
 */
export function extractIssuedAt(title: string): string | undefined {
  // 全角数字を含むタイトル（例: 「令和７年４月１日」）にも対応するため、
  // 先に Normalize-everywhere を通して半角化する。
  const normalized = normalizeJpText(title);
  // 「（令和8年4月1日）」「(令和8年4月1日)」「令和8年4月1日」
  const m = normalized.match(
    /(?:（|\()?\s*(令和|平成|昭和|大正|明治)\s*(\d+|元)\s*年\s*(\d+)\s*月\s*(\d+)\s*日\s*(?:）|\))?/
  );
  if (!m) return undefined;
  const era = m[1];
  const yearRaw = m[2] === '元' ? 1 : parseInt(m[2], 10);
  const month = parseInt(m[3], 10);
  const day = parseInt(m[4], 10);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return undefined;
  }
  // 元号 → 西暦
  const eraOffsets: Record<string, number> = {
    令和: 2018,
    平成: 1988,
    昭和: 1925,
    大正: 1911,
    明治: 1867,
  };
  const offset = eraOffsets[era];
  if (offset === undefined) return undefined;
  const year = offset + yearRaw;
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** 改正通達 URL から doc_id を抽出。例: '/kaisei/0026003-067/index.htm' → '0026003-067' */
export function extractDocIdFromUrl(url: string): string | undefined {
  const m = url.match(/\/kaisei\/([^/]+)\/index\.htm/);
  return m ? m[1] : undefined;
}

/** 改正通達 URL から税目を抽出。例: '/law/tsutatsu/kihon/shohi/kaisei/...' → 'shohi' */
export function extractTaxonomyFromUrl(url: string): string | undefined {
  const m = url.match(/\/law\/tsutatsu\/kihon\/([^/]+(?:\/[^/]+)?)\/kaisei\//);
  return m ? m[1] : undefined;
}

function cleanText(s: string): string {
  return s.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
}

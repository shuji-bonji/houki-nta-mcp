/**
 * Tsutatsu Menu Parser — `/law/tsutatsu/menu.htm` から現存する通達一覧を抽出する。
 *
 * Phase 5 Resilience Lv-3b の中核。menu.htm は国税庁が運用する**現役の通達インデックス**で、
 * 世代移行 (`sozoku` → `sozoku2`, `hyoka` → `hyoka_new`) を含めて
 * 「今のところ生きている本体・改正履歴」のリンクが UTF-8 で列挙されている。
 *
 * これを真の正典として扱い、CANARY_TARGETS の URL が menu に登場しているかを突き合わせれば、
 * 世代移行が起きていることを **soft-404 を踏む前に** 検知できる。
 *
 * 観察される URL 形式 (2026-05 時点):
 *   - 本体: `/law/tsutatsu/kihon/{tax}/01.htm` (`shohi`, `shotoku`, `hojin`, `sozoku2` ...)
 *   - 本体 (sisan 配下): `/law/tsutatsu/kihon/sisan/{tax}/01.htm` (`hyoka_new`, `sozoku2`, `hyoka`)
 *   - 改正履歴: `/law/tsutatsu/kihon/{tax}/kaisei/kaisei_*.htm` (旧 sozoku は本体消滅後も kaisei だけ残る)
 *   - mokuji / index 系: `/law/tsutatsu/kihon/{tax}/{mokuji|index}.htm`
 */

import * as cheerio from 'cheerio';

/** menu.htm から抽出した 1 entry */
export interface MenuEntry {
  /** 絶対 URL */
  url: string;
  /** menu.htm 上のテキスト (リンク文言) */
  label: string;
  /** `/law/tsutatsu/kihon/` 配下なら true (= 通達系) */
  isKihon: boolean;
  /**
   * 本体エントリ (改正履歴・索引でない、章本文ページ) と推定されるなら true。
   * 判定: URL が `/kaisei/` を含まない、かつ末尾が `\d{2}.htm` / `index.htm` / `mokuji.htm` のいずれか。
   */
  isMainBody: boolean;
  /**
   * URL を `/kihon/...` 以下に絞ったセグメント。世代比較に使う。
   *
   * 例:
   *   /law/tsutatsu/kihon/sisan/sozoku2/01.htm → ['sisan', 'sozoku2', '01.htm']
   *   /law/tsutatsu/kihon/hojin/kaisei/kaisei_a.htm → ['hojin', 'kaisei', 'kaisei_a.htm']
   */
  kihonSegments: string[];
}

/** Menu パース失敗時 */
export class MenuParseError extends Error {
  public readonly sourceUrl: string;
  constructor(message: string, sourceUrl: string) {
    super(message);
    this.name = 'MenuParseError';
    this.sourceUrl = sourceUrl;
  }
}

/**
 * `menu.htm` の HTML 文字列をパースして全リンクを抽出する。
 *
 * `kihon/` 以外 (`shitsugi/`, `chien/` などの他系統) も拾うが、`isKihon` フラグで区別できる。
 * baseline drift 検知では `isKihon === true` のみ対象にすれば足りる。
 *
 * @param html UTF-8 にデコード済みの HTML
 * @param sourceUrl リンク解決の base
 * @throws {MenuParseError} 本体が見つからないか、`a[href]` が 0 件のとき
 */
export function parseTsutatsuMenu(html: string, sourceUrl: string): MenuEntry[] {
  const $ = cheerio.load(html);

  // メイン本体: 多くの NTA ページと同じく #bodyArea。class は menu.htm では imp-cnt のはず。
  const $body = $('#bodyArea').first().length > 0 ? $('#bodyArea').first() : $('body').first();
  if ($body.length === 0) {
    throw new MenuParseError('menu 本体 (#bodyArea) が見つかりません', sourceUrl);
  }

  $body.find('ol.breadcrumb, .page-top-link, script, style').remove();

  const seen = new Set<string>();
  const entries: MenuEntry[] = [];

  $body.find('a[href]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href');
    if (!href) return;
    // mailto:, tel:, # 内部リンクは除外
    if (/^(?:mailto:|tel:|javascript:|#)/i.test(href)) return;

    let abs: string;
    try {
      abs = new URL(href, sourceUrl).toString();
    } catch {
      return;
    }
    if (seen.has(abs)) return;
    seen.add(abs);

    const label = $a.text().trim().replace(/\s+/g, ' ');

    const kihonSegments = extractKihonSegments(abs);
    const isKihon = kihonSegments.length > 0;
    const isMainBody = isKihon && classifyMainBody(kihonSegments);

    entries.push({ url: abs, label, isKihon, isMainBody, kihonSegments });
  });

  if (entries.length === 0) {
    throw new MenuParseError('menu からリンクを 1 件も抽出できませんでした', sourceUrl);
  }

  return entries;
}

/**
 * URL から `kihon/` 配下のセグメント (税目, サブディレクトリ, ファイル名) を抽出する。
 * `kihon/` 配下でない場合は空配列を返す。
 *
 * 例:
 *   /law/tsutatsu/kihon/sisan/sozoku2/01.htm → ['sisan', 'sozoku2', '01.htm']
 *   /law/tsutatsu/kihon/shohi/01.htm        → ['shohi', '01.htm']
 *   /law/tsutatsu/kihon/hojin/kaisei/kaisei_a.htm → ['hojin', 'kaisei', 'kaisei_a.htm']
 *   /law/shitsugi/shohi/02/19.htm           → []
 */
export function extractKihonSegments(absoluteUrl: string): string[] {
  try {
    const u = new URL(absoluteUrl);
    if (!u.hostname.endsWith('nta.go.jp')) return [];
    const idx = u.pathname.indexOf('/law/tsutatsu/kihon/');
    if (idx < 0) return [];
    const tail = u.pathname.slice(idx + '/law/tsutatsu/kihon/'.length);
    return tail.split('/').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * `kihonSegments` を見て「本体 (章/節の本文) っぽい」エントリかを推定する。
 *
 * - `kaisei/` を含む → false (改正履歴)
 * - 末尾が `mokuji.htm` / `index.htm` / `\d+.htm` / `\d+_\d+.htm` → true (章/節 or 目次)
 * - それ以外 → false (補足ページ等)
 */
function classifyMainBody(segments: string[]): boolean {
  if (segments.includes('kaisei')) return false;
  const last = segments[segments.length - 1] ?? '';
  if (last === 'mokuji.htm' || last === 'index.htm') return true;
  // 01.htm, 12.htm, 00.htm, 01_03.htm (法基通形式) などを拾う
  if (/^\d{1,3}(?:_\d{1,3})?\.htm$/.test(last)) return true;
  return false;
}

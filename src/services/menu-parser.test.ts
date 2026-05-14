import { describe, it, expect } from 'vitest';

import { parseTsutatsuMenu, extractKihonSegments, MenuParseError } from './menu-parser.js';

const MENU_URL = 'https://www.nta.go.jp/law/tsutatsu/menu.htm';

/* -------------------------------------------------------------------------- */
/* extractKihonSegments                                                       */
/* -------------------------------------------------------------------------- */

describe('extractKihonSegments', () => {
  it('kihon/ 配下の URL からセグメントを抽出する', () => {
    expect(extractKihonSegments('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01.htm')).toEqual([
      'shohi',
      '01.htm',
    ]);
    expect(
      extractKihonSegments('https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/01.htm')
    ).toEqual(['sisan', 'sozoku2', '01.htm']);
    expect(
      extractKihonSegments('https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01/01_03.htm')
    ).toEqual(['hojin', '01', '01_03.htm']);
    expect(
      extractKihonSegments('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei_a.htm')
    ).toEqual(['shohi', 'kaisei', 'kaisei_a.htm']);
  });

  it('kihon/ 配下でない URL は空配列', () => {
    expect(extractKihonSegments('https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm')).toEqual([]);
    expect(extractKihonSegments('https://www.nta.go.jp/law/jimu-unei/jimu.htm')).toEqual([]);
  });

  it('nta.go.jp 外のホストは空配列', () => {
    expect(extractKihonSegments('https://example.com/law/tsutatsu/kihon/shohi/01.htm')).toEqual([]);
  });

  it('壊れた URL は空配列で fail させない', () => {
    expect(extractKihonSegments('not a url')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* parseTsutatsuMenu                                                          */
/* -------------------------------------------------------------------------- */

describe('parseTsutatsuMenu', () => {
  // menu.htm の縮小再現 (本物にあるパターンを最小単位で網羅)
  const SAMPLE_MENU = `
    <html><body>
      <table>
        <tr>
          <td><a href="/law/tsutatsu/kihon/shohi/01.htm">消費税法基本通達</a></td>
          <td><a href="/law/tsutatsu/kihon/shohi/kaisei/kaisei_a.htm">改正通達</a></td>
        </tr>
        <tr>
          <td><a href="/law/tsutatsu/kihon/hojin/01.htm">法人税基本通達</a></td>
          <td><a href="/law/tsutatsu/kihon/hojin/kaisei/kaisei_a.htm">一部改正通達</a></td>
        </tr>
        <tr>
          <td><a href="/law/tsutatsu/kihon/sisan/sozoku2/01.htm">相続税法</a></td>
          <td><a href="/law/tsutatsu/kihon/sisan/sozoku/kaisei/kaisei_a.htm">一部改正通達</a></td>
        </tr>
        <!-- 旧版はコメントアウト (本物の menu.htm でも同じ形で死蔵されている) -->
        <!-- <tr><td><a href="/law/tsutatsu/kihon/sisan/hyoka/01.htm">財産評価 (旧)</a></td></tr> -->
        <tr>
          <td><a href="/law/tsutatsu/kihon/sisan/hyoka_new/01.htm">財産評価 (新)</a></td>
        </tr>
        <tr>
          <td><a href="/law/tsutatsu/kihon/hojin/01.htm#a-01-03">法基通 第1章第3節</a></td>
        </tr>
        <tr>
          <td><a href="mailto:foo@bar.com">問い合わせ</a></td>
          <td><a href="#top">ページ先頭</a></td>
          <td><a href="/law/shitsugi/shohi/02/19.htm">質疑応答事例</a></td>
        </tr>
      </table>
    </body></html>
  `;

  it('全 a[href] を抽出して MenuEntry 配列を返す', () => {
    const entries = parseTsutatsuMenu(SAMPLE_MENU, MENU_URL);
    // mailto: と #top は除外され、コメント内は cheerio が解釈しない
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => /^https?:\/\//.test(e.url))).toBe(true);
  });

  it('コメントアウトされたリンクは抽出しない (cheerio がコメントを解釈しないため)', () => {
    const entries = parseTsutatsuMenu(SAMPLE_MENU, MENU_URL);
    const hyokaOld = entries.find((e) => e.url.endsWith('/sisan/hyoka/01.htm'));
    expect(hyokaOld).toBeUndefined();
  });

  it('hyoka_new (新世代) は kihon entry として抽出される', () => {
    const entries = parseTsutatsuMenu(SAMPLE_MENU, MENU_URL);
    const hyokaNew = entries.find((e) => e.url.endsWith('/sisan/hyoka_new/01.htm'));
    expect(hyokaNew).toBeDefined();
    expect(hyokaNew?.isKihon).toBe(true);
    expect(hyokaNew?.isMainBody).toBe(true);
    expect(hyokaNew?.kihonSegments).toEqual(['sisan', 'hyoka_new', '01.htm']);
  });

  it('kaisei パスは isMainBody=false で本体と区別される', () => {
    const entries = parseTsutatsuMenu(SAMPLE_MENU, MENU_URL);
    const kaisei = entries.find((e) => e.url.endsWith('/sisan/sozoku/kaisei/kaisei_a.htm'));
    expect(kaisei).toBeDefined();
    expect(kaisei?.isKihon).toBe(true);
    expect(kaisei?.isMainBody).toBe(false);
  });

  it('shitsugi (質疑応答事例) は isKihon=false', () => {
    const entries = parseTsutatsuMenu(SAMPLE_MENU, MENU_URL);
    const shitsugi = entries.find((e) => e.url.endsWith('/shitsugi/shohi/02/19.htm'));
    expect(shitsugi).toBeDefined();
    expect(shitsugi?.isKihon).toBe(false);
  });

  it('mailto: / #top のような non-http リンクは除外', () => {
    const entries = parseTsutatsuMenu(SAMPLE_MENU, MENU_URL);
    expect(entries.find((e) => e.url.startsWith('mailto:'))).toBeUndefined();
    // hash-only link は base URL に解決されて重複扱いで dedupe される
    const hashOnly = entries.find((e) => e.url.endsWith('#top'));
    expect(hashOnly).toBeUndefined();
  });

  it('a[href] が 0 件なら MenuParseError', () => {
    expect(() => parseTsutatsuMenu('<html><body></body></html>', MENU_URL)).toThrowError(
      MenuParseError
    );
  });

  it('同一 URL は重複排除される (Set で dedupe)', () => {
    const dup = `
      <html><body>
        <a href="/law/tsutatsu/kihon/shohi/01.htm">A</a>
        <a href="/law/tsutatsu/kihon/shohi/01.htm">B</a>
      </body></html>
    `;
    const entries = parseTsutatsuMenu(dup, MENU_URL);
    const shohi = entries.filter((e) => e.url.endsWith('/shohi/01.htm'));
    expect(shohi).toHaveLength(1);
  });

  it('hojin/01.htm#a-01-03 のようなフラグメント付き URL も正規 URL として保持される', () => {
    const entries = parseTsutatsuMenu(SAMPLE_MENU, MENU_URL);
    const withHash = entries.find((e) => e.url.includes('#a-01-03'));
    expect(withHash).toBeDefined();
    // フラグメント含む URL の segments は、URL クラスが path のみ抽出するので影響しない
    expect(withHash?.kihonSegments).toEqual(['hojin', '01.htm']);
  });
});

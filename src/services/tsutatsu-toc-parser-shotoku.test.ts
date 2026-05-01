import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseTsutatsuTocShotoku } from './tsutatsu-toc-parser-shotoku.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

const FIX_TOC = 'www.nta.go.jp_law_tsutatsu_kihon_shotoku_01.htm';
const TOC_URL = 'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/01.htm';

describe('parseTsutatsuTocShotoku — 所基通の TOC ページ', () => {
  const html = loadFixture(FIX_TOC);
  const toc = parseTsutatsuTocShotoku(html, TOC_URL, '2026-04-30T00:00:00.000Z');

  it('メタ情報を抽出する', () => {
    expect(toc.sourceUrl).toBe(TOC_URL);
    expect(toc.fetchedAt).toBe('2026-04-30T00:00:00.000Z');
    expect(toc.pageTitle).toContain('所得税基本通達');
  });

  it('章は編をまたいで 1 から連番化される', () => {
    expect(toc.chapters.length).toBeGreaterThan(0);
    toc.chapters.forEach((ch, i) => {
      expect(ch.number).toBe(i + 1);
    });
  });

  it('章タイトルに編情報がプレフィックスされる', () => {
    const ch1 = toc.chapters[0];
    expect(ch1.title).toMatch(/^第1編/);
    expect(ch1.title).toContain('通則');
  });

  it('section URL は絶対 URL かつ /law/tsutatsu/kihon/ 配下', () => {
    for (const ch of toc.chapters) {
      expect(ch.sections.length).toBeGreaterThan(0);
      for (const s of ch.sections) {
        expect(s.url).toBeDefined();
        expect(s.url!).toMatch(/^https:\/\/www\.nta\.go\.jp\/law\/tsutatsu\/kihon\/shotoku\//);
        expect(s.url!).not.toContain('#');
      }
    }
  });

  it('第1章 配下に 8 節があり、最初の節は 01/01.htm を指す', () => {
    const ch1 = toc.chapters[0];
    expect(ch1.sections.length).toBe(8);
    expect(ch1.sections[0].url).toBe('https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/01/01.htm');
  });

  it('全セクション数の合計は 100 を超える（網羅性チェック）', () => {
    const total = toc.chapters.reduce((acc, ch) => acc + ch.sections.length, 0);
    expect(total).toBeGreaterThan(100);
  });
});

describe('parseTsutatsuTocShotoku — エラー系', () => {
  it('通達本体が見つからない場合 TsutatsuParseError', () => {
    const html = '<!doctype html><html><body><p>これは通達じゃない</p></body></html>';
    expect(() => parseTsutatsuTocShotoku(html, 'https://example.com/x')).toThrow(
      TsutatsuParseError
    );
  });
});

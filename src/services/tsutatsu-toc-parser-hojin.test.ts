import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseTsutatsuTocHojin } from './tsutatsu-toc-parser-hojin.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

const FIX_TOC = 'www.nta.go.jp_law_tsutatsu_kihon_hojin_01.htm';
const TOC_URL = 'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01.htm';

describe('parseTsutatsuTocHojin — 法基通の TOC ページ', () => {
  const html = loadFixture(FIX_TOC);
  const toc = parseTsutatsuTocHojin(html, TOC_URL, '2026-05-01T00:00:00.000Z');

  it('メタ情報を抽出する', () => {
    expect(toc.sourceUrl).toBe(TOC_URL);
    expect(toc.fetchedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(toc.pageTitle).toContain('法人税法');
  });

  it('章は連番化され、合計 20 章以上を抽出する', () => {
    expect(toc.chapters.length).toBeGreaterThanOrEqual(20);
    toc.chapters.forEach((ch, i) => {
      expect(ch.number).toBe(i + 1);
    });
  });

  it('章タイトルに「第N章 ...」プレフィックスが含まれる', () => {
    const ch1 = toc.chapters[0];
    expect(ch1.title).toMatch(/^第1章\s/);
    expect(ch1.title).toContain('総則');
  });

  it('「第12章の2」のような枝番章も拾える', () => {
    const eda = toc.chapters.find((c) => c.title.includes('12章 の2'));
    expect(eda).toBeDefined();
    expect(eda!.title).toContain('組織再編成');
  });

  it('section URL は絶対 URL かつ /law/tsutatsu/kihon/hojin/ 配下', () => {
    for (const ch of toc.chapters) {
      for (const s of ch.sections) {
        expect(s.url).toBeDefined();
        expect(s.url!).toMatch(/^https:\/\/www\.nta\.go\.jp\/law\/tsutatsu\/kihon\/hojin\//);
        expect(s.url!).not.toContain('#');
      }
    }
  });

  it('第1章 配下に 9 節があり、最初の節は 01_01.htm を指す', () => {
    const ch1 = toc.chapters[0];
    expect(ch1.sections.length).toBe(9);
    expect(ch1.sections[0].url).toBe('https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01/01_01.htm');
  });

  it('全セクション数の合計は 200 を超える（網羅性チェック）', () => {
    const total = toc.chapters.reduce((acc, ch) => acc + ch.sections.length, 0);
    expect(total).toBeGreaterThan(200);
  });
});

describe('parseTsutatsuTocHojin — エラー系', () => {
  it('通達本体が見つからない場合 TsutatsuParseError', () => {
    const html = '<!doctype html><html><body><p>これは通達じゃない</p></body></html>';
    expect(() => parseTsutatsuTocHojin(html, 'https://example.com/x')).toThrow(TsutatsuParseError);
  });
});

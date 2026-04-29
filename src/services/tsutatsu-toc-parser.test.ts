import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseTsutatsuToc } from './tsutatsu-toc-parser.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

const FIX_TOC = 'www.nta.go.jp_law_tsutatsu_kihon_shohi_01.htm';
const TOC_URL = 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01.htm';

describe('parseTsutatsuToc — 消基通の TOC ページ', () => {
  const html = loadFixture(FIX_TOC);
  const toc = parseTsutatsuToc(html, TOC_URL, '2026-04-29T00:00:00.000Z');

  it('メタ情報を抽出する', () => {
    expect(toc.sourceUrl).toBe(TOC_URL);
    expect(toc.fetchedAt).toBe('2026-04-29T00:00:00.000Z');
    expect(toc.pageTitle).toContain('消費税法基本通達');
  });

  it('章を 21 件抽出する', () => {
    expect(toc.chapters).toHaveLength(21);
  });

  it('第1章 納税義務者 配下に 8 節がある', () => {
    const ch1 = toc.chapters.find((c) => c.number === 1)!;
    expect(ch1).toBeDefined();
    expect(ch1.title).toBe('納税義務者');
    expect(ch1.sections.length).toBe(8);
    expect(ch1.sections[0]).toMatchObject({
      number: 1,
      title: '個人事業者の納税義務',
      url: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/01.htm',
    });
  });

  it('款を持つ節（第5章 第3節 みなし譲渡）を階層化する', () => {
    const ch5 = toc.chapters.find((c) => c.number === 5)!;
    const sec3 = ch5.sections.find((s) => s.number === 3)!;
    expect(sec3.title).toBe('みなし譲渡');
    expect(sec3.url).toBeUndefined(); // 節レベルの URL は無し
    expect(sec3.subsections).toBeDefined();
    expect(sec3.subsections!.length).toBe(2);
    expect(sec3.subsections![0]).toMatchObject({
      number: 1,
      title: '個人事業者の家事消費等',
      url: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/05/03/01.htm',
    });
  });

  it('href を絶対 URL に正規化する', () => {
    for (const ch of toc.chapters) {
      for (const s of ch.sections) {
        if (s.url) {
          expect(s.url).toMatch(/^https:\/\/www\.nta\.go\.jp/);
        }
        for (const sub of s.subsections ?? []) {
          if (sub.url) {
            expect(sub.url).toMatch(/^https:\/\/www\.nta\.go\.jp/);
          }
        }
      }
    }
  });

  it('「削除」のように URL が無い節は url undefined のまま', () => {
    // 第9章 第2節 「削除」（消費税改正で消えた節）
    const ch9 = toc.chapters.find((c) => c.number === 9)!;
    const sec2 = ch9.sections.find((s) => s.number === 2);
    expect(sec2).toBeDefined();
    expect(sec2?.title).toBe('削除');
    expect(sec2?.url).toBeUndefined();
  });
});

describe('parseTsutatsuToc — エラー系', () => {
  it('通達本体が見つからない場合 TsutatsuParseError', () => {
    const html = '<!doctype html><html><body><p>これは通達じゃない</p></body></html>';
    expect(() => parseTsutatsuToc(html, 'https://example.com/x')).toThrow(TsutatsuParseError);
  });
});

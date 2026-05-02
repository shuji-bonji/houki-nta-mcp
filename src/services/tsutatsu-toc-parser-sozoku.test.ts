import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseTsutatsuTocSozoku } from './tsutatsu-toc-parser-sozoku.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

const FIX_TOC = 'www.nta.go.jp_law_tsutatsu_kihon_sisan_sozoku2_01.htm';
const TOC_URL = 'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/01.htm';

describe('parseTsutatsuTocSozoku — 相基通の TOC ページ', () => {
  const html = loadFixture(FIX_TOC);
  const toc = parseTsutatsuTocSozoku(html, TOC_URL, '2026-05-01T00:00:00.000Z');

  it('メタ情報を抽出する', () => {
    expect(toc.sourceUrl).toBe(TOC_URL);
    expect(toc.fetchedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(toc.pageTitle).toContain('相続税法基本通達');
  });

  it('章は 7 件抽出される', () => {
    expect(toc.chapters.length).toBe(7);
    toc.chapters.forEach((ch, i) => {
      expect(ch.number).toBe(i + 1);
    });
  });

  it('第1章 総則 配下に 11 ファイル URL が紐づく', () => {
    const ch1 = toc.chapters[0];
    expect(ch1.title).toMatch(/^第1章/);
    expect(ch1.title).toContain('総則');
    expect(ch1.sections.length).toBe(11);
  });

  it('section.title に「節 / 条グループ / clause タイトル」が複合される', () => {
    const ch1 = toc.chapters[0];
    // 第1節通則 配下のいずれかに第1条の3関係が含まれる
    const sec = ch1.sections.find((s) => s.title.includes('第1条の3'));
    expect(sec).toBeDefined();
    expect(sec!.title).toContain('「個人」の意義');
  });

  it('section URL は絶対 URL かつ /law/tsutatsu/kihon/sisan/sozoku2/ 配下', () => {
    for (const ch of toc.chapters) {
      for (const s of ch.sections) {
        expect(s.url).toBeDefined();
        expect(s.url!).toMatch(
          /^https:\/\/www\.nta\.go\.jp\/law\/tsutatsu\/kihon\/sisan\/sozoku2\//
        );
        expect(s.url!).not.toContain('#');
      }
    }
  });

  it('全セクション数（unique HTM ファイル）の合計は 30 を超える', () => {
    const total = toc.chapters.reduce((acc, ch) => acc + ch.sections.length, 0);
    expect(total).toBeGreaterThanOrEqual(30);
  });
});

describe('parseTsutatsuTocSozoku — エラー系', () => {
  it('通達本体が見つからない場合 TsutatsuParseError', () => {
    const html = '<!doctype html><html><body><p>これは通達じゃない</p></body></html>';
    expect(() => parseTsutatsuTocSozoku(html, 'https://example.com/x')).toThrow(TsutatsuParseError);
  });
});

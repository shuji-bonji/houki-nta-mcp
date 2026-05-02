/**
 * 相基通の節ページに対する parseTsutatsuSection の互換性テスト。
 *
 * Phase 2d-5 で extractClauseNumber を「ナカグロ複数条共通 (1の3・1の4共-1)」
 * 形式に拡張した結果、既存 parser がそのまま動くことを fixtures で恒久的に保証する。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseTsutatsuSection, extractClauseNumber } from './tsutatsu-parser.js';

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

describe('extractClauseNumber — 相基通の追加バリエーション', () => {
  it('ナカグロ複数条共通通達の clause 番号: 1の3・1の4共-1', () => {
    expect(extractClauseNumber('1の3・1の4共－1 「個人」の意義')).toEqual({
      clauseNumber: '1の3・1の4共-1',
      body: '「個人」の意義',
    });
  });

  it('ナカグロ複数条共通: 2・2の2共-1', () => {
    expect(extractClauseNumber('2・2の2共－1 財産の所在の判定')).toEqual({
      clauseNumber: '2・2の2共-1',
      body: '財産の所在の判定',
    });
  });

  it('「の付き」階層番号: 1の2-1', () => {
    expect(extractClauseNumber('1の2－1 「扶養義務者」の意義')).toEqual({
      clauseNumber: '1の2-1',
      body: '「扶養義務者」の意義',
    });
  });

  it('シンプルな相基通形式: 23の2-3', () => {
    expect(extractClauseNumber('23の2－3 相続開始前に増改築がされた場合の…')).toEqual({
      clauseNumber: '23の2-3',
      body: '相続開始前に増改築がされた場合の…',
    });
  });
});

describe('parseTsutatsuSection — 相基通 fixtures', () => {
  it('01/00.htm: 第1条の2 関係 — 1の2-1 が 1 件抽出される', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_sisan_sozoku2_01_00.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/01_00');

    expect(sec.clauses.length).toBe(1);
    expect(sec.clauses[0].clauseNumber).toBe('1の2-1');
    expect(sec.clauses[0].title).toContain('扶養義務者');
  });

  it('01/01.htm: 第1条の3・第1条の4 共通関係 — 12 件のナカグロ複数条共通 clauses（末尾に 2・2の2共-1 が同居）', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_sisan_sozoku2_01_01.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/01_01');

    expect(sec.clauses.length).toBe(12);
    expect(sec.clauses[0].clauseNumber).toBe('1の3・1の4共-1');
    expect(sec.clauses[0].title).toContain('個人');
    // 11 件は「1の3・1の4共-」、最後の 1 件は「2・2の2共-」（同一ファイルに別グループの clause が同居）
    const grp1 = sec.clauses.filter((c) => /^1の3・1の4共-/.test(c.clauseNumber));
    const grp2 = sec.clauses.filter((c) => /^2・2の2共-/.test(c.clauseNumber));
    expect(grp1.length).toBe(11);
    expect(grp2.length).toBe(1);
    // 全 clause が「ナカグロ + 共-」形式に従う
    for (const c of sec.clauses) {
      expect(c.clauseNumber).toMatch(/共-/);
    }
  });

  it('03/01.htm: 1 ファイルに複数の条グループが同居 — 13 件抽出', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_sisan_sozoku2_03_01.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/03_01');

    expect(sec.clauses.length).toBe(13);
    // 第23条、第23条の2、第24条 …が全部入っている
    expect(sec.clauses.find((c) => c.clauseNumber === '23-1')).toBeDefined();
    expect(sec.clauses.find((c) => c.clauseNumber === '23の2-1')).toBeDefined();
    expect(sec.clauses.find((c) => c.clauseNumber === '24-1')).toBeDefined();
  });

  it('04/01.htm: 第27条 関係 — 24 件のシンプル形式', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_sisan_sozoku2_04_01.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/04_01');

    expect(sec.clauses.length).toBe(24);
    expect(sec.clauses[0].clauseNumber).toBe('27-1');
  });
});

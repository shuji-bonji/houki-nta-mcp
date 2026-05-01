/**
 * 法基通の節ページに対する parseTsutatsuSection の互換性テスト。
 *
 * Phase 2d-4 で「法基通の clause 番号体系は消基通と同じ 3 階層 (`{章}-{節/款}-{条}`)」と
 * 確認できたため、既存 parser がそのまま動くことを fixtures で恒久的に保証する。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseTsutatsuSection } from './tsutatsu-parser.js';

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

describe('parseTsutatsuSection — 法基通 fixtures', () => {
  it('01/01_01.htm: 第1章第1節 納税地 — 12 件の clause を抽出する', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_hojin_01_01_01.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/01_01_01');

    expect(sec.clauses.length).toBe(12);
    expect(sec.clauses[0].clauseNumber).toBe('1-1-1');
    expect(sec.chapterTitle).toContain('第1章 総則');
  });

  it('02/02_01_01.htm: 第2章 第1款 収益計上の通則 — 16 件の clause を抽出する', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_hojin_02_02_01_01.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/02_01_01');

    expect(sec.clauses.length).toBe(16);
    expect(sec.clauses[0].clauseNumber).toBe('2-1-1');
  });

  it('02/02_01_01_2.htm: 「第1款の2」枝番款 — 3 件の clause を抽出する', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_hojin_02_02_01_01_2.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/02_01_01_2');

    expect(sec.clauses.length).toBe(3);
    expect(sec.clauses[0].clauseNumber).toMatch(/^2-1-/);
  });

  it('07/07_01_01.htm: 第7章 減価償却 第1款 — 13 件の clause を抽出する', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_hojin_07_07_01_01.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/07_01_01');

    expect(sec.clauses.length).toBe(13);
    expect(sec.clauses[0].clauseNumber).toBe('7-1-1');
  });

  it('18/18_01_01.htm: 第18章 国際最低課税 — 18-1-1 から始まる 5 件を抽出する', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_hojin_18_18_01_01.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/18_01_01');

    expect(sec.clauses.length).toBe(5);
    expect(sec.clauses[0].clauseNumber).toBe('18-1-1');
    expect(sec.chapterTitle).toContain('国際最低課税');
  });
});

/**
 * 所基通の節ページに対する parseTsutatsuSection の互換性テスト。
 *
 * Phase 2d-3 で extractClauseNumber の regex 拡張と collectUntilNextH2 の境界拡張
 * （h1 / div.page-header）を入れた回帰防止用。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { extractClauseNumber, parseTsutatsuSection } from './tsutatsu-parser.js';

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

describe('extractClauseNumber — 所基通の追加バリエーション', () => {
  it('2 階層の clause 番号 (条-項) を抽出する: 2-1', () => {
    expect(extractClauseNumber('2-1　法に規定する住所とは…')).toEqual({
      clauseNumber: '2-1',
      body: '法に規定する住所とは…',
    });
  });

  it('「の付き」の clause 番号を抽出する: 2-4の2', () => {
    expect(extractClauseNumber('2-4の2　法第2条第1項第4号に規定する…')).toEqual({
      clauseNumber: '2-4の2',
      body: '法第2条第1項第4号に規定する…',
    });
  });

  it('複数条共通通達の clause 番号を抽出する: 183~193共-1', () => {
    const r = extractClauseNumber('183～193共-1　支給総額が確定している給与等を…');
    expect(r).not.toBeNull();
    // 全角チルダ `～` も ASCII チルダ `~` に正規化される (Normalize-everywhere)
    expect(r!.clauseNumber).toBe('183~193共-1');
    expect(r!.body).toContain('支給総額が確定している給与等');
  });

  it('複数条共通通達 + 全角ハイフン: 183～193共－1', () => {
    const r = extractClauseNumber('183～193共－1　test body');
    expect(r).not.toBeNull();
    // 全角ハイフンは ASCII に、全角チルダも ASCII に正規化される
    expect(r!.clauseNumber).toBe('183~193共-1');
  });

  it('clause 番号が無いテキストは null を返す', () => {
    expect(extractClauseNumber('（注）これは注釈です')).toBeNull();
  });
});

describe('parseTsutatsuSection — 所基通 fixtures', () => {
  it('01/01.htm: 第1編第1章 通則 — 6 件の clause を抽出する', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_shotoku_01_01.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/01_01');

    expect(sec.clauses.length).toBe(6);
    expect(sec.clauses[0].clauseNumber).toBe('2-1');
    expect(sec.clauses[0].title).toBe('住所の意義');
    // 「の付き」が拾える
    expect(sec.clauses.find((c) => c.clauseNumber === '2-4の2')).toBeDefined();
    expect(sec.clauses.find((c) => c.clauseNumber === '2-4の3')).toBeDefined();
  });

  it('04/01.htm: 同一ページ内に複数 h1 がある — 23-1 paragraphs に隣接節タイトルが混入しない', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_shotoku_04_01.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/04_01');

    const c23_1 = sec.clauses.find((c) => c.clauseNumber === '23-1');
    expect(c23_1).toBeDefined();
    // 「法第24条《配当所得》関係」が paragraphs に混入してはいけない
    const allText = c23_1!.paragraphs.map((p) => p.text).join('\n');
    expect(allText).not.toMatch(/法第24条《配当所得》関係/);

    // 24 系も独立 clause として抽出されている
    expect(sec.clauses.find((c) => c.clauseNumber === '24-1')).toBeDefined();
    expect(sec.clauses.find((c) => c.clauseNumber === '24-6の2')).toBeDefined();
  });

  it('17/01.htm: 第2編第2章 税額計算 — 90-2 から始まる 9 件を抽出する', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_shotoku_17_01.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/17_01');

    expect(sec.clauses.length).toBe(9);
    expect(sec.clauses[0].clauseNumber).toBe('90-2');
    // 90-1 は HTML に存在しない（実調査結果）
    expect(sec.clauses.find((c) => c.clauseNumber === '90-1')).toBeUndefined();
  });

  it('22/01.htm: 第3編第1章 国内源泉所得 — 161-1 / 161-1の2 / 161-1の3 が抽出される', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_shotoku_22_01.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/22_01');

    expect(sec.clauses.length).toBe(21);
    expect(sec.clauses.find((c) => c.clauseNumber === '161-1')).toBeDefined();
    expect(sec.clauses.find((c) => c.clauseNumber === '161-1の2')).toBeDefined();
    expect(sec.clauses.find((c) => c.clauseNumber === '161-1の3')).toBeDefined();
  });

  it('30/01.htm: 第6編第3章 給与所得源泉 — 「183~193共-1」形式を 7 件抽出する', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_shotoku_30_01.htm');
    const sec = parseTsutatsuSection(html, 'https://example.com/30_01');

    expect(sec.clauses.length).toBe(7);
    // 全角チルダ `～` は ASCII `~` に正規化される (Normalize-everywhere)
    expect(sec.clauses[0].clauseNumber).toBe('183~193共-1');
    expect(sec.clauses[0].title).toContain('支給総額が確定');
    // すべての clause が「183~193共-」プレフィックスを持つ
    for (const c of sec.clauses) {
      expect(c.clauseNumber).toMatch(/^183~193共-\d+/);
    }
  });
});

describe('Issue #17: 算式画像 (GIF) の alt をプレースホルダとして本文に残す', () => {
  const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_shotoku_04_01.htm');
  const sourceUrl = 'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/04/01.htm';
  const sec = parseTsutatsuSection(html, sourceUrl, '2026-09-07T00:00:00Z');

  it('24-6: img だけの段落が [画像: alt] の段落として残り、images に alt / 絶対 URL が入る', () => {
    const c = sec.clauses.find((x) => x.clauseNumber === '24-6');
    expect(c).toBeDefined();
    const imgPara = c!.paragraphs.find((p) => p.text.startsWith('[画像: '));
    expect(imgPara).toBeDefined();
    expect(imgPara!.indent).toBe(2);
    // alt の HTML エンティティ (&times; &divide;) はデコードされる
    expect(imgPara!.text).toBe(
      '[画像: 株式等を取得するために要した負債の利子の総額×配当所得の収入金額÷（配当所得の収入金額+その利子の額を差し引く前の株式等に係る譲渡所得等の金額及び総合課税の株式等に係る事業所得等の金額）]'
    );
    expect(imgPara!.images).toEqual([
      {
        alt: '株式等を取得するために要した負債の利子の総額×配当所得の収入金額÷（配当所得の収入金額+その利子の額を差し引く前の株式等に係る譲渡所得等の金額及び総合課税の株式等に係る事業所得等の金額）',
        src: 'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/04/24_6.gif',
      },
    ]);
    // fullText (FTS 検索対象) にもプレースホルダが入る
    expect(c!.fullText).toContain('[画像: 株式等を取得するために要した負債の利子の総額');
  });

  it('24-8: 画像段落の後ろの (注) 段落もこれまでどおり残る', () => {
    const c = sec.clauses.find((x) => x.clauseNumber === '24-8');
    expect(c).toBeDefined();
    const texts = c!.paragraphs.map((p) => p.text);
    expect(texts.some((t) => t.startsWith('[画像: 当該譲渡直前における'))).toBe(true);
    expect(texts.some((t) => t.startsWith('（注）'))).toBe(true);
  });

  it('画像を含まない clause には images が付かない', () => {
    const c = sec.clauses.find((x) => x.clauseNumber === '24-7');
    expect(c).toBeDefined();
    expect(c!.paragraphs.every((p) => p.images === undefined)).toBe(true);
  });
});

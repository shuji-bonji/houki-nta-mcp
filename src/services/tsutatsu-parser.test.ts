import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseTsutatsuSection,
  extractClauseNumber,
  TsutatsuParseError,
} from './tsutatsu-parser.js';

/* -------------------------------------------------------------------------- */
/* fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

const FIX_01_01 = 'www.nta.go.jp_law_tsutatsu_kihon_shohi_01_01.htm';
const FIX_01_04 = 'www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm';
const FIX_05_01 = 'www.nta.go.jp_law_tsutatsu_kihon_shohi_05_01.htm';

/* -------------------------------------------------------------------------- */
/* extractClauseNumber                                                        */
/* -------------------------------------------------------------------------- */

describe('extractClauseNumber', () => {
  it('全角ハイフン区切りの番号を ASCII に正規化する', () => {
    expect(extractClauseNumber('1－1－1　事業者とは…')).toEqual({
      clauseNumber: '1-1-1',
      body: '事業者とは…',
    });
    expect(extractClauseNumber('11－5－7　仕入税額控除は…')).toEqual({
      clauseNumber: '11-5-7',
      body: '仕入税額控除は…',
    });
  });

  it('「の」サフィックス付き（1-4-13の2 等）を扱える', () => {
    expect(extractClauseNumber('1－4－13の2　分割があった場合は…')).toEqual({
      clauseNumber: '1-4-13の2',
      body: '分割があった場合は…',
    });
    expect(extractClauseNumber('1－4－15の2　法第9条第7項…')).toEqual({
      clauseNumber: '1-4-15の2',
      body: '法第9条第7項…',
    });
  });

  it('途中セグメントに「のN」が付く形式 (法基通 第3節の2 配下) — v0.3.1 で対応', () => {
    // 法基通 01_03_02.htm に「1-3の2-1 ... 1-3の2-4」という、節「3の2」の中の
    // 連番 clauses が並んでいる。v0.3.0 では regex が末尾の「のN」しか許容せず、
    // すべて「1-3の2」に丸められて UNIQUE 違反 → bulk DL 早期停止 → 30 clauses のみ。
    expect(extractClauseNumber('1-3の2-1 完全支配関係を有することとなった日…')).toEqual({
      clauseNumber: '1-3の2-1',
      body: '完全支配関係を有することとなった日…',
    });
    expect(extractClauseNumber('1－3の2－2 法人税法施行令第4条…')).toEqual({
      clauseNumber: '1-3の2-2',
      body: '法人税法施行令第4条…',
    });
  });

  it('複数行（<br>→改行）の本文も末尾まで取り込める', () => {
    const r = extractClauseNumber('1－4－6　法第9条第1項…\n　ただし…\n　なお…');
    expect(r?.clauseNumber).toBe('1-4-6');
    expect(r?.body).toContain('ただし');
    expect(r?.body).toContain('なお');
  });

  it('ASCII ハイフンの番号も拾える（フォールバック）', () => {
    expect(extractClauseNumber('1-2-3 本文')).toEqual({
      clauseNumber: '1-2-3',
      body: '本文',
    });
  });

  it('番号が無い文字列は null を返す', () => {
    expect(extractClauseNumber('単なる本文です')).toBeNull();
    expect(extractClauseNumber('')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* parseTsutatsuSection — 01/01.htm（単一 clause + 章タイトル付き）             */
/* -------------------------------------------------------------------------- */

describe('parseTsutatsuSection — 01/01.htm（第1章 第1節）', () => {
  const html = loadFixture(FIX_01_01);
  const sec = parseTsutatsuSection(
    html,
    'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/01.htm',
    '2026-04-29T00:00:00.000Z'
  );

  it('メタ情報を抽出する', () => {
    expect(sec.sourceUrl).toBe('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/01.htm');
    expect(sec.fetchedAt).toBe('2026-04-29T00:00:00.000Z');
    expect(sec.pageTitle).toContain('第1節');
    expect(sec.pageTitle).toContain('個人事業者の納税義務');
    expect(sec.chapterTitle).toBe('第1章 納税義務者');
    expect(sec.sectionTitle).toContain('第1節');
    expect(sec.sectionTitle).toContain('個人事業者の納税義務');
  });

  it('1 つの clause "1-1-1" を抽出する', () => {
    expect(sec.clauses).toHaveLength(1);
    const c = sec.clauses[0];
    expect(c.clauseNumber).toBe('1-1-1');
    expect(c.title).toBe('個人事業者と給与所得者の区分');
  });

  it('本文 (indent=1) と (1)〜(4) のサブ項目を持つ', () => {
    const c = sec.clauses[0];
    const indent1 = c.paragraphs.filter((p) => p.indent === 1);
    const indent2 = c.paragraphs.filter((p) => p.indent === 2);

    expect(indent1).toHaveLength(1);
    expect(indent1[0].text).toContain('事業者とは自己の計算において独立して事業を行う者');

    expect(indent2.length).toBeGreaterThanOrEqual(4);
    expect(indent2.some((p) => p.text.includes('(1)'))).toBe(true);
    expect(indent2.some((p) => p.text.includes('(4)'))).toBe(true);
  });

  it('fullText に title と全段落が含まれる', () => {
    const c = sec.clauses[0];
    expect(c.fullText).toContain('個人事業者と給与所得者の区分');
    expect(c.fullText).toContain('事業者とは自己の計算において');
    expect(c.fullText).toContain('役務の提供に係る材料');
  });
});

/* -------------------------------------------------------------------------- */
/* parseTsutatsuSection — 01/04.htm（20 clauses、複数行・の2 サフィックス）      */
/* -------------------------------------------------------------------------- */

describe('parseTsutatsuSection — 01/04.htm（第4節 納税義務の免除）', () => {
  const html = loadFixture(FIX_01_04);
  const sec = parseTsutatsuSection(
    html,
    'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm'
  );

  it('セクションタイトルを抽出する（章タイトルは無し）', () => {
    expect(sec.sectionTitle).toContain('第4節');
    expect(sec.sectionTitle).toContain('納税義務の免除');
    // この節ページは章見出しを持たない
    expect(sec.chapterTitle).toBeUndefined();
  });

  it('20 件すべての clause を取りこぼさず抽出する', () => {
    expect(sec.clauses).toHaveLength(20);
  });

  it('「の2」サフィックス付き clause を取りこぼさない', () => {
    const numbers = sec.clauses.map((c) => c.clauseNumber);
    expect(numbers).toContain('1-4-1の2');
    expect(numbers).toContain('1-4-13の2');
    expect(numbers).toContain('1-4-15の2');
  });

  it('複数行（<br>→改行）含む本文の clause も拾える', () => {
    // 1-4-6 は <br> を含む典型例（s フラグ修正前にスキップされていた）
    const c = sec.clauses.find((c) => c.clauseNumber === '1-4-6');
    expect(c).toBeDefined();
    expect(c?.title).toContain('新規開業');
    const body = c!.paragraphs.find((p) => p.indent === 1);
    expect(body).toBeDefined();
    expect(body!.text).toContain('ただし');
    expect(body!.text).toContain('なお');
  });

  it('clause 番号の昇順（の2 含む）で並んでいる', () => {
    const numbers = sec.clauses.map((c) => c.clauseNumber);
    expect(numbers[0]).toBe('1-4-1');
    expect(numbers[1]).toBe('1-4-1の2');
    expect(numbers[2]).toBe('1-4-2');
    expect(numbers[numbers.length - 1]).toBe('1-4-17');
  });

  it('div.indent2 + p.indent3 の (注) 構造を保持する（1-4-2）', () => {
    const c = sec.clauses.find((c) => c.clauseNumber === '1-4-2')!;
    const indents = c.paragraphs.map((p) => p.indent);
    // indent1 (本文) → indent2 ((注) 親) → indent3 (1〜4) のパターン
    expect(indents).toContain(1);
    expect(indents).toContain(2);
    expect(indents).toContain(3);
  });
});

/* -------------------------------------------------------------------------- */
/* parseTsutatsuSection — 05/01.htm（章タイトル付き、課税範囲の通則）           */
/* -------------------------------------------------------------------------- */

describe('parseTsutatsuSection — 05/01.htm（第5章 第1節 通則）', () => {
  const html = loadFixture(FIX_05_01);
  const sec = parseTsutatsuSection(
    html,
    'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/05/01.htm'
  );

  it('章・節タイトルを正しく拾う', () => {
    expect(sec.chapterTitle).toBe('第5章 課税範囲');
    expect(sec.sectionTitle).toContain('第1節');
    expect(sec.sectionTitle).toContain('通則');
  });

  it('11 件の clause（5-1-1 〜 5-1-11）が抽出される', () => {
    expect(sec.clauses).toHaveLength(11);
    expect(sec.clauses[0].clauseNumber).toBe('5-1-1');
    expect(sec.clauses[10].clauseNumber).toBe('5-1-11');
  });

  it('fetchedAt 未指定時は ISO 8601 文字列が自動生成される', () => {
    expect(sec.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

/* -------------------------------------------------------------------------- */
/* parseTsutatsuSection — エラー系                                            */
/* -------------------------------------------------------------------------- */

describe('parseTsutatsuSection — エラー系', () => {
  it('通達本体 (#bodyArea) が見つからない場合 TsutatsuParseError', () => {
    const html = '<!doctype html><html><body><p>これは通達ではない</p></body></html>';
    expect(() => parseTsutatsuSection(html, 'https://example.com/x')).toThrow(TsutatsuParseError);
  });
});

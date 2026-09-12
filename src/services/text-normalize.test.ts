/**
 * text-normalize.ts のテスト。
 *
 * Normalize-everywhere パターンの基礎となる正規化ヘルパー群。
 * DB 投入と検索クエリで同じ関数を通すことが前提。
 */

import { describe, expect, it } from 'vitest';

import { normalizeClauseNumber, normalizeJpText, normalizeSearchQuery } from './text-normalize.js';

describe('normalizeJpText', () => {
  it('全角ハイフン → ASCII', () => {
    expect(normalizeJpText('1－4－13の2')).toBe('1-4-13の2');
  });

  it('全角チルダ → ASCII', () => {
    expect(normalizeJpText('183～193共-1')).toBe('183~193共-1');
    expect(normalizeJpText('183〜193共-1')).toBe('183~193共-1');
  });

  it('全角数字 → 半角数字', () => {
    expect(normalizeJpText('１２３')).toBe('123');
    expect(normalizeJpText('平成１８年')).toBe('平成18年');
  });

  it('全角スペース → 半角スペース', () => {
    expect(normalizeJpText('第1章　通則')).toBe('第1章 通則');
  });

  it('中黒 ・ は意味のある区切りなので残す', () => {
    expect(normalizeJpText('1の3・1の4共-1')).toBe('1の3・1の4共-1');
  });

  it('「共」「条」「項」「章」など日本語キーワードは残す', () => {
    expect(normalizeJpText('第１２条第１項関係')).toBe('第12条第1項関係');
  });
});

describe('normalizeClauseNumber', () => {
  it('全角ハイフン・全角数字を正規化、内部空白を除去', () => {
    expect(normalizeClauseNumber('1－4－13の2')).toBe('1-4-13の2');
    expect(normalizeClauseNumber('183～193共－1')).toBe('183~193共-1');
    expect(normalizeClauseNumber('1の3・1の4共－1')).toBe('1の3・1の4共-1');
    expect(normalizeClauseNumber('1の2－1')).toBe('1の2-1');
  });

  it('内部に紛れ込んだ空白も削除', () => {
    expect(normalizeClauseNumber('1 - 4 - 13')).toBe('1-4-13');
  });
});

describe('normalizeSearchQuery', () => {
  it('全角ハイフン・全角数字を正規化、連続空白を 1 つに圧縮', () => {
    expect(normalizeSearchQuery('1－4－13')).toBe('1-4-13');
    expect(normalizeSearchQuery('  軽減  税率  ')).toBe('軽減 税率');
    expect(normalizeSearchQuery('1－4－13　通則')).toBe('1-4-13 通則');
  });
});

describe('共通パッケージに揃えた分の挙動（Issue #27）', () => {
  it('全角英字 → 半角英字', () => {
    expect(normalizeJpText('ＮＩＳＡ')).toBe('NISA');
    expect(normalizeJpText('ｅ－Ｔａｘ')).toBe('e-Tax');
    expect(normalizeJpText('ｉＤｅＣｏ')).toBe('iDeCo');
    expect(normalizeJpText('ＤＸ投資促進税制')).toBe('DX投資促進税制');
  });

  it('全角英字を含む条番号も半角になる', () => {
    expect(normalizeClauseNumber('Ａ－１')).toBe('A-1');
  });

  it('検索クエリは英字を小文字に寄せる', () => {
    expect(normalizeSearchQuery('ＮＩＳＡ')).toBe('nisa');
    expect(normalizeSearchQuery('e-Tax')).toBe('e-tax');
  });

  it('前後の空白を落とす', () => {
    expect(normalizeJpText('　軽減税率　')).toBe('軽減税率');
  });

  it('保存済みの文字列にもう一度通しても結果が変わらない（冪等）', () => {
    for (const s of ['ＮＩＳＡ', 'ｅ－Ｔａｘ', '1の3・1の4共－1', '第１２条第１項関係']) {
      expect(normalizeJpText(normalizeJpText(s))).toBe(normalizeJpText(s));
    }
  });
});

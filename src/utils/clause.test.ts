import { describe, it, expect } from 'vitest';
import { parseClauseNumber, buildSectionUrl } from './clause.js';

describe('parseClauseNumber', () => {
  it('"1-4-1" を {1, 4, "1"} に分解する', () => {
    expect(parseClauseNumber('1-4-1')).toEqual({ chapter: 1, section: 4, article: '1' });
  });

  it('「の2」サフィックス付きを保持する', () => {
    expect(parseClauseNumber('1-4-13の2')).toEqual({
      chapter: 1,
      section: 4,
      article: '13の2',
    });
    expect(parseClauseNumber('1-4-15の2')).toEqual({
      chapter: 1,
      section: 4,
      article: '15の2',
    });
  });

  it('2 桁の章・節を扱える', () => {
    expect(parseClauseNumber('11-5-7')).toEqual({ chapter: 11, section: 5, article: '7' });
  });

  it('前後の空白を許容する', () => {
    expect(parseClauseNumber('  5-1-9  ')).toEqual({ chapter: 5, section: 1, article: '9' });
  });

  it('不正な形式は null', () => {
    expect(parseClauseNumber('')).toBeNull();
    expect(parseClauseNumber('5-1')).toBeNull();
    expect(parseClauseNumber('1.4.1')).toBeNull();
    expect(parseClauseNumber('abc')).toBeNull();
    expect(parseClauseNumber('1-4-1の')).toBeNull(); // の の後ろに数字がない
  });
});

describe('buildSectionUrl', () => {
  it('章・節を 2 桁にゼロパディングして htm を作る', () => {
    expect(buildSectionUrl('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/', 1, 4)).toBe(
      'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm'
    );

    expect(buildSectionUrl('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/', 11, 5)).toBe(
      'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/11/05.htm'
    );
  });

  it('rootUrl が / で終わらないとエラー', () => {
    expect(() => buildSectionUrl('https://www.nta.go.jp/law/tsutatsu/kihon/shohi', 1, 1)).toThrow();
  });

  it('章・節が 0 以下だとエラー', () => {
    expect(() => buildSectionUrl('https://x/', 0, 1)).toThrow();
    expect(() => buildSectionUrl('https://x/', 1, 0)).toThrow();
  });
});

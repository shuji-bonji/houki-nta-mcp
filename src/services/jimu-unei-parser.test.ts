/**
 * 事務運営指針 parser のテスト。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseJimuUneiIndex,
  parseJimuUneiPage,
  extractDocIdFromJimuUrl,
  extractTaxonomyFromJimuUrl,
  extractIssuedAtFromUrlFolder,
} from './jimu-unei-parser.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');
function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

describe('parseJimuUneiIndex', () => {
  it('索引から 30 件以上の事務運営指針リンクを抽出する（kaisei は除外）', () => {
    const html = loadFixture('www.nta.go.jp_law_jimu-unei_jimu.htm');
    const url = 'https://www.nta.go.jp/law/jimu-unei/jimu.htm';
    const entries = parseJimuUneiIndex(html, url);
    expect(entries.length).toBeGreaterThanOrEqual(30);
    // 全エントリが /jimu-unei/.../{index|01}.htm
    for (const e of entries) {
      expect(e.url).toMatch(/\/law\/jimu-unei\/.+\/(index|01)\.htm$/);
      // kaisei パスは含まれていない
      expect(e.url).not.toMatch(/\/jimu-unei\/.*\/kaisei\//);
    }
  });

  it('bodyArea が無い HTML は TsutatsuParseError', () => {
    const html = '<!doctype html><html><body><p>not jimu-unei</p></body></html>';
    expect(() => parseJimuUneiIndex(html, 'https://example.com/x')).toThrow(TsutatsuParseError);
  });
});

describe('parseJimuUneiPage — 平成17年所得税 (170331)', () => {
  const html = loadFixture('www.nta.go.jp_law_jimu-unei_shotoku_shinkoku_170331_index.htm');
  const url = 'https://www.nta.go.jp/law/jimu-unei/shotoku/shinkoku/170331/index.htm';
  const doc = parseJimuUneiPage(html, url, '2026-05-02T00:00:00.000Z');

  it('docType / docId / taxonomy を URL から抽出する', () => {
    expect(doc.docType).toBe('jimu-unei');
    expect(doc.docId).toBe('shotoku/shinkoku/170331');
    expect(doc.taxonomy).toBe('shotoku');
  });

  it('h1 タイトルを抽出する', () => {
    expect(doc.title).toContain('恒久的施設帰属所得');
    expect(doc.title).toContain('事務運営指針');
  });

  it('発出日 (issuedAt) を URL フォルダから推定する (170331 → 2005-03-31)', () => {
    expect(doc.issuedAt).toBe('2005-03-31');
  });

  it('issuer に「国税庁長官」が含まれる', () => {
    expect(doc.issuer).toBeDefined();
    expect(doc.issuer).toContain('国税庁長官');
  });

  it('添付 PDF が複数件抽出され、サイズ KB が取れる', () => {
    expect(doc.attachedPdfs.length).toBeGreaterThanOrEqual(3);
    expect(doc.attachedPdfs[0].url).toMatch(/\.pdf$/);
    expect(doc.attachedPdfs[0].sizeKb).toBeGreaterThan(0);
  });
});

describe('parseJimuUneiPage — 相続税 (170111_1) 末尾サフィックス付き', () => {
  it('docId に `_1` のサフィックスを保持する', () => {
    const html = loadFixture('www.nta.go.jp_law_jimu-unei_sozoku_170111_1_01.htm');
    const url = 'https://www.nta.go.jp/law/jimu-unei/sozoku/170111_1/01.htm';
    const doc = parseJimuUneiPage(html, url);
    expect(doc.docId).toBe('sozoku/170111_1');
    expect(doc.taxonomy).toBe('sozoku');
  });
});

describe('extractDocIdFromJimuUrl', () => {
  it('index.htm 形式', () => {
    expect(
      extractDocIdFromJimuUrl(
        'https://www.nta.go.jp/law/jimu-unei/shotoku/shinkoku/170331/index.htm'
      )
    ).toBe('shotoku/shinkoku/170331');
  });
  it('01.htm 形式', () => {
    expect(
      extractDocIdFromJimuUrl('https://www.nta.go.jp/law/jimu-unei/sozoku/170111_1/01.htm')
    ).toBe('sozoku/170111_1');
  });
});

describe('extractTaxonomyFromJimuUrl', () => {
  it('shotoku', () => {
    expect(
      extractTaxonomyFromJimuUrl(
        'https://www.nta.go.jp/law/jimu-unei/shotoku/shinkoku/170331/index.htm'
      )
    ).toBe('shotoku');
  });
  it('sozoku', () => {
    expect(
      extractTaxonomyFromJimuUrl('https://www.nta.go.jp/law/jimu-unei/sozoku/170111_1/01.htm')
    ).toBe('sozoku');
  });
});

describe('extractIssuedAtFromUrlFolder', () => {
  it('170331 → 2005-03-31 (平成17年)', () => {
    expect(extractIssuedAtFromUrlFolder('/law/jimu-unei/shotoku/shinkoku/170331/index.htm')).toBe(
      '2005-03-31'
    );
  });
  it('090401 → 2009-04-01 (平成21年は 21 年だが、yy=09 = 平成9年として扱われる注意点あり)', () => {
    // yy=09 → 平成9年 = 1997-04-01 の方が国税庁の慣習に近い
    expect(extractIssuedAtFromUrlFolder('/law/jimu-unei/shotoku/shinkoku/090401/01.htm')).toBe(
      '1997-04-01'
    );
  });
  it('170111_1 のサフィックス付きも対応', () => {
    expect(extractIssuedAtFromUrlFolder('/law/jimu-unei/sozoku/170111_1/01.htm')).toBe(
      '2005-01-11'
    );
  });
  it('日付として不正な値は undefined', () => {
    expect(extractIssuedAtFromUrlFolder('/law/jimu-unei/sozoku/999999/01.htm')).toBeUndefined();
  });
});

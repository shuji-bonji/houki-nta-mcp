/**
 * 文書回答事例 parser のテスト。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseBunshoMainIndex,
  parseBunshoTaxonomyIndex,
  parseBunshoPage,
  extractDocIdFromBunshoUrl,
  extractTaxonomyFromBunshoUrl,
} from './bunshokaitou-parser.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');
function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

describe('parseBunshoMainIndex', () => {
  it('メイン索引から税目別索引 URL を抽出する（11 税目を前後を含む）', () => {
    const html = loadFixture('www.nta.go.jp_law_bunshokaito_01.htm');
    const url = 'https://www.nta.go.jp/law/bunshokaito/01.htm';
    const entries = parseBunshoMainIndex(html, url);
    // 11 税目程度を期待。`_1.htm` 系は除外しているのでユニーク税目数
    expect(entries.length).toBeGreaterThanOrEqual(8);
    expect(entries.length).toBeLessThanOrEqual(15);
    for (const e of entries) {
      expect(e.taxonomy).toBeTruthy();
      expect(e.indexUrl).toMatch(/\/law\/bunshokaito\/[^/]+\/\d+\.htm$/);
      expect(e.indexUrl).not.toMatch(/_\d+\.htm$/);
    }
    // 所得税が含まれている
    expect(entries.find((e) => e.taxonomy === 'shotoku')).toBeDefined();
  });

  it('bodyArea が無い HTML は TsutatsuParseError', () => {
    const html = '<!doctype html><html><body><p>not bunshokaito</p></body></html>';
    expect(() => parseBunshoMainIndex(html, 'https://example.com/x')).toThrow(TsutatsuParseError);
  });
});

describe('parseBunshoTaxonomyIndex', () => {
  it('所得税の税目別索引から個別事例 URL を抽出する（重複排除後 100 件超）', () => {
    const html = loadFixture('www.nta.go.jp_law_bunshokaito_shotoku_02.htm');
    const url = 'https://www.nta.go.jp/law/bunshokaito/shotoku/02.htm';
    const entries = parseBunshoTaxonomyIndex(html, url);
    // 「回答年月日順」+「項目別」の両方が同じファイルに入っているため、
    // 重複 URL（# anchor 違いなど）を除外した unique 件数で確認
    expect(entries.length).toBeGreaterThanOrEqual(100);
    // 本庁系・国税局系の両方が混在
    const hasHoncho = entries.some((e) =>
      /\/law\/bunshokaito\/[^/]+\/[^/]+\/index\.htm$/.test(e.url)
    );
    const hasLocal = entries.some((e) => /\/about\/organization\/[^/]+\/bunshokaito\//.test(e.url));
    expect(hasHoncho).toBe(true);
    expect(hasLocal).toBe(true);
  });
});

describe('parseBunshoPage — 本庁系 (250416)', () => {
  const html = loadFixture('www.nta.go.jp_law_bunshokaito_shotoku_250416_index.htm');
  const url = 'https://www.nta.go.jp/law/bunshokaito/shotoku/250416/index.htm';
  const doc = parseBunshoPage(html, url, '2026-05-03T00:00:00.000Z');

  it('docType / docId / taxonomy を URL から抽出する', () => {
    expect(doc.docType).toBe('bunshokaitou');
    expect(doc.docId).toBe('shotoku/250416');
    expect(doc.taxonomy).toBe('shotoku');
  });

  it('h1 タイトルを抽出する', () => {
    expect(doc.title).toContain('産科医療特別給付事業');
  });

  it('issuer は「国税庁」（本庁系）', () => {
    expect(doc.issuer).toBe('国税庁');
  });

  it('本文に「〔照会〕」「〔回答〕」を含む', () => {
    expect(doc.fullText).toContain('〔照会〕');
    expect(doc.fullText).toContain('〔回答〕');
  });
});

describe('parseBunshoPage — 国税局系 (260218 東京)', () => {
  const html = loadFixture(
    'www.nta.go.jp_about_organization_tokyo_bunshokaito_shotoku_260218_index.htm'
  );
  const url = 'https://www.nta.go.jp/about/organization/tokyo/bunshokaito/shotoku/260218/index.htm';
  const doc = parseBunshoPage(html, url);

  it('docId に国税局名が含まれる', () => {
    expect(doc.docId).toBe('tokyo/shotoku/260218');
    expect(doc.taxonomy).toBe('shotoku');
  });

  it('issuer が「東京国税局」', () => {
    expect(doc.issuer).toBe('東京国税局');
  });
});

describe('extractDocIdFromBunshoUrl', () => {
  it('本庁系', () => {
    expect(
      extractDocIdFromBunshoUrl('https://www.nta.go.jp/law/bunshokaito/shotoku/250416/index.htm')
    ).toBe('shotoku/250416');
  });
  it('国税局系 /index.htm', () => {
    expect(
      extractDocIdFromBunshoUrl(
        'https://www.nta.go.jp/about/organization/tokyo/bunshokaito/shotoku/260218/index.htm'
      )
    ).toBe('tokyo/shotoku/260218');
  });
  it('国税局系 末尾 .htm', () => {
    expect(
      extractDocIdFromBunshoUrl(
        'https://www.nta.go.jp/about/organization/sendai/bunshokaito/shotoku/230919.htm'
      )
    ).toBe('sendai/shotoku/230919');
  });
});

describe('extractTaxonomyFromBunshoUrl', () => {
  it('本庁系', () => {
    expect(
      extractTaxonomyFromBunshoUrl('https://www.nta.go.jp/law/bunshokaito/shotoku/250416/index.htm')
    ).toBe('shotoku');
  });
  it('国税局系', () => {
    expect(
      extractTaxonomyFromBunshoUrl(
        'https://www.nta.go.jp/about/organization/tokyo/bunshokaito/hojin/260218/index.htm'
      )
    ).toBe('hojin');
  });
});

/**
 * 文書回答事例 parser のテスト。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  extractBunshoAppendixUrls,
  extractDocIdFromBunshoUrl,
  extractTaxonomyFromBunshoUrl,
  parseBunshoMainIndex,
  parseBunshoPage,
  parseBunshoTaxonomyIndex,
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

  // v0.10.3: 表 (table.kaito) の中身を取り込む。v0.10.2 までは見出し 2 行だけだった
  it('照会の表から関係する法令条項等・添付書類を取り込む', () => {
    expect(doc.fullText).toContain(
      '関係する法令条項等: 所得税法第9条第1項18号、所得税法施行令第30条'
    );
    expect(doc.fullText).toContain('添付書類: ・産科医療特別給付事業 実施要綱');
    expect(doc.fullText).toContain('団体の名称: （コウセイロウドウショウ） 厚生労働省');
  });

  it('回答の表から回答年月日・回答者・回答内容を取り込む', () => {
    expect(doc.fullText).toContain('回答年月日: 令和7年4月7日');
    expect(doc.fullText).toContain('回答者: 国税庁課税部審理室長');
    expect(doc.fullText).toMatch(
      /回答内容: 標題のことについては、ご照会に係る事実関係を前提とする限り、貴見のとおりで差し支えありません。/
    );
    expect(doc.fullText).toContain('この回答内容は国税庁としての見解であり');
  });

  it('issuedAt は回答年月日 (令和7年4月7日 → 2025-04-07)', () => {
    expect(doc.issuedAt).toBe('2025-04-07');
  });

  it('別紙を渡さなければ【別紙】は付かない', () => {
    expect(doc.fullText).not.toContain('【別紙】');
  });
});

describe('parseBunshoPage — 別紙 (another.htm) の連結 (250416)', () => {
  const indexHtml = loadFixture('www.nta.go.jp_law_bunshokaito_shotoku_250416_index.htm');
  const appendixHtml = loadFixture('www.nta.go.jp_law_bunshokaito_shotoku_250416_another.htm');
  const url = 'https://www.nta.go.jp/law/bunshokaito/shotoku/250416/index.htm';
  const appendixUrl = 'https://www.nta.go.jp/law/bunshokaito/shotoku/250416/another.htm';

  it('extractBunshoAppendixUrls は同じ another.htm を 1 件にまとめる (表の中に 3 回出る)', () => {
    expect(extractBunshoAppendixUrls(indexHtml, url)).toEqual([appendixUrl]);
  });

  it('別紙の照会文が【別紙】の後ろに入る', () => {
    const doc = parseBunshoPage(indexHtml, url, '2026-09-08T00:00:00.000Z', [
      { url: appendixUrl, html: appendixHtml },
    ]);
    const at = doc.fullText.indexOf('【別紙】');
    expect(at).toBeGreaterThan(0);
    const appendix = doc.fullText.slice(at);
    expect(appendix).toContain('医政地発0331第4号');
    expect(appendix).toContain('産科医療補償制度（以下「本体制度」といいます。）');
    // 本文 (index) の回答内容は【別紙】より前にある
    expect(doc.fullText.indexOf('回答内容:')).toBeLessThan(at);
    // 別紙は index 本文より長い (実測 2,700 文字超。normalize で空白が縮む)
    expect(appendix.length).toBeGreaterThan(2500);
  });
});

describe('parseBunshoPage — 2008 年の文書も同じ構造 (081102)', () => {
  const html = loadFixture('www.nta.go.jp_law_bunshokaito_shotoku_081102_index.htm');
  const url = 'https://www.nta.go.jp/law/bunshokaito/shotoku/081102/index.htm';
  const doc = parseBunshoPage(html, url);

  it('issuedAt は回答年月日 (平成20年11月6日 → 2008-11-06)', () => {
    expect(doc.issuedAt).toBe('2008-11-06');
  });

  it('回答内容と関係する法令条項等を取り込む', () => {
    expect(doc.fullText).toContain(
      '関係する法令条項等: 所得税法第9条第16号及び所得税法施行令第30条'
    );
    expect(doc.fullText).toContain('貴見のとおりで差し支えありません');
  });

  it('別紙 URL は同じディレクトリの another.htm', () => {
    expect(extractBunshoAppendixUrls(html, url)).toEqual([
      'https://www.nta.go.jp/law/bunshokaito/shotoku/081102/another.htm',
    ]);
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

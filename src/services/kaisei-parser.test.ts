/**
 * 個別改正通達ページ parser のテスト。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseKaiseiPage, parsePdfSizeKb } from './kaisei-parser.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');
function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

describe('parseKaiseiPage — 消基通 令和8年4月1日改正', () => {
  const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_shohi_kaisei_0026003-067_index.htm');
  const url = 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/0026003-067/index.htm';
  const doc = parseKaiseiPage(html, url, '2026-05-02T00:00:00.000Z');

  it('docType / docId / taxonomy を URL から正しく抽出する', () => {
    expect(doc.docType).toBe('kaisei');
    expect(doc.docId).toBe('0026003-067');
    expect(doc.taxonomy).toBe('shohi');
  });

  it('タイトルを h1 から抽出する', () => {
    expect(doc.title).toContain('消費税法基本通達');
    expect(doc.title).toContain('一部改正');
  });

  it('発出日 (issuedAt) を本文から抽出する', () => {
    expect(doc.issuedAt).toBe('2026-04-01');
  });

  it('issuer (宛先・発出者) に「殿」「国税庁長官」が含まれる', () => {
    expect(doc.issuer).toBeDefined();
    expect(doc.issuer).toContain('殿');
    expect(doc.issuer).toContain('国税庁長官');
  });

  it('本文 (fullText) は normalize 済み（全角ハイフンが ASCII 化）', () => {
    // fixture の課税局番号は全角ハイフン「課消２－11」が含まれる → 「課消2-11」に正規化
    expect(doc.fullText).toContain('課消2-11');
    expect(doc.fullText.length).toBeGreaterThan(100);
  });

  it('添付 PDF が 1 件抽出され、サイズ KB が取れる', () => {
    expect(doc.attachedPdfs.length).toBe(1);
    const pdf = doc.attachedPdfs[0];
    expect(pdf.url).toMatch(/\.pdf$/);
    expect(pdf.title).toContain('別紙');
    expect(pdf.sizeKb).toBe(470);
  });

  it('Phase 4-1-3: 添付 PDF にタイトルから推定された kind が付く', () => {
    // 「別紙（PDF/470KB）」→ attachment
    expect(doc.attachedPdfs[0].kind).toBe('attachment');
  });
});

describe('parseKaiseiPage — エラー系', () => {
  it('bodyArea が無い HTML は TsutatsuParseError', () => {
    const html = '<!doctype html><html><body><p>not kaisei</p></body></html>';
    expect(() => parseKaiseiPage(html, 'https://example.com/x')).toThrow(TsutatsuParseError);
  });
});

describe('parsePdfSizeKb', () => {
  it('PDF/470KB → 470', () => {
    expect(parsePdfSizeKb('別紙（PDF/470KB）')).toBe(470);
  });
  it('PDFファイル/76KB → 76', () => {
    expect(parsePdfSizeKb('様式 (PDFファイル/76KB)')).toBe(76);
  });
  it('PDF/1,594KB → 1594（カンマ区切り）', () => {
    expect(parsePdfSizeKb('（PDF/1,594KB）')).toBe(1594);
  });
  it('PDF/1.18MB → 1208 (MB を KB へ)', () => {
    expect(parsePdfSizeKb('（PDF/1.18MB）')).toBe(1208);
  });
  it('サイズ無しは undefined', () => {
    expect(parsePdfSizeKb('別紙')).toBeUndefined();
  });
});

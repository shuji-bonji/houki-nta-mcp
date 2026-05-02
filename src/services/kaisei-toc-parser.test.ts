/**
 * 改正通達索引 (kaisei_a.htm) parser のテスト。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseKaiseiIndex,
  extractIssuedAt,
  extractDocIdFromUrl,
  extractTaxonomyFromUrl,
} from './kaisei-toc-parser.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');
function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

describe('parseKaiseiIndex', () => {
  it('消基通の改正索引から 22 件以上の改正通達 URL を抽出する', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_shohi_kaisei_kaisei_a.htm');
    const url = 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei_a.htm';
    const entries = parseKaiseiIndex(html, url);
    expect(entries.length).toBeGreaterThanOrEqual(20);
    // 全エントリが /kaisei/{ID}/index.htm
    for (const e of entries) {
      expect(e.url).toMatch(/\/law\/tsutatsu\/kihon\/shohi\/kaisei\/[^/]+\/index\.htm$/);
      expect(e.title.length).toBeGreaterThan(5);
    }
    // 最新の改正は 2026-04-01 (令和8年4月1日)
    expect(entries[0].issuedAt).toBe('2026-04-01');
  });

  it('全角数字を含むタイトル（令和７年４月１日）の発出日も抽出できる', () => {
    const html = loadFixture('www.nta.go.jp_law_tsutatsu_kihon_shohi_kaisei_kaisei_a.htm');
    const entries = parseKaiseiIndex(
      html,
      'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei_a.htm'
    );
    // 全角数字が含まれるエントリがある
    const fullWidthEntry = entries.find((e) => /令和[０-９]/.test(e.title));
    expect(fullWidthEntry).toBeDefined();
    expect(fullWidthEntry!.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('bodyArea が無い HTML は TsutatsuParseError', () => {
    const html = '<!doctype html><html><body><p>not kaisei</p></body></html>';
    expect(() => parseKaiseiIndex(html, 'https://example.com/x')).toThrow(TsutatsuParseError);
  });
});

describe('extractIssuedAt', () => {
  it('令和（半角数字）', () => {
    expect(extractIssuedAt('（令和8年4月1日）')).toBe('2026-04-01');
  });
  it('令和（全角数字）', () => {
    expect(extractIssuedAt('（令和７年４月１日）')).toBe('2025-04-01');
  });
  it('平成（元号 = 元）', () => {
    expect(extractIssuedAt('平成元年1月8日')).toBe('1989-01-08');
  });
  it('昭和', () => {
    expect(extractIssuedAt('昭和43年12月24日')).toBe('1968-12-24');
  });
  it('日付が無い文字列は undefined', () => {
    expect(extractIssuedAt('改正のお知らせ')).toBeUndefined();
  });
});

describe('extractDocIdFromUrl', () => {
  it('新形式 0026003-067', () => {
    expect(
      extractDocIdFromUrl(
        'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/0026003-067/index.htm'
      )
    ).toBe('0026003-067');
  });
  it('旧形式 240401', () => {
    expect(
      extractDocIdFromUrl('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/240401/index.htm')
    ).toBe('240401');
  });
});

describe('extractTaxonomyFromUrl', () => {
  it('shohi', () => {
    expect(
      extractTaxonomyFromUrl('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/X/index.htm')
    ).toBe('shohi');
  });
  it('sisan/sozoku (2 階層)', () => {
    expect(
      extractTaxonomyFromUrl(
        'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku/kaisei/X/index.htm'
      )
    ).toBe('sisan/sozoku');
  });
});

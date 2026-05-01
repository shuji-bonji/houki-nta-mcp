import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { encode as iconvEncode } from 'iconv-lite';

import { openDb, closeDb } from '../db/index.js';
import { bulkDownloadTsutatsu } from './bulk-downloader.js';

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');

function sjisHtmlResponse(fixtureName: string): Response {
  const html = readFileSync(resolve(fixturesDir, fixtureName), 'utf8');
  const buf = iconvEncode(html, 'shift_jis');
  return new Response(buf, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
  });
}

describe('bulkDownloadTsutatsu — 消基通 (fixture モック)', () => {
  it('TOC + 1 章のみで実行し、tsutatsu/chapter/section/clause が DB に入る', async () => {
    // TOC ページの後、各節のリクエストには対応 fixture を返す
    const fixtureMap = new Map<string, string>([
      [
        'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01.htm',
        'www.nta.go.jp_law_tsutatsu_kihon_shohi_01.htm',
      ],
      [
        'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/01.htm',
        'www.nta.go.jp_law_tsutatsu_kihon_shohi_01_01.htm',
      ],
      [
        'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm',
        'www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm',
      ],
    ]);

    const fetchImpl = vi.fn(async (url: string) => {
      const fixture = fixtureMap.get(url);
      if (fixture) return sjisHtmlResponse(fixture);
      // 知らない URL は 404
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    }) as unknown as typeof fetch;

    const db = openDb(':memory:');
    try {
      const r = await bulkDownloadTsutatsu(db, {
        formalName: '消費税法基本通達',
        abbr: '消基通',
        onlyChapter: 1,
        fetchImpl,
        requestIntervalMs: 1, // テストを早く
      });

      // 章 1 は 8 節（fixture 全件揃っているのは 01/01.htm と 01/04.htm のみ）
      expect(r.chapters).toBe(1);
      expect(r.sections).toBe(8);
      // 2 件は成功、6 件は 404 で失敗
      expect(r.sectionsFetched).toBe(2);
      expect(r.sectionsFailed).toBe(6);
      // 01/01.htm = 1 clause, 01/04.htm = 20 clauses
      expect(r.clauses).toBe(21);
    } finally {
      closeDb(db);
    }
  }, 15_000);

  it('FTS5 検索が DB に入った clause で動作する', async () => {
    const fixtureMap = new Map<string, string>([
      [
        'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01.htm',
        'www.nta.go.jp_law_tsutatsu_kihon_shohi_01.htm',
      ],
      [
        'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm',
        'www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm',
      ],
    ]);
    const fetchImpl = vi.fn(async (url: string) => {
      const fixture = fixtureMap.get(url);
      if (fixture) return sjisHtmlResponse(fixture);
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    }) as unknown as typeof fetch;

    const db = openDb(':memory:');
    try {
      await bulkDownloadTsutatsu(db, {
        formalName: '消費税法基本通達',
        abbr: '消基通',
        onlyChapter: 1,
        fetchImpl,
        requestIntervalMs: 1,
      });

      // 「納税義務」で検索（1-4-X が複数ヒットするはず）
      const hits = db
        .prepare(
          `SELECT clause_number, title FROM clause_fts WHERE clause_fts MATCH '納税義務' ORDER BY rank LIMIT 5`
        )
        .all() as Array<{ clause_number: string; title: string }>;
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((h) => h.clause_number.startsWith('1-4-'))).toBe(true);
    } finally {
      closeDb(db);
    }
  }, 15_000);

  it('clause→URL lookup が機能する', async () => {
    const fixtureMap = new Map<string, string>([
      [
        'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01.htm',
        'www.nta.go.jp_law_tsutatsu_kihon_shohi_01.htm',
      ],
      [
        'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm',
        'www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm',
      ],
    ]);
    const fetchImpl = vi.fn(async (url: string) => {
      const fixture = fixtureMap.get(url);
      if (fixture) return sjisHtmlResponse(fixture);
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    }) as unknown as typeof fetch;

    const db = openDb(':memory:');
    try {
      const r = await bulkDownloadTsutatsu(db, {
        formalName: '消費税法基本通達',
        abbr: '消基通',
        onlyChapter: 1,
        fetchImpl,
        requestIntervalMs: 1,
      });

      const lookup = db
        .prepare(
          `SELECT clause_number, source_url, title FROM clause WHERE tsutatsu_id = ? AND clause_number = ?`
        )
        .get(r.tsutatsuId, '1-4-13の2') as
        | { clause_number: string; source_url: string; title: string }
        | undefined;
      expect(lookup).toBeDefined();
      expect(lookup?.source_url).toBe('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm');
      expect(lookup?.title).toContain('分割があった場合');
    } finally {
      closeDb(db);
    }
  }, 15_000);
});

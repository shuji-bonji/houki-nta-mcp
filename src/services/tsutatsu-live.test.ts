/**
 * houki-nta-mcp#54: 番号の読み方と、目次から候補ページを選ぶ処理の単体テスト。
 * 応答としての振る舞いは src/tools/get-tsutatsu-live-toc.test.ts と handlers.test.ts の受入テストで確かめる。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { closeDb, openDb } from '../db/index.js';
import {
  articlesInTitle,
  parseLiveClause,
  parseTocByStyle,
  readStoredToc,
  saveStoredToc,
  selectCandidatePages,
} from './tsutatsu-live.js';

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'tests', 'fixtures');
const KIHON = 'https://www.nta.go.jp/law/tsutatsu/kihon';

function toc(style: 'shohi' | 'hojin' | 'shotoku' | 'sozoku', name: string, root: string) {
  const html = readFileSync(
    resolve(fixturesDir, `www.nta.go.jp_law_tsutatsu_kihon_${name}.htm`),
    'utf8'
  );
  return parseTocByStyle(style, html, `${root}01.htm`, '2026-09-26T00:00:00.000Z');
}

function candidateUrls(
  style: 'shohi' | 'hojin' | 'shotoku' | 'sozoku',
  name: string,
  root: string,
  clause: string
): string[] {
  const key = parseLiveClause(style, clause);
  if (!key) throw new Error(`番号の形に当たらない: ${clause}`);
  return selectCandidatePages(toc(style, name, root), key).map((c) => c.url);
}

describe('parseLiveClause — 通達ごとの番号の形', () => {
  it('消費税法基本通達は 章-節-条 だけを読む', () => {
    expect(parseLiveClause('shohi', '1-4-13の2')).toEqual({
      style: 'shohi',
      chapter: 1,
      section: 4,
    });
    expect(parseLiveClause('shohi', '5-1')).toBeNull();
    expect(parseLiveClause('shohi', '1-3の2-1')).toBeNull();
    expect(parseLiveClause('shohi', '0-1-1')).toBeNull();
  });

  it('法人税基本通達は章・節の枝番号を読む', () => {
    expect(parseLiveClause('hojin', '12の2-1-1')).toEqual({
      style: 'hojin',
      chapterLabel: '12の2',
      sectionLabel: '1',
    });
    expect(parseLiveClause('hojin', '1-3の2-1')).toMatchObject({ sectionLabel: '3の2' });
    expect(parseLiveClause('hojin', '34-1')).toBeNull();
  });

  it('所得税・相続税法基本通達は 条-項 と共通の通達（~ / ・）を読む', () => {
    expect(parseLiveClause('shotoku', '2-4の2')).toEqual({
      style: 'shotoku',
      articles: { kind: 'list', refs: [{ base: 2, branch: 0 }] },
    });
    expect(parseLiveClause('shotoku', '23~35共-6')).toEqual({
      style: 'shotoku',
      articles: { kind: 'range', from: { base: 23, branch: 0 }, to: { base: 35, branch: 0 } },
    });
    expect(parseLiveClause('sozoku', '1の3・1の4共-1')).toEqual({
      style: 'sozoku',
      articles: {
        kind: 'list',
        refs: [
          { base: 1, branch: 3 },
          { base: 1, branch: 4 },
        ],
      },
    });
    expect(parseLiveClause('sozoku', '5-1-9')).toBeNull();
  });
});

describe('articlesInTitle — 目次の題から条を読む', () => {
  it('《…》や括弧の中の番号は読まない', () => {
    expect(articlesInTitle('法第34条（（一時所得））関係')).toEqual({
      kind: 'list',
      refs: [{ base: 34, branch: 0 }],
    });
    expect(articlesInTitle('第1条の2((定義))関係')).toEqual({
      kind: 'list',
      refs: [{ base: 1, branch: 2 }],
    });
  });

  it('「から…まで」は範囲、「及び」は列挙として読む', () => {
    expect(articlesInTitle('法第183条から第193条まで（源泉徴収義務）共通関係')).toMatchObject({
      kind: 'range',
    });
    expect(articlesInTitle('法第36条及び第37条（収入金額及び必要経費）共通関係')).toEqual({
      kind: 'list',
      refs: [
        { base: 36, branch: 0 },
        { base: 37, branch: 0 },
      ],
    });
    expect(articlesInTitle('〔居住者、非永住者及び非居住者（第3、4、5号関係）〕')).toBeNull();
  });
});

describe('selectCandidatePages — 目次の保存版から候補ページを選ぶ', () => {
  it('消費税法基本通達: 款に分かれた節は款のページを全部候補にする（5-3）', () => {
    expect(candidateUrls('shohi', 'shohi_01', `${KIHON}/shohi/`, '5-3-1')).toEqual([
      `${KIHON}/shohi/05/03/01.htm`,
      `${KIHON}/shohi/05/03/02.htm`,
    ]);
  });

  it('法人税基本通達: 「第12章の2」の第1節を選ぶ', () => {
    expect(candidateUrls('hojin', 'hojin_01', `${KIHON}/hojin/`, '12の2-1-1')).toEqual([
      `${KIHON}/hojin/12_2/12_2_01.htm`,
    ]);
  });

  it('法人税基本通達: 節の題が無い章（第13章の「詳細はこちら」）は章のページを候補にする', () => {
    expect(candidateUrls('hojin', 'hojin_01', `${KIHON}/hojin/`, '13-1-1')).toEqual([
      `${KIHON}/hojin/13/13.htm`,
    ]);
  });

  it('所得税基本通達: 同じページを指す 2 つ目の項目（法第24条 → 04/01.htm#a-02）からも選ぶ', () => {
    expect(candidateUrls('shotoku', 'shotoku_01', `${KIHON}/shotoku/`, '24-1')).toEqual([
      `${KIHON}/shotoku/04/01.htm`,
    ]);
  });

  it('所得税基本通達: 共通の通達は、同じ範囲の題の項目を選び、条が重なるだけの項目は選ばない', () => {
    const urls = candidateUrls('shotoku', 'shotoku_01', `${KIHON}/shotoku/`, '23~35共-1');
    expect(urls).toEqual([`${KIHON}/shotoku/04/10.htm`]);
  });

  it('相続税法基本通達: 同じページを別の条の見出しの下から指しているときも選ぶ（2・2の2共 → 01/01.htm）', () => {
    expect(
      candidateUrls('sozoku', 'sisan_sozoku2_01', `${KIHON}/sisan/sozoku2/`, '2・2の2共-1')
    ).toEqual([`${KIHON}/sisan/sozoku2/01/01.htm`]);
  });

  it('候補ページの章・節の番号は bulk download と同じく目次の解析結果の番号を使う', () => {
    const key = parseLiveClause('hojin', '1-3の2-1');
    if (!key) throw new Error('unreachable');
    const [page] = selectCandidatePages(toc('hojin', 'hojin_01', `${KIHON}/hojin/`), key);
    expect(page).toMatchObject({ chapterNumber: 1, sectionNumber: 4 });
    expect(page.sectionTitle).toContain('第3節の2');
  });
});

describe('readStoredToc / saveStoredToc — 目次の保存', () => {
  it('保存した目次と Last-Modified / ETag を URL で読み戻せる', () => {
    const db = openDb(':memory:');
    try {
      const parsed = toc('shohi', 'shohi_01', `${KIHON}/shohi/`);
      const url = `${KIHON}/shohi/01.htm`;
      expect(readStoredToc(db, url)).toBeNull();
      saveStoredToc(db, '消費税法基本通達', url, {
        toc: parsed,
        fetchedAt: '2026-09-26T00:00:00.000Z',
        lastModified: 'Wed, 17 Jun 2026 00:00:00 GMT',
        etag: '"abc"',
      });
      const stored = readStoredToc(db, url);
      expect(stored?.toc.chapters.length).toBe(parsed.chapters.length);
      expect(stored?.lastModified).toBe('Wed, 17 Jun 2026 00:00:00 GMT');
      expect(stored?.etag).toBe('"abc"');
    } finally {
      closeDb(db);
    }
  });
});

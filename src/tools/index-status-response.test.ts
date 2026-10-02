/**
 * Issue #30: 索引から消えた文書が、検索と取得の応答で現行の文書と区別できること。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initSchema } from '../db/schema.js';
import { handleNtaGetJimuUnei, handleNtaSearchJimuUnei } from './handlers.js';

const ORPHANED_AT = '2026-10-01T00:30:00Z';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-index-status-'));
  dbPath = join(dir, 'cache.db');
  const db = new Database(dbPath);
  initSchema(db);
  const insert = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, orphaned_at)
     VALUES ('jimu-unei', ?, 'shotoku', ?, ?, '2026-09-07T00:00:00Z', ?, '[]', ?, ?)`
  );
  insert.run(
    'shotoku/a',
    '現行の事務運営指針',
    'https://example.com/a.htm',
    '源泉徴収の事務運営について',
    'hash-a',
    null
  );
  insert.run(
    'shotoku/b',
    '消えた事務運営指針',
    'https://example.com/b.htm',
    '源泉徴収の事務運営について',
    'hash-b',
    ORPHANED_AT
  );
  db.close();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('nta_search_jimu_unei — 索引から消えた文書の扱い', () => {
  it('SPEC-NTA-SEARCH-JIMU-UNEI-003 SPEC-NTA-SEARCH-JIMU-UNEI-004 SPEC-NTA-SEARCH-RULES-011 検索結果から除外せず、印と件数の注記を付ける（索引にある文書は index_status・orphaned_at が null）', async () => {
    const r = (await handleNtaSearchJimuUnei({ keyword: '源泉徴収' }, { dbPath })) as {
      results: Array<{ docId: string; index_status?: string | null; orphaned_at?: string | null }>;
      search_notes?: string[];
    };

    expect(r.results.map((x) => x.docId).sort()).toEqual(['shotoku/a', 'shotoku/b']);

    const current = r.results.find((x) => x.docId === 'shotoku/a');
    // v0.23.0（T4、SPEC-NTA-SEARCH-RULES-011）: 索引にある文書でもキーを null で置く
    expect(current?.index_status).toBeNull();
    expect(current?.orphaned_at).toBeNull();

    const removed = r.results.find((x) => x.docId === 'shotoku/b');
    expect(removed?.index_status).toBe('removed_from_index');
    expect(removed?.orphaned_at).toBe(ORPHANED_AT);

    expect(r.search_notes?.some((n) => n.includes('2 件のうち 1 件'))).toBe(true);
  });
});

// docId は SPEC-NTA-GET-JIMU-UNEI-010 の形（税目/フォルダー名）で書く（v0.22.0 から形の合わない docId は DB を引かない）
describe('SPEC-NTA-GET-JIMU-UNEI-004 SPEC-NTA-GET-JIMU-UNEI-010 nta_get_jimu_unei — 索引から消えた文書の扱い', () => {
  it('format=json に index_status / orphaned_at / notice が付く', async () => {
    const r = (await handleNtaGetJimuUnei({ docId: 'shotoku/b', format: 'json' }, { dbPath })) as {
      document: { docId: string; orphanedAt?: string };
      index_status?: string;
      orphaned_at?: string;
      notice?: string;
    };

    expect(r.document.docId).toBe('shotoku/b');
    expect(r.index_status).toBe('removed_from_index');
    expect(r.orphaned_at).toBe(ORPHANED_AT);
    expect(r.notice).toContain('索引から外れています');
  });

  it('SPEC-NTA-GET-JIMU-UNEI-004 索引にある文書では index_status・orphaned_at・notice が null', async () => {
    const r = (await handleNtaGetJimuUnei({ docId: 'shotoku/a', format: 'json' }, { dbPath })) as {
      index_status?: string | null;
      orphaned_at?: string | null;
      notice?: string | null;
    };
    // v0.23.0（T4）: 索引にある文書でもキーを null で置く
    expect(r.index_status).toBeNull();
    expect(r.orphaned_at).toBeNull();
    expect(r.notice).toBeNull();
  });

  it('format=markdown には索引の状態の行が入る', async () => {
    const r = (await handleNtaGetJimuUnei({ docId: 'shotoku/b' }, { dbPath })) as string;
    expect(typeof r).toBe('string');
    expect(r).toContain('索引の状態');
    expect(r).toContain('removed_from_index');
  });
});

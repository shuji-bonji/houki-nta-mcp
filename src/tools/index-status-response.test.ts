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
    'A',
    '現行の事務運営指針',
    'https://example.com/a.htm',
    '源泉徴収の事務運営について',
    'hash-a',
    null
  );
  insert.run(
    'B',
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
  it('検索結果から除外せず、印と件数の注記を付ける', async () => {
    const r = (await handleNtaSearchJimuUnei({ keyword: '源泉徴収' }, { dbPath })) as {
      results: Array<{ docId: string; index_status?: string; orphaned_at?: string }>;
      search_notes?: string[];
    };

    expect(r.results.map((x) => x.docId).sort()).toEqual(['A', 'B']);

    const current = r.results.find((x) => x.docId === 'A');
    expect(current?.index_status).toBeUndefined();
    expect(current?.orphaned_at).toBeUndefined();

    const removed = r.results.find((x) => x.docId === 'B');
    expect(removed?.index_status).toBe('removed_from_index');
    expect(removed?.orphaned_at).toBe(ORPHANED_AT);

    expect(r.search_notes?.some((n) => n.includes('2 件のうち 1 件'))).toBe(true);
  });
});

describe('SPEC-NTA-GET-JIMU-UNEI-004 nta_get_jimu_unei — 索引から消えた文書の扱い', () => {
  it('format=json に index_status / orphaned_at / notice が付く', async () => {
    const r = (await handleNtaGetJimuUnei({ docId: 'B', format: 'json' }, { dbPath })) as {
      document: { docId: string; orphanedAt?: string };
      index_status?: string;
      orphaned_at?: string;
      notice?: string;
    };

    expect(r.document.docId).toBe('B');
    expect(r.index_status).toBe('removed_from_index');
    expect(r.orphaned_at).toBe(ORPHANED_AT);
    expect(r.notice).toContain('索引から外れています');
  });

  it('索引にある文書には何も付かない', async () => {
    const r = (await handleNtaGetJimuUnei({ docId: 'A', format: 'json' }, { dbPath })) as {
      index_status?: string;
      notice?: string;
    };
    expect(r.index_status).toBeUndefined();
    expect(r.notice).toBeUndefined();
  });

  it('format=markdown には索引の状態の行が入る', async () => {
    const r = (await handleNtaGetJimuUnei({ docId: 'B' }, { dbPath })) as string;
    expect(typeof r).toBe('string');
    expect(r).toContain('索引の状態');
    expect(r).toContain('removed_from_index');
  });
});

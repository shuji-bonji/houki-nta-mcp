/**
 * Tests for src/services/document-conditional-fetch.ts (Phase 6-2 / v0.9.0)
 */

import type DatabaseT from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initSchema } from '../db/schema.js';
import {
  buildConditionalFetchOptions,
  loadDocumentConditionState,
  newDifferentialCounts,
  updateDocumentFetchedAt,
  updateDocumentMetaOnly,
} from './document-conditional-fetch.js';

function seedDoc(
  db: DatabaseT.Database,
  args: {
    docType: string;
    docId: string;
    sourceUrl: string;
    title?: string;
    fullText?: string;
    contentHash?: string | null;
    lastModified?: string | null;
    etag?: string | null;
    fetchedAt?: string;
  }
): void {
  db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, last_modified, etag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    args.docType,
    args.docId,
    null,
    args.title ?? 'タイトル',
    args.sourceUrl,
    args.fetchedAt ?? '2026-05-01T00:00:00Z',
    args.fullText ?? '本文',
    '[]',
    args.contentHash ?? 'hash-' + args.docId,
    args.lastModified ?? null,
    args.etag ?? null
  );
}

describe('loadDocumentConditionState', () => {
  let db: DatabaseT.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
  });
  afterEach(() => {
    db.close();
  });

  it('returns null when no row exists', () => {
    expect(loadDocumentConditionState(db, 'kaisei', 'https://x/missing')).toBeNull();
  });

  it('returns last_modified / etag / content_hash when row exists', () => {
    seedDoc(db, {
      docType: 'kaisei',
      docId: '0025004-026',
      sourceUrl: 'https://x/0025004-026/01.htm',
      lastModified: 'Tue, 31 Mar 2026 14:00:47 GMT',
      etag: '"28f8-64e5264e67a98"',
      contentHash: 'abc123',
    });
    const state = loadDocumentConditionState(db, 'kaisei', 'https://x/0025004-026/01.htm');
    expect(state).not.toBeNull();
    expect(state!.lastModified).toBe('Tue, 31 Mar 2026 14:00:47 GMT');
    expect(state!.etag).toBe('"28f8-64e5264e67a98"');
    expect(state!.contentHash).toBe('abc123');
  });

  it('returns nulls when columns are NULL (after migration from v3)', () => {
    seedDoc(db, {
      docType: 'kaisei',
      docId: 'x',
      sourceUrl: 'https://x/x',
      lastModified: null,
      etag: null,
    });
    const state = loadDocumentConditionState(db, 'kaisei', 'https://x/x');
    expect(state).not.toBeNull();
    expect(state!.lastModified).toBeNull();
    expect(state!.etag).toBeNull();
  });

  it('does not match across docTypes', () => {
    seedDoc(db, {
      docType: 'kaisei',
      docId: 'x',
      sourceUrl: 'https://x/shared',
      lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT',
    });
    expect(loadDocumentConditionState(db, 'jimu-unei', 'https://x/shared')).toBeNull();
  });
});

describe('buildConditionalFetchOptions', () => {
  it('returns empty options when state is null', () => {
    const opts = buildConditionalFetchOptions(null);
    expect(opts.ifModifiedSince).toBeUndefined();
    expect(opts.ifNoneMatch).toBeUndefined();
  });

  it('passes through fetchImpl when given', () => {
    const customFetch = (() => Promise.resolve(new Response(''))) as typeof fetch;
    const opts = buildConditionalFetchOptions(null, customFetch);
    expect(opts.fetchImpl).toBe(customFetch);
  });

  it('sets If-Modified-Since when state.lastModified is present', () => {
    const opts = buildConditionalFetchOptions({
      lastModified: 'Tue, 31 Mar 2026 14:00:47 GMT',
      etag: null,
      contentHash: 'h',
    });
    expect(opts.ifModifiedSince).toBe('Tue, 31 Mar 2026 14:00:47 GMT');
    expect(opts.ifNoneMatch).toBeUndefined();
  });

  it('sets both If-Modified-Since and If-None-Match when both available', () => {
    const opts = buildConditionalFetchOptions({
      lastModified: 'Tue, 31 Mar 2026 14:00:47 GMT',
      etag: '"abc"',
      contentHash: 'h',
    });
    expect(opts.ifModifiedSince).toBe('Tue, 31 Mar 2026 14:00:47 GMT');
    expect(opts.ifNoneMatch).toBe('"abc"');
  });

  it('omits If-Modified-Since when null', () => {
    const opts = buildConditionalFetchOptions({
      lastModified: null,
      etag: null,
      contentHash: 'h',
    });
    expect(opts.ifModifiedSince).toBeUndefined();
    expect(opts.ifNoneMatch).toBeUndefined();
  });
});

describe('updateDocumentFetchedAt / updateDocumentMetaOnly', () => {
  let db: DatabaseT.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    seedDoc(db, {
      docType: 'kaisei',
      docId: 'x',
      sourceUrl: 'https://x/x',
      fetchedAt: '2026-05-01T00:00:00Z',
      lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT',
      etag: '"old"',
    });
  });
  afterEach(() => {
    db.close();
  });

  it('updateDocumentFetchedAt updates only fetched_at', () => {
    updateDocumentFetchedAt(db, 'kaisei', 'https://x/x', '2026-05-08T00:00:00Z');
    const row = db
      .prepare(
        `SELECT fetched_at, last_modified, etag FROM document WHERE doc_type=? AND source_url=?`
      )
      .get('kaisei', 'https://x/x') as {
      fetched_at: string;
      last_modified: string;
      etag: string;
    };
    expect(row.fetched_at).toBe('2026-05-08T00:00:00Z');
    // last_modified / etag は不変
    expect(row.last_modified).toBe('Mon, 01 Jan 2024 00:00:00 GMT');
    expect(row.etag).toBe('"old"');
  });

  it('updateDocumentMetaOnly updates fetched_at + last_modified + etag', () => {
    updateDocumentMetaOnly(
      db,
      'kaisei',
      'https://x/x',
      '2026-05-08T00:00:00Z',
      'Tue, 08 May 2026 00:00:00 GMT',
      '"new"'
    );
    const row = db
      .prepare(
        `SELECT fetched_at, last_modified, etag FROM document WHERE doc_type=? AND source_url=?`
      )
      .get('kaisei', 'https://x/x') as {
      fetched_at: string;
      last_modified: string;
      etag: string;
    };
    expect(row.fetched_at).toBe('2026-05-08T00:00:00Z');
    expect(row.last_modified).toBe('Tue, 08 May 2026 00:00:00 GMT');
    expect(row.etag).toBe('"new"');
  });

  it('updateDocumentMetaOnly accepts null lastModified / etag', () => {
    updateDocumentMetaOnly(db, 'kaisei', 'https://x/x', '2026-05-08T00:00:00Z', null, null);
    const row = db
      .prepare(`SELECT last_modified, etag FROM document WHERE doc_type=? AND source_url=?`)
      .get('kaisei', 'https://x/x') as { last_modified: string | null; etag: string | null };
    expect(row.last_modified).toBeNull();
    expect(row.etag).toBeNull();
  });
});

describe('newDifferentialCounts', () => {
  it('returns a fresh zero counter', () => {
    const c = newDifferentialCounts();
    expect(c).toEqual({ notModified: 0, contentSame: 0, contentChanged: 0 });
  });

  it('returns independent instances each call', () => {
    const a = newDifferentialCounts();
    const b = newDifferentialCounts();
    a.notModified = 5;
    expect(b.notModified).toBe(0);
  });
});

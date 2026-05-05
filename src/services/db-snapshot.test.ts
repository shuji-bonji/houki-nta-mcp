import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, openDb } from '../db/index.js';
import { snapshotClauseTable, snapshotDocumentTable } from './db-snapshot.js';

import type DatabaseT from 'better-sqlite3';

describe('snapshotDocumentTable', () => {
  let db: DatabaseT.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    // 複数 doc_type を投入
    const insert = db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      'qa-jirei',
      'shohi/02/19',
      'shohi',
      'Title A',
      'https://x',
      '2026-05-04T00:00:00Z',
      'body',
      '[]',
      'h1'
    );
    insert.run(
      'qa-jirei',
      'shohi/02/44',
      'shohi',
      'Title B',
      'https://y',
      '2026-05-04T00:00:00Z',
      'body',
      '[]',
      'h2'
    );
    insert.run(
      'qa-jirei',
      'shotoku/05/38',
      'shotoku',
      'Title C',
      'https://z',
      '2026-05-04T00:00:00Z',
      'body',
      '[]',
      'h3'
    );
    insert.run(
      'tax-answer',
      '6101',
      'shohi',
      'Title D',
      'https://w',
      '2026-05-04T00:00:00Z',
      'body',
      '[]',
      'h4'
    );
  });

  afterEach(() => {
    closeDb(db);
  });

  it('returns all rows for the given doc_type', () => {
    const snap = snapshotDocumentTable(db, 'qa-jirei');
    expect(snap.size).toBe(3);
    expect(snap.has('shohi/02/19')).toBe(true);
    expect(snap.has('shohi/02/44')).toBe(true);
    expect(snap.has('shotoku/05/38')).toBe(true);
  });

  it('does not include rows of other doc_types', () => {
    const snap = snapshotDocumentTable(db, 'qa-jirei');
    expect(snap.has('6101')).toBe(false); // tax-answer
  });

  it('captures content_hash and title for each row', () => {
    const snap = snapshotDocumentTable(db, 'qa-jirei');
    const a = snap.get('shohi/02/19');
    expect(a).toEqual({
      doc_id: 'shohi/02/19',
      content_hash: 'h1',
      title: 'Title A',
    });
  });

  it('filters by taxonomy when provided', () => {
    const snap = snapshotDocumentTable(db, 'qa-jirei', ['shohi']);
    expect(snap.size).toBe(2);
    expect(snap.has('shohi/02/19')).toBe(true);
    expect(snap.has('shohi/02/44')).toBe(true);
    expect(snap.has('shotoku/05/38')).toBe(false);
  });

  it('supports multiple taxonomies (IN clause)', () => {
    const snap = snapshotDocumentTable(db, 'qa-jirei', ['shohi', 'shotoku']);
    expect(snap.size).toBe(3);
  });

  it('returns empty Map for unknown doc_type', () => {
    const snap = snapshotDocumentTable(db, 'kaisei');
    expect(snap.size).toBe(0);
  });

  it('returns empty Map when taxonomyFilter is empty array (no filter applied)', () => {
    const snap = snapshotDocumentTable(db, 'qa-jirei', []);
    // 空配列は「フィルタ無し」とみなし、全 qa-jirei を返す
    expect(snap.size).toBe(3);
  });
});

describe('snapshotClauseTable', () => {
  let db: DatabaseT.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    // tsutatsu レコードを 2 つ投入（消基通 / 所基通）
    const insertTsutatsu = db.prepare(
      `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
    );
    const shohiId = (
      insertTsutatsu.get('消費税法基本通達', '消基通', 'https://x') as { id: number }
    ).id;
    const shotokuId = (
      insertTsutatsu.get('所得税法基本通達', '所基通', 'https://y') as { id: number }
    ).id;

    // clause を投入
    const insertClause = db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertClause.run(shohiId, '1-4-1', 'https://x/1', 1, 4, '消基通-1-4-1', 'body shohi 1', '[]');
    insertClause.run(shohiId, '1-4-2', 'https://x/2', 1, 4, '消基通-1-4-2', 'body shohi 2', '[]');
    insertClause.run(shohiId, '5-1-9', 'https://x/3', 5, 1, '消基通-5-1-9', 'body shohi 3', '[]');
    insertClause.run(
      shotokuId,
      '2-4の2',
      'https://y/1',
      2,
      4,
      '所基通-2-4の2',
      'body shotoku 1',
      '[]'
    );
  });

  afterEach(() => {
    closeDb(db);
  });

  it('returns clauses of the specified tsutatsu (shohi)', () => {
    const snap = snapshotClauseTable(db, 'shohi');
    expect(snap.size).toBe(3);
    expect(snap.has('1-4-1')).toBe(true);
    expect(snap.has('1-4-2')).toBe(true);
    expect(snap.has('5-1-9')).toBe(true);
  });

  it('does not include clauses of other tsutatsu', () => {
    const snap = snapshotClauseTable(db, 'shohi');
    expect(snap.has('2-4の2')).toBe(false); // 所基通 の clause
  });

  it('returns shotoku clauses for shotoku taxonomy', () => {
    const snap = snapshotClauseTable(db, 'shotoku');
    expect(snap.size).toBe(1);
    expect(snap.has('2-4の2')).toBe(true);
  });

  it('returns empty Map for tsutatsu with no clauses (hojin / sozoku)', () => {
    expect(snapshotClauseTable(db, 'hojin').size).toBe(0);
    expect(snapshotClauseTable(db, 'sozoku').size).toBe(0);
  });

  it('computes content_hash from full_text (SHA-1)', () => {
    const snap = snapshotClauseTable(db, 'shohi');
    const c1 = snap.get('1-4-1');
    const c2 = snap.get('1-4-2');
    expect(c1?.content_hash).toMatch(/^[0-9a-f]{40}$/); // SHA-1 = 40 hex chars
    expect(c2?.content_hash).toMatch(/^[0-9a-f]{40}$/);
    // 異なる full_text → 異なる hash
    expect(c1?.content_hash).not.toBe(c2?.content_hash);
  });

  it('returns the same hash for identical full_text', () => {
    const snap1 = snapshotClauseTable(db, 'shohi');
    const snap2 = snapshotClauseTable(db, 'shohi');
    expect(snap1.get('1-4-1')?.content_hash).toBe(snap2.get('1-4-1')?.content_hash);
  });

  it('captures clause_number as doc_id and title', () => {
    const snap = snapshotClauseTable(db, 'shohi');
    const c = snap.get('1-4-1');
    expect(c?.doc_id).toBe('1-4-1');
    expect(c?.title).toBe('消基通-1-4-1');
  });
});

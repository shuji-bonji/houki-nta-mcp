/**
 * Issue #30: 国税庁の索引から消えた文書に印を付け、応答で区別できるようにする。
 */

import type DatabaseT from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initSchema } from '../db/schema.js';
import { getDocumentFromDb, searchDocumentFts } from './db-search.js';
import { countOrphanedDocuments, markOrphanedDocuments } from './index-status.js';

const RUN_STARTED_AT = '2026-10-01T00:00:00Z';
const RAN_AT = '2026-10-01T00:30:00Z';
/** 前回の実行で取った日時。RUN_STARTED_AT より前 */
const OLD_FETCHED_AT = '2026-09-07T00:00:00Z';

let db: DatabaseT.Database;

function seed(args: {
  docId: string;
  title: string;
  sourceUrl: string;
  fetchedAt?: string;
  orphanedAt?: string | null;
  taxonomy?: string;
}): void {
  db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, orphaned_at)
     VALUES ('jimu-unei', ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
  ).run(
    args.docId,
    args.taxonomy ?? 'shotoku',
    args.title,
    args.sourceUrl,
    args.fetchedAt ?? OLD_FETCHED_AT,
    `${args.title}の本文`,
    `hash-${args.docId}`,
    args.orphanedAt ?? null
  );
}

function orphanedAtOf(docId: string): string | null {
  const row = db
    .prepare('SELECT orphaned_at FROM document WHERE doc_type = ? AND doc_id = ?')
    .get('jimu-unei', docId) as { orphaned_at: string | null };
  return row.orphaned_at;
}

beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);
});
afterEach(() => {
  db.close();
});

describe('markOrphanedDocuments', () => {
  it('索引に無く、この実行で触っていない行に印が付く', () => {
    seed({ docId: 'A', title: '現行の指針', sourceUrl: 'https://example.com/a.htm' });
    seed({ docId: 'B', title: '消えた指針', sourceUrl: 'https://example.com/b.htm' });

    const r = markOrphanedDocuments(db, 'jimu-unei', {
      indexUrls: new Set(['https://example.com/a.htm']),
      runStartedAt: RUN_STARTED_AT,
      ranAt: RAN_AT,
    });

    expect(r.marked).toBe(1);
    expect(orphanedAtOf('B')).toBe(RAN_AT);
    expect(orphanedAtOf('A')).toBeNull();
    expect(countOrphanedDocuments(db, 'jimu-unei')).toBe(1);
  });

  it('行は消さない（保持の方針は変えない）', () => {
    seed({ docId: 'B', title: '消えた指針', sourceUrl: 'https://example.com/b.htm' });
    markOrphanedDocuments(db, 'jimu-unei', {
      indexUrls: new Set(),
      runStartedAt: RUN_STARTED_AT,
      ranAt: RAN_AT,
    });
    const count = db.prepare('SELECT COUNT(*) AS n FROM document').get() as { n: number };
    expect(count.n).toBe(1);
    expect(getDocumentFromDb(db, 'jimu-unei', 'B')?.fullText).toBe('消えた指針の本文');
  });

  it('索引に戻っていれば印が外れる', () => {
    seed({
      docId: 'B',
      title: '戻ってきた指針',
      sourceUrl: 'https://example.com/b.htm',
      orphanedAt: '2026-09-20T00:00:00Z',
    });

    const r = markOrphanedDocuments(db, 'jimu-unei', {
      indexUrls: new Set(['https://example.com/b.htm']),
      runStartedAt: RUN_STARTED_AT,
      ranAt: RAN_AT,
    });

    expect(r.cleared).toBe(1);
    expect(orphanedAtOf('B')).toBeNull();
  });

  it('索引の URL に無くても、この実行で取り直した行には印を付けない（リダイレクト対策）', () => {
    // 索引は /old.htm を指しているが、取得がリダイレクトされ source_url は /new.htm で保存された
    seed({
      docId: 'A',
      title: 'リダイレクトされた指針',
      sourceUrl: 'https://example.com/new.htm',
      fetchedAt: '2026-10-01T00:10:00Z',
    });

    const r = markOrphanedDocuments(db, 'jimu-unei', {
      indexUrls: new Set(['https://example.com/old.htm']),
      runStartedAt: RUN_STARTED_AT,
      ranAt: RAN_AT,
    });

    expect(r.marked).toBe(0);
    expect(orphanedAtOf('A')).toBeNull();
  });

  it('世代ディレクトリの移行で doc_id が変わっただけの行には印を付けない', () => {
    // 旧: sozoku/170111、新: sozoku2/170111。題名は同じ
    seed({
      docId: 'sozoku/170111',
      title: '相続税の事務運営指針',
      sourceUrl: 'https://example.com/sozoku/170111.htm',
    });
    seed({
      docId: 'sozoku2/170111',
      title: '相続税の事務運営指針',
      sourceUrl: 'https://example.com/sozoku2/170111.htm',
      fetchedAt: '2026-10-01T00:10:00Z',
    });

    const r = markOrphanedDocuments(db, 'jimu-unei', {
      indexUrls: new Set(['https://example.com/sozoku2/170111.htm']),
      runStartedAt: RUN_STARTED_AT,
      ranAt: RAN_AT,
    });

    expect(r.marked).toBe(0);
    expect(r.movedSkipped).toBe(1);
    expect(orphanedAtOf('sozoku/170111')).toBeNull();
  });

  it('税目を絞って実行したときは、その税目の行だけを見る', () => {
    seed({
      docId: 'A',
      title: '所得税の指針',
      sourceUrl: 'https://example.com/a.htm',
      taxonomy: 'shotoku',
    });
    seed({
      docId: 'B',
      title: '法人税の指針',
      sourceUrl: 'https://example.com/b.htm',
      taxonomy: 'hojin',
    });

    const r = markOrphanedDocuments(db, 'jimu-unei', {
      indexUrls: new Set(),
      runStartedAt: RUN_STARTED_AT,
      ranAt: RAN_AT,
      taxonomyFilter: ['shotoku'],
    });

    expect(r.marked).toBe(1);
    expect(orphanedAtOf('A')).toBe(RAN_AT);
    expect(orphanedAtOf('B')).toBeNull();
  });
});

describe('検索と取得が印を読む', () => {
  it('検索結果に orphanedAt が乗り、除外はされない', () => {
    seed({ docId: 'A', title: '現行の指針', sourceUrl: 'https://example.com/a.htm' });
    seed({ docId: 'B', title: '消えた指針', sourceUrl: 'https://example.com/b.htm' });
    markOrphanedDocuments(db, 'jimu-unei', {
      indexUrls: new Set(['https://example.com/a.htm']),
      runStartedAt: RUN_STARTED_AT,
      ranAt: RAN_AT,
    });

    const hits = searchDocumentFts(db, '指針', { docType: 'jimu-unei' });
    expect(hits.length).toBe(2);
    expect(hits.find((h) => h.docId === 'B')?.orphanedAt).toBe(RAN_AT);
    expect(hits.find((h) => h.docId === 'A')?.orphanedAt).toBeNull();
  });

  it('取得した文書に orphanedAt が乗る', () => {
    seed({
      docId: 'B',
      title: '消えた指針',
      sourceUrl: 'https://example.com/b.htm',
      orphanedAt: RAN_AT,
    });
    expect(getDocumentFromDb(db, 'jimu-unei', 'B')?.orphanedAt).toBe(RAN_AT);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  computeBulkAggregation,
  diffKeys,
  recordBulkRun,
  type DocSnapshot,
} from './bulk-aggregation.js';
import { loadBaseline } from './health-store.js';

function snap(doc_id: string, hash: string | null, title = 'title'): DocSnapshot {
  return { doc_id, content_hash: hash, title };
}

function snapshotMap(entries: DocSnapshot[]): Map<string, DocSnapshot> {
  return new Map(entries.map((e) => [e.doc_id, e]));
}

describe('computeBulkAggregation', () => {
  it('counts new docs (in after, not in before)', () => {
    const before = snapshotMap([snap('a', 'h1')]);
    const after = snapshotMap([snap('a', 'h1'), snap('b', 'h2'), snap('c', 'h3')]);
    const r = computeBulkAggregation({
      before,
      after,
      totalEntries: 3,
      documentsFailed: 0,
      durationMs: 1000,
    });
    expect(r.newDocs).toBe(2);
    expect(r.updatedDocs).toBe(0);
    expect(r.orphanedDocs).toBe(0);
  });

  it('counts updated docs (same id, different hash)', () => {
    const before = snapshotMap([snap('a', 'h1'), snap('b', 'h2')]);
    const after = snapshotMap([snap('a', 'h1-new'), snap('b', 'h2')]);
    const r = computeBulkAggregation({
      before,
      after,
      totalEntries: 2,
      documentsFailed: 0,
      durationMs: 1000,
    });
    expect(r.newDocs).toBe(0);
    expect(r.updatedDocs).toBe(1);
    expect(r.orphanedDocs).toBe(0);
  });

  it('counts orphaned docs (in before, not in after)', () => {
    const before = snapshotMap([snap('a', 'h1'), snap('b', 'h2'), snap('c', 'h3')]);
    const after = snapshotMap([snap('a', 'h1')]);
    const r = computeBulkAggregation({
      before,
      after,
      totalEntries: 1,
      documentsFailed: 0,
      durationMs: 1000,
    });
    expect(r.newDocs).toBe(0);
    expect(r.updatedDocs).toBe(0);
    expect(r.orphanedDocs).toBe(2);
  });

  it('estimates movedDocs by title match between orphaned and new', () => {
    const before = snapshotMap([snap('old-1', 'h1', '通達A'), snap('old-2', 'h2', '通達B')]);
    const after = snapshotMap([
      snap('new-1', 'h3', '通達A'), // moved from old-1
      snap('new-2', 'h4', 'まったく別の通達'), // genuine new
    ]);
    const r = computeBulkAggregation({
      before,
      after,
      totalEntries: 2,
      documentsFailed: 0,
      durationMs: 1000,
    });
    expect(r.newDocs).toBe(2);
    expect(r.orphanedDocs).toBe(2);
    expect(r.movedDocs).toBe(1); // 通達A の 1 ペアのみ
  });

  it('does not count update when hash is null on either side', () => {
    const before = snapshotMap([snap('a', null), snap('b', 'h2')]);
    const after = snapshotMap([snap('a', 'h1'), snap('b', null)]);
    const r = computeBulkAggregation({
      before,
      after,
      totalEntries: 2,
      documentsFailed: 0,
      durationMs: 1000,
    });
    // hash null は比較不能とみなして updatedDocs に数えない
    expect(r.updatedDocs).toBe(0);
  });

  it('computes failRate correctly', () => {
    const r = computeBulkAggregation({
      before: snapshotMap([]),
      after: snapshotMap([]),
      totalEntries: 100,
      documentsFailed: 5,
      durationMs: 1000,
    });
    expect(r.failRate).toBe(0.05);
    expect(r.documentsFetched).toBe(95);
  });

  it('handles totalEntries=0 (no failure ratio)', () => {
    const r = computeBulkAggregation({
      before: snapshotMap([]),
      after: snapshotMap([]),
      totalEntries: 0,
      documentsFailed: 0,
      durationMs: 1000,
    });
    expect(r.failRate).toBe(0);
  });

  it('uses provided ranAt if given', () => {
    const r = computeBulkAggregation({
      before: snapshotMap([]),
      after: snapshotMap([]),
      totalEntries: 0,
      documentsFailed: 0,
      durationMs: 0,
      ranAt: '2026-05-04T12:00:00Z',
    });
    expect(r.ranAt).toBe('2026-05-04T12:00:00Z');
  });

  it('generates current ISO timestamp when ranAt omitted', () => {
    const r = computeBulkAggregation({
      before: snapshotMap([]),
      after: snapshotMap([]),
      totalEntries: 0,
      documentsFailed: 0,
      durationMs: 0,
    });
    // ISO 8601 形式（YYYY-MM-DDTHH:MM:SS.sssZ）であること
    expect(r.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('recordBulkRun', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), 'houki-nta-bulk-aggr-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function pathFor(doc_type: string): string {
    return resolve(tmpDir, `baseline-${doc_type}.json`);
  }

  it('persists record and returns evaluation', () => {
    const path = pathFor('qa-jirei');
    const record = computeBulkAggregation({
      before: snapshotMap([]),
      after: snapshotMap([]),
      totalEntries: 1841,
      documentsFailed: 0,
      durationMs: 2000000,
    });
    const evaluation = recordBulkRun('qa-jirei', record, path);

    expect(evaluation.warn).toBe(false);
    const baseline = loadBaseline('qa-jirei', path);
    expect(baseline.history).toHaveLength(1);
    expect(baseline.history[0]?.totalEntries).toBe(1841);
  });

  it('warns when threshold is violated', () => {
    const path = pathFor('qa-jirei');
    // 既存の baseline を 3 件積んでおく
    for (let i = 0; i < 3; i++) {
      recordBulkRun(
        'qa-jirei',
        computeBulkAggregation({
          before: snapshotMap([]),
          after: snapshotMap([]),
          totalEntries: 1841,
          documentsFailed: 0,
          durationMs: 2000000,
          ranAt: `2026-05-0${i + 1}T00:00:00Z`,
        }),
        path
      );
    }
    // 50 件失敗 → fail rate threshold 違反
    const failingRecord = computeBulkAggregation({
      before: snapshotMap([]),
      after: snapshotMap([]),
      totalEntries: 1841,
      documentsFailed: 50,
      durationMs: 2000000,
      ranAt: '2026-05-04T00:00:00Z',
    });
    const evaluation = recordBulkRun('qa-jirei', failingRecord, path);

    expect(evaluation.warn).toBe(true);
    expect(evaluation.reasons.length).toBeGreaterThan(0);
  });

  it('does not warn on first ever run (empty baseline)', () => {
    const path = pathFor('kaisei');
    // 初回 = baseline 空 → count drift 判定は無し、fail rate のみで判定
    const record = computeBulkAggregation({
      before: snapshotMap([]),
      after: snapshotMap([]),
      totalEntries: 125,
      documentsFailed: 0,
      durationMs: 100000,
    });
    const evaluation = recordBulkRun('kaisei', record, path);
    expect(evaluation.warn).toBe(false);
  });
});

describe('diffKeys', () => {
  it('returns keys in A but not in B', () => {
    const a = new Map<string, number>([
      ['x', 1],
      ['y', 2],
      ['z', 3],
    ]);
    const b = new Map<string, number>([
      ['x', 1],
      ['z', 3],
    ]);
    expect(diffKeys(a, b)).toEqual(['y']);
  });

  it('returns empty array when A is subset of B', () => {
    const a = new Map<string, number>([['x', 1]]);
    const b = new Map<string, number>([
      ['x', 1],
      ['y', 2],
    ]);
    expect(diffKeys(a, b)).toEqual([]);
  });

  it('returns all keys when B is empty', () => {
    const a = new Map<string, number>([
      ['x', 1],
      ['y', 2],
    ]);
    const b = new Map<string, number>();
    expect(diffKeys(a, b).sort()).toEqual(['x', 'y']);
  });
});

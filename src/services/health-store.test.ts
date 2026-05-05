import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendBaseline,
  defaultBaselinePath,
  getLastRun,
  getMedianFailRate,
  getMedianTotal,
  HISTORY_LIMIT,
  loadBaseline,
  type BulkRunRecord,
} from './health-store.js';

describe('health-store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), 'houki-nta-health-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function pathFor(doc_type: string): string {
    return resolve(tmpDir, `baseline-${doc_type}.json`);
  }

  function makeRecord(overrides: Partial<BulkRunRecord> = {}): BulkRunRecord {
    return {
      ranAt: '2026-05-04T00:00:00Z',
      totalEntries: 1841,
      documentsFetched: 1841,
      documentsFailed: 0,
      newDocs: 0,
      updatedDocs: 0,
      orphanedDocs: 0,
      movedDocs: 0,
      failRate: 0,
      durationMs: 2087000,
      ...overrides,
    };
  }

  describe('defaultBaselinePath', () => {
    it('uses HOUKI_NTA_BASELINE_DIR when set', () => {
      const original = process.env.HOUKI_NTA_BASELINE_DIR;
      process.env.HOUKI_NTA_BASELINE_DIR = '/tmp/custom';
      try {
        const path = defaultBaselinePath('qa-jirei');
        expect(path).toBe('/tmp/custom/baseline-qa-jirei.json');
      } finally {
        if (original === undefined) delete process.env.HOUKI_NTA_BASELINE_DIR;
        else process.env.HOUKI_NTA_BASELINE_DIR = original;
      }
    });

    it('falls back to XDG_CACHE_HOME when HOUKI_NTA_BASELINE_DIR is unset', () => {
      const orig = {
        baseline: process.env.HOUKI_NTA_BASELINE_DIR,
        xdg: process.env.XDG_CACHE_HOME,
      };
      delete process.env.HOUKI_NTA_BASELINE_DIR;
      process.env.XDG_CACHE_HOME = '/tmp/xdg';
      try {
        const path = defaultBaselinePath('tax-answer');
        expect(path).toBe('/tmp/xdg/houki-nta-mcp/baseline-tax-answer.json');
      } finally {
        if (orig.baseline !== undefined) process.env.HOUKI_NTA_BASELINE_DIR = orig.baseline;
        if (orig.xdg !== undefined) process.env.XDG_CACHE_HOME = orig.xdg;
        else delete process.env.XDG_CACHE_HOME;
      }
    });
  });

  describe('loadBaseline', () => {
    it('returns empty baseline when file does not exist', () => {
      const baseline = loadBaseline('qa-jirei', pathFor('qa-jirei'));
      expect(baseline.doc_type).toBe('qa-jirei');
      expect(baseline.history).toEqual([]);
    });

    it('loads existing baseline file', () => {
      const path = pathFor('qa-jirei');
      writeFileSync(
        path,
        JSON.stringify({
          doc_type: 'qa-jirei',
          history: [makeRecord({ totalEntries: 1234 })],
        })
      );
      const baseline = loadBaseline('qa-jirei', path);
      expect(baseline.history).toHaveLength(1);
      expect(baseline.history[0]?.totalEntries).toBe(1234);
    });

    it('returns empty baseline when JSON is corrupt', () => {
      const path = pathFor('qa-jirei');
      writeFileSync(path, 'not valid json');
      const baseline = loadBaseline('qa-jirei', path);
      expect(baseline.history).toEqual([]);
    });

    it('returns empty baseline when doc_type does not match', () => {
      const path = pathFor('qa-jirei');
      writeFileSync(path, JSON.stringify({ doc_type: 'tax-answer', history: [makeRecord()] }));
      const baseline = loadBaseline('qa-jirei', path);
      expect(baseline.doc_type).toBe('qa-jirei');
      expect(baseline.history).toEqual([]);
    });

    it('returns empty baseline when history is not an array', () => {
      const path = pathFor('qa-jirei');
      writeFileSync(path, JSON.stringify({ doc_type: 'qa-jirei', history: null }));
      const baseline = loadBaseline('qa-jirei', path);
      expect(baseline.history).toEqual([]);
    });
  });

  describe('appendBaseline', () => {
    it('creates a new file when none exists', () => {
      const path = pathFor('kaisei');
      expect(existsSync(path)).toBe(false);
      const baseline = appendBaseline('kaisei', makeRecord(), path);
      expect(existsSync(path)).toBe(true);
      expect(baseline.history).toHaveLength(1);
    });

    it('appends to existing history', () => {
      const path = pathFor('kaisei');
      appendBaseline('kaisei', makeRecord({ totalEntries: 100 }), path);
      appendBaseline('kaisei', makeRecord({ totalEntries: 200 }), path);
      const baseline = loadBaseline('kaisei', path);
      expect(baseline.history).toHaveLength(2);
      expect(baseline.history[0]?.totalEntries).toBe(100);
      expect(baseline.history[1]?.totalEntries).toBe(200);
    });

    it('rotates to keep only HISTORY_LIMIT records', () => {
      const path = pathFor('qa-jirei');
      const total = HISTORY_LIMIT + 3;
      for (let i = 0; i < total; i++) {
        appendBaseline(
          'qa-jirei',
          makeRecord({ ranAt: `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z` }),
          path
        );
      }
      const baseline = loadBaseline('qa-jirei', path);
      expect(baseline.history).toHaveLength(HISTORY_LIMIT);
      // 古い 3 件 (i=0,1,2) は捨てられ、i=3..14 が残る
      expect(baseline.history[0]?.ranAt).toBe('2026-05-04T00:00:00Z');
      expect(baseline.history[HISTORY_LIMIT - 1]?.ranAt).toBe(
        `2026-05-${String(total).padStart(2, '0')}T00:00:00Z`
      );
    });

    it('creates parent directory if missing', () => {
      const nested = resolve(tmpDir, 'nested', 'subdir');
      const path = resolve(nested, 'baseline-tsutatsu-shohi.json');
      appendBaseline('tsutatsu-shohi', makeRecord(), path);
      expect(existsSync(path)).toBe(true);
    });
  });

  describe('getLastRun', () => {
    it('returns null when history is empty', () => {
      const baseline = loadBaseline('qa-jirei', pathFor('qa-jirei'));
      expect(getLastRun(baseline)).toBeNull();
    });

    it('returns the last appended record', () => {
      const path = pathFor('qa-jirei');
      appendBaseline('qa-jirei', makeRecord({ totalEntries: 100 }), path);
      appendBaseline('qa-jirei', makeRecord({ totalEntries: 200 }), path);
      const baseline = loadBaseline('qa-jirei', path);
      expect(getLastRun(baseline)?.totalEntries).toBe(200);
    });
  });

  describe('getMedianTotal', () => {
    it('returns 0 for empty history', () => {
      const baseline = loadBaseline('qa-jirei', pathFor('qa-jirei'));
      expect(getMedianTotal(baseline)).toBe(0);
    });

    it('returns the middle value for odd count', () => {
      const path = pathFor('qa-jirei');
      [1800, 1841, 1850, 1820, 1900].forEach((total) =>
        appendBaseline('qa-jirei', makeRecord({ totalEntries: total }), path)
      );
      const baseline = loadBaseline('qa-jirei', path);
      // sorted: 1800, 1820, 1841, 1850, 1900 → median = 1841
      expect(getMedianTotal(baseline)).toBe(1841);
    });

    it('returns the average of two middle values for even count', () => {
      const path = pathFor('qa-jirei');
      [100, 200, 300, 400].forEach((total) =>
        appendBaseline('qa-jirei', makeRecord({ totalEntries: total }), path)
      );
      const baseline = loadBaseline('qa-jirei', path);
      expect(getMedianTotal(baseline)).toBe(250);
    });
  });

  describe('getMedianFailRate', () => {
    it('returns 0 for empty history', () => {
      const baseline = loadBaseline('qa-jirei', pathFor('qa-jirei'));
      expect(getMedianFailRate(baseline)).toBe(0);
    });

    it('returns the middle failRate for odd count', () => {
      const path = pathFor('qa-jirei');
      [0, 0, 0.01, 0, 0].forEach((failRate) =>
        appendBaseline('qa-jirei', makeRecord({ failRate }), path)
      );
      const baseline = loadBaseline('qa-jirei', path);
      // sorted: 0, 0, 0, 0, 0.01 → median = 0
      expect(getMedianFailRate(baseline)).toBe(0);
    });

    it('returns the average for even count', () => {
      const path = pathFor('qa-jirei');
      [0, 0.02, 0.04, 0].forEach((failRate) =>
        appendBaseline('qa-jirei', makeRecord({ failRate }), path)
      );
      const baseline = loadBaseline('qa-jirei', path);
      // sorted: 0, 0, 0.02, 0.04 → middle = (0 + 0.02) / 2 = 0.01
      expect(getMedianFailRate(baseline)).toBe(0.01);
    });
  });

  it('handles all 9 baseline doc_types', () => {
    const docTypes = [
      // document テーブル 5 種
      'kaisei',
      'jimu-unei',
      'bunshokaitou',
      'tax-answer',
      'qa-jirei',
      // 基本通達 4 種 (通達ごとに分離)
      'tsutatsu-shohi',
      'tsutatsu-shotoku',
      'tsutatsu-hojin',
      'tsutatsu-sozoku',
    ] as const;
    for (const doc_type of docTypes) {
      const path = pathFor(doc_type);
      appendBaseline(doc_type, makeRecord({ totalEntries: 100 }), path);
      const baseline = loadBaseline(doc_type, path);
      expect(baseline.doc_type).toBe(doc_type);
      expect(baseline.history[0]?.totalEntries).toBe(100);
    }
  });
});

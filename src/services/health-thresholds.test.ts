import { describe, expect, it } from 'vitest';

import {
  COUNT_DRIFT_RATIO,
  evaluateHealth,
  FAIL_THRESHOLDS,
  shouldWarnCountDrift,
  shouldWarnFailRate,
  shouldWarnStructuralChange,
  STRUCTURAL_RATIO,
} from './health-thresholds.js';
import type { BulkRunRecord, DocTypeBaseline } from './health-store.js';

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

function makeBaseline(totals: number[]): DocTypeBaseline {
  return {
    doc_type: 'qa-jirei',
    history: totals.map((total) => makeRecord({ totalEntries: total })),
  };
}

describe('shouldWarnFailRate', () => {
  it('does not warn on fail rate 0', () => {
    expect(shouldWarnFailRate(makeRecord(), 'qa-jirei')).toBe(false);
  });

  it('does not warn when failedAbs is below MIN_ABS (small noise)', () => {
    // qa-jirei MIN_ABS=10, MIN_RATE=1%
    // 9 件失敗 / 1841 件 = 0.49% → MIN_ABS 未満で警告しない
    const record = makeRecord({ documentsFailed: 9 });
    expect(shouldWarnFailRate(record, 'qa-jirei')).toBe(false);
  });

  it('does not warn when rate is below MIN_RATE despite high abs', () => {
    // qa-jirei MIN_ABS=10, MIN_RATE=1%
    // 12 件失敗 / 100,000 件 = 0.012% → MIN_RATE 未満で警告しない
    const record = makeRecord({ documentsFailed: 12, totalEntries: 100000 });
    expect(shouldWarnFailRate(record, 'qa-jirei')).toBe(false);
  });

  it('warns when both MIN_ABS and MIN_RATE are exceeded', () => {
    // qa-jirei MIN_ABS=10, MIN_RATE=1%
    // 20 件失敗 / 1841 件 = 1.09% → 両方満たす
    const record = makeRecord({ documentsFailed: 20 });
    expect(shouldWarnFailRate(record, 'qa-jirei')).toBe(true);
  });

  it('uses smaller MIN_ABS for small doc_types', () => {
    // jimu-unei MIN_ABS=2
    const record = makeRecord({ documentsFailed: 2, totalEntries: 32 });
    expect(shouldWarnFailRate(record, 'jimu-unei')).toBe(true);
  });

  it('handles totalEntries=0 without crash', () => {
    const record = makeRecord({ totalEntries: 0, documentsFailed: 0 });
    expect(shouldWarnFailRate(record, 'qa-jirei')).toBe(false);
  });

  it('honors custom threshold override', () => {
    const record = makeRecord({ documentsFailed: 5 });
    // 通常の qa-jirei では 5 件は MIN_ABS=10 未満で false
    expect(shouldWarnFailRate(record, 'qa-jirei')).toBe(false);
    // override で MIN_ABS=3 にすれば true
    expect(shouldWarnFailRate(record, 'qa-jirei', { MIN_ABS: 3, MIN_RATE: 0.001 })).toBe(true);
  });
});

describe('shouldWarnCountDrift', () => {
  it('returns false when baseline is empty (cannot judge)', () => {
    const record = makeRecord({ totalEntries: 1000 });
    const baseline = makeBaseline([]);
    expect(shouldWarnCountDrift(record, baseline)).toBe(false);
  });

  it('does not warn when within drift range', () => {
    // baseline median = 1841, ±20% = 1473..2209
    const baseline = makeBaseline([1800, 1841, 1850, 1820, 1900]);
    const record = makeRecord({ totalEntries: 1700 }); // -7.7% → within
    expect(shouldWarnCountDrift(record, baseline)).toBe(false);
  });

  it('warns when below drift threshold', () => {
    const baseline = makeBaseline([1800, 1841, 1850]);
    // median 1841, -20.7%
    const record = makeRecord({ totalEntries: 1460 });
    expect(shouldWarnCountDrift(record, baseline)).toBe(true);
  });

  it('warns when above drift threshold', () => {
    const baseline = makeBaseline([1800, 1841, 1850]);
    const record = makeRecord({ totalEntries: 2300 }); // +24.9%
    expect(shouldWarnCountDrift(record, baseline)).toBe(true);
  });

  it('honors custom drift override', () => {
    const baseline = makeBaseline([100, 100, 100]);
    const record = makeRecord({ totalEntries: 110 }); // +10%
    expect(shouldWarnCountDrift(record, baseline)).toBe(false); // default 20%
    expect(shouldWarnCountDrift(record, baseline, 0.05)).toBe(true); // 5%
  });
});

describe('shouldWarnStructuralChange', () => {
  it('does not warn when no updates', () => {
    expect(shouldWarnStructuralChange(makeRecord())).toBe(false);
  });

  it('does not warn at 50% boundary (strictly greater)', () => {
    const record = makeRecord({ totalEntries: 100, updatedDocs: 50 });
    expect(shouldWarnStructuralChange(record)).toBe(false);
  });

  it('warns when updatedDocs ratio exceeds 50%', () => {
    const record = makeRecord({ totalEntries: 100, updatedDocs: 51 });
    expect(shouldWarnStructuralChange(record)).toBe(true);
  });

  it('handles totalEntries=0 without crash', () => {
    const record = makeRecord({ totalEntries: 0, updatedDocs: 0 });
    expect(shouldWarnStructuralChange(record)).toBe(false);
  });

  it('honors custom ratio override', () => {
    const record = makeRecord({ totalEntries: 100, updatedDocs: 30 });
    expect(shouldWarnStructuralChange(record)).toBe(false);
    expect(shouldWarnStructuralChange(record, 0.25)).toBe(true);
  });
});

describe('evaluateHealth', () => {
  it('returns warn=false with no reasons on healthy run', () => {
    const record = makeRecord();
    const baseline = makeBaseline([1800, 1841, 1850]);
    const result = evaluateHealth(record, 'qa-jirei', baseline);
    expect(result.warn).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('returns warn=true with fail rate reason', () => {
    const record = makeRecord({ documentsFailed: 50 }); // 2.7%
    const baseline = makeBaseline([1800, 1841, 1850]);
    const result = evaluateHealth(record, 'qa-jirei', baseline);
    expect(result.warn).toBe(true);
    expect(result.reasons.length).toBe(1);
    expect(result.reasons[0]).toContain('fail rate threshold 超過');
  });

  it('returns warn=true with count drift reason', () => {
    const record = makeRecord({ totalEntries: 1000 }); // baseline median 1841 から -45.7%
    const baseline = makeBaseline([1800, 1841, 1850]);
    const result = evaluateHealth(record, 'qa-jirei', baseline);
    expect(result.warn).toBe(true);
    expect(result.reasons.some((r) => r.includes('count drift'))).toBe(true);
  });

  it('returns warn=true with structural change reason', () => {
    const record = makeRecord({ totalEntries: 1841, updatedDocs: 1500 }); // 81%
    const baseline = makeBaseline([1800, 1841, 1850]);
    const result = evaluateHealth(record, 'qa-jirei', baseline);
    expect(result.warn).toBe(true);
    expect(result.reasons.some((r) => r.includes('構造変質'))).toBe(true);
  });

  it('reports multiple reasons in parallel', () => {
    const record = makeRecord({
      totalEntries: 800, // count drift -57%
      documentsFailed: 20, // fail rate 2.5%
      updatedDocs: 600, // structural 75%
    });
    const baseline = makeBaseline([1800, 1841, 1850]);
    const result = evaluateHealth(record, 'qa-jirei', baseline);
    expect(result.warn).toBe(true);
    expect(result.reasons.length).toBe(3);
  });

  it('skips count drift when baseline is empty', () => {
    const record = makeRecord({ totalEntries: 100 });
    const baseline = makeBaseline([]);
    const result = evaluateHealth(record, 'qa-jirei', baseline);
    expect(result.warn).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(result.details.medianTotal).toBe(0);
  });

  it('exposes raw indicators in details', () => {
    const record = makeRecord({
      totalEntries: 2000,
      documentsFailed: 15,
      updatedDocs: 100,
    });
    const baseline = makeBaseline([1800, 1841, 1850]);
    const result = evaluateHealth(record, 'qa-jirei', baseline);
    expect(result.details.failRate).toBeCloseTo(0.0075, 4);
    expect(result.details.medianTotal).toBe(1841);
    expect(result.details.structuralRatio).toBeCloseTo(0.05, 4);
  });
});

describe('FAIL_THRESHOLDS constants', () => {
  it('covers all 9 baseline doc_types', () => {
    const expected = [
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
    ];
    for (const doc_type of expected) {
      expect(FAIL_THRESHOLDS).toHaveProperty(doc_type);
      const t = FAIL_THRESHOLDS[doc_type as keyof typeof FAIL_THRESHOLDS];
      expect(t.MIN_ABS).toBeGreaterThan(0);
      expect(t.MIN_RATE).toBe(0.01);
    }
  });

  it('uses smaller MIN_ABS for smaller doc_types', () => {
    expect(FAIL_THRESHOLDS['jimu-unei'].MIN_ABS).toBeLessThan(FAIL_THRESHOLDS['qa-jirei'].MIN_ABS);
  });

  it('tsutatsu sozoku (smallest) has smaller MIN_ABS than hojin (largest)', () => {
    expect(FAIL_THRESHOLDS['tsutatsu-sozoku'].MIN_ABS).toBeLessThan(
      FAIL_THRESHOLDS['tsutatsu-hojin'].MIN_ABS
    );
  });
});

describe('default constants', () => {
  it('COUNT_DRIFT_RATIO is 20%', () => {
    expect(COUNT_DRIFT_RATIO).toBe(0.2);
  });

  it('STRUCTURAL_RATIO is 50%', () => {
    expect(STRUCTURAL_RATIO).toBe(0.5);
  });
});

/**
 * Tests for src/services/relevance-scoring.ts (Phase 6-1 / v0.8.0)
 */

import { describe, expect, it } from 'vitest';
import {
  computeRelevance,
  DOC_TYPE_WEIGHT,
  extractClauseNumberFromQuery,
  rankToBaseScore,
  sortByScoreDesc,
} from './relevance-scoring.js';

describe('extractClauseNumberFromQuery', () => {
  it('extracts standard 3-segment clause numbers', () => {
    expect(extractClauseNumberFromQuery('5-1-9')).toBe('5-1-9');
    expect(extractClauseNumberFromQuery('消基通 5-1-9 の取扱い')).toBe('5-1-9');
  });

  it('extracts 2-segment clause numbers (所基通 style)', () => {
    expect(extractClauseNumberFromQuery('2-4 の解釈')).toBe('2-4');
  });

  it('extracts clause numbers with の suffix', () => {
    expect(extractClauseNumberFromQuery('1-4-13の2')).toBe('1-4-13の2');
    expect(extractClauseNumberFromQuery('11-2-10の3 関連')).toBe('11-2-10の3');
  });

  it('returns null when no clause number is present', () => {
    expect(extractClauseNumberFromQuery('インボイス制度')).toBeNull();
    expect(extractClauseNumberFromQuery('消費税法基本通達')).toBeNull();
    expect(extractClauseNumberFromQuery('')).toBeNull();
  });
});

describe('rankToBaseScore', () => {
  it('returns 0 for rank=0 (no match)', () => {
    expect(rankToBaseScore(0)).toBe(0);
  });

  it('approaches 1 for very negative ranks (strong match)', () => {
    expect(rankToBaseScore(-1000)).toBeGreaterThan(0.99);
  });

  it('is monotonically increasing in |rank|', () => {
    const a = rankToBaseScore(-5);
    const b = rankToBaseScore(-15);
    const c = rankToBaseScore(-50);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it('handles non-finite gracefully', () => {
    expect(rankToBaseScore(Number.NaN)).toBe(0);
    expect(rankToBaseScore(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('DOC_TYPE_WEIGHT — legal hierarchy ordering', () => {
  it('tsutatsu > kaisei > bunshokaitou > jimu-unei > qa > tax-answer', () => {
    expect(DOC_TYPE_WEIGHT.tsutatsu).toBeGreaterThan(DOC_TYPE_WEIGHT.kaisei);
    expect(DOC_TYPE_WEIGHT.kaisei).toBeGreaterThan(DOC_TYPE_WEIGHT.bunshokaitou);
    expect(DOC_TYPE_WEIGHT.bunshokaitou).toBeGreaterThan(DOC_TYPE_WEIGHT['jimu-unei']);
    expect(DOC_TYPE_WEIGHT['jimu-unei']).toBeGreaterThan(DOC_TYPE_WEIGHT.qa);
    expect(DOC_TYPE_WEIGHT.qa).toBeGreaterThan(DOC_TYPE_WEIGHT['tax-answer']);
  });

  it('tsutatsu has weight 1.0 (top of hierarchy)', () => {
    expect(DOC_TYPE_WEIGHT.tsutatsu).toBe(1.0);
  });
});

describe('computeRelevance', () => {
  it('mentions doc_type weight in scoreReasons', () => {
    const r = computeRelevance({ rank: -10, docType: 'tsutatsu', query: 'foo' });
    expect(r.scoreReasons.some((s) => s.includes('doc_type=tsutatsu'))).toBe(true);
    expect(r.score).toBeGreaterThan(0);
  });

  it('applies clause exact match bonus when query and clauseNumber agree', () => {
    const matched = computeRelevance({
      rank: -10,
      docType: 'tsutatsu',
      clauseNumber: '5-1-9',
      query: '5-1-9',
    });
    const unmatched = computeRelevance({
      rank: -10,
      docType: 'tsutatsu',
      clauseNumber: '5-1-10',
      query: '5-1-9',
    });
    expect(matched.score).toBeGreaterThan(unmatched.score);
    expect(matched.scoreReasons).toContain('clause exact match');
    expect(unmatched.scoreReasons).not.toContain('clause exact match');
  });

  it('clause bonus does not apply when query has no clause number', () => {
    const r = computeRelevance({
      rank: -10,
      docType: 'tsutatsu',
      clauseNumber: '5-1-9',
      query: 'インボイス',
    });
    expect(r.scoreReasons).not.toContain('clause exact match');
  });

  it('higher doc_type yields higher score with same rank', () => {
    const tsutatsu = computeRelevance({ rank: -10, docType: 'tsutatsu', query: 'x' });
    const taxAnswer = computeRelevance({ rank: -10, docType: 'tax-answer', query: 'x' });
    expect(tsutatsu.score).toBeGreaterThan(taxAnswer.score);
  });

  it('caps score at 1.5 for extreme inputs', () => {
    const r = computeRelevance({
      rank: -100000,
      docType: 'tsutatsu',
      clauseNumber: '5-1-9',
      query: '5-1-9',
    });
    expect(r.score).toBeLessThanOrEqual(1.5);
  });

  it('handles unknown doc_type gracefully via fallback weight', () => {
    // @ts-expect-error testing runtime fallback for unknown doc_type
    const r = computeRelevance({ rank: -10, docType: 'unknown-type', query: 'x' });
    expect(r.score).toBeGreaterThan(0);
  });

  it('normalizes full-width hyphens / digits in clause comparison', () => {
    const r = computeRelevance({
      rank: -10,
      docType: 'tsutatsu',
      clauseNumber: '5-1-9',
      query: '５-１-９', // full-width
    });
    expect(r.scoreReasons).toContain('clause exact match');
  });
});

describe('sortByScoreDesc', () => {
  it('sorts by score descending', () => {
    const hits = [
      { rank: -10, score: 0.5 },
      { rank: -10, score: 0.9 },
      { rank: -10, score: 0.7 },
    ];
    const sorted = sortByScoreDesc(hits);
    expect(sorted.map((h) => h.score)).toEqual([0.9, 0.7, 0.5]);
  });

  it('falls back to rank ascending when scores are tied', () => {
    const hits = [
      { rank: -5, score: 0.5 },
      { rank: -20, score: 0.5 },
      { rank: -10, score: 0.5 },
    ];
    const sorted = sortByScoreDesc(hits);
    // smaller rank (more negative) comes first
    expect(sorted.map((h) => h.rank)).toEqual([-20, -10, -5]);
  });

  it('treats undefined score as 0', () => {
    const hits = [
      { rank: -10, score: undefined },
      { rank: -10, score: 0.3 },
    ];
    const sorted = sortByScoreDesc(hits);
    expect(sorted[0].score).toBe(0.3);
  });

  it('does not mutate input array', () => {
    const input = [
      { rank: -10, score: 0.1 },
      { rank: -10, score: 0.9 },
    ];
    const snapshot = JSON.stringify(input);
    sortByScoreDesc(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

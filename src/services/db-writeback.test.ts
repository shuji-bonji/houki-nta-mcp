/**
 * Phase 2e: writeBackLiveSection (write-through cache) のテスト。
 *
 * ライブ取得した clauses を DB に書き戻し、次回以降 DB lookup でヒットすることを確認。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type DatabaseT from 'better-sqlite3';

import { initSchema } from '../db/schema.js';
import { writeBackLiveSection } from './bulk-downloader.js';
import { getClauseFromDb } from './db-search.js';

describe('writeBackLiveSection', () => {
  let db: DatabaseT.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
  });
  afterEach(() => {
    db.close();
  });

  it('新規 section を書き込み、getClauseFromDb で取り出せる', () => {
    const written = writeBackLiveSection(db, {
      formalName: '消費税法基本通達',
      abbr: '消基通',
      rootUrl: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/',
      chapterNumber: 1,
      sectionNumber: 4,
      sectionUrl: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm',
      fetchedAt: '2026-05-02T00:00:00.000Z',
      sectionTitle: '第4節 個人事業者の納税義務',
      chapterTitle: '第1章 納税義務者',
      clauses: [
        {
          clauseNumber: '1-4-1',
          title: '個人事業者と給与所得者の区分',
          fullText: '事業者とは…',
          paragraphs: [{ indent: 1, text: '事業者とは…' }],
        },
        {
          clauseNumber: '1-4-2',
          title: 'テスト 2',
          fullText: 'テスト本文 2',
          paragraphs: [{ indent: 1, text: 'テスト本文 2' }],
        },
      ],
    });
    expect(written).toBe(2);

    // DB から引ける
    const got = getClauseFromDb(db, '消費税法基本通達', '1-4-1');
    expect(got).not.toBeNull();
    expect(got!.title).toBe('個人事業者と給与所得者の区分');
    expect(got!.fullText).toBe('事業者とは…');
    expect(got!.sourceUrl).toBe('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm');
    expect(got!.fetchedAt).toBe('2026-05-02T00:00:00.000Z');
  });

  it('同じ clause を再度書き込むと最新で上書き（重複違反にならない）', () => {
    const opts = (title: string) => ({
      formalName: '消費税法基本通達',
      abbr: '消基通',
      rootUrl: 'https://x/',
      chapterNumber: 1,
      sectionNumber: 1,
      sectionUrl: 'https://x/01/01.htm',
      fetchedAt: '2026-05-02T00:00:00.000Z',
      sectionTitle: 'sec',
      chapterTitle: 'ch',
      clauses: [
        {
          clauseNumber: '1-1-1',
          title,
          fullText: title,
          paragraphs: [{ indent: 1 as const, text: title }],
        },
      ],
    });
    expect(writeBackLiveSection(db, opts('v1'))).toBe(1);
    expect(writeBackLiveSection(db, opts('v2'))).toBe(1);
    const got = getClauseFromDb(db, '消費税法基本通達', '1-1-1');
    expect(got!.title).toBe('v2');
  });

  it('全角ハイフン・全角チルダ・全角数字は normalize されて格納される', () => {
    writeBackLiveSection(db, {
      formalName: '消費税法基本通達',
      abbr: '消基通',
      rootUrl: 'https://x/',
      chapterNumber: 1,
      sectionNumber: 1,
      sectionUrl: 'https://x/01/01.htm',
      fetchedAt: '2026-05-02T00:00:00.000Z',
      sectionTitle: 'sec',
      chapterTitle: 'ch',
      clauses: [
        {
          clauseNumber: '1-1-1',
          title: '全角１２３－４',
          fullText: '本文 with 全角ハイフン－と全角チルダ～が混入',
          paragraphs: [{ indent: 1, text: '本文 with 全角ハイフン－と全角チルダ～が混入' }],
        },
      ],
    });
    const got = getClauseFromDb(db, '消費税法基本通達', '1-1-1');
    expect(got!.title).toBe('全角123-4');
    expect(got!.fullText).toContain('全角ハイフン-と');
    expect(got!.fullText).toContain('全角チルダ~が');
  });

  it('failure path: 不正な入力で書き込みが失敗しても 0 を返し例外を投げない', () => {
    // tsutatsu/section の挿入は OK だが、clause 投入時に paragraphs_json に
    // 何か壊れた値を入れて失敗を発生させるのは難しいので、ここでは「DB を閉じた状態で呼ぶ」
    db.close();
    const result = writeBackLiveSection(db, {
      formalName: '消費税法基本通達',
      abbr: '消基通',
      rootUrl: 'https://x/',
      chapterNumber: 1,
      sectionNumber: 1,
      sectionUrl: 'https://x/01/01.htm',
      fetchedAt: '2026-05-02T00:00:00.000Z',
      sectionTitle: 'sec',
      chapterTitle: 'ch',
      clauses: [
        {
          clauseNumber: '1-1-1',
          title: 't',
          fullText: 'b',
          paragraphs: [{ indent: 1, text: 'b' }],
        },
      ],
    });
    expect(result).toBe(0);
    // afterEach で db.close() を再度呼ぶので新たに開き直す
    db = new Database(':memory:');
    initSchema(db);
  });
});

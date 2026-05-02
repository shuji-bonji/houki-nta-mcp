/**
 * Phase 2e: 改正検知 (findStaleSections) のテスト。
 *
 * SQLite の datetime() 関数で「N 日前」を計算し、それより古い fetched_at を持つ
 * section を返すヘルパー関数の振る舞いを確認する。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type DatabaseT from 'better-sqlite3';

import { initSchema } from '../db/schema.js';
import { findStaleSections } from './db-search.js';

/** N 日前の ISO timestamp を返す */
function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

/** 1 通達 + 複数 section を seed */
function seedSections(
  db: DatabaseT.Database,
  formalName: string,
  abbr: string,
  rootUrl: string,
  sections: Array<{
    chapter: number;
    section: number;
    fetchedAt: string;
  }>
): void {
  const id = (
    db
      .prepare(
        `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
      )
      .get(formalName, abbr, rootUrl) as { id: number }
  ).id;
  const insertCh = db.prepare(
    `INSERT OR REPLACE INTO chapter(tsutatsu_id, number, title) VALUES (?, ?, ?)`
  );
  const insertSec = db.prepare(
    `INSERT OR REPLACE INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const s of sections) {
    insertCh.run(id, s.chapter, `第${s.chapter}章`);
    insertSec.run(
      id,
      s.chapter,
      s.section,
      `第${s.section}節`,
      `${rootUrl}${s.chapter}/${s.section}.htm`,
      s.fetchedAt,
      'hash-dummy'
    );
  }
}

describe('findStaleSections', () => {
  let db: DatabaseT.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
  });
  afterEach(() => {
    db.close();
  });

  it('30 日より古い section だけが返る', () => {
    seedSections(db, '消費税法基本通達', '消基通', 'https://x/', [
      { chapter: 1, section: 1, fetchedAt: daysAgoIso(60) }, // 古い
      { chapter: 1, section: 2, fetchedAt: daysAgoIso(45) }, // 古い
      { chapter: 1, section: 3, fetchedAt: daysAgoIso(10) }, // 新しい
      { chapter: 1, section: 4, fetchedAt: new Date().toISOString() }, // 今日
    ]);
    const stale = findStaleSections(db, 30);
    expect(stale.length).toBe(2);
    expect(stale.map((s) => s.sectionNumber).sort()).toEqual([1, 2]);
  });

  it('formalName で絞り込める', () => {
    seedSections(db, '消費税法基本通達', '消基通', 'https://shohi/', [
      { chapter: 1, section: 1, fetchedAt: daysAgoIso(60) },
    ]);
    seedSections(db, '所得税基本通達', '所基通', 'https://shotoku/', [
      { chapter: 1, section: 1, fetchedAt: daysAgoIso(60) },
    ]);
    const onlyShohi = findStaleSections(db, 30, '消費税法基本通達');
    expect(onlyShohi.length).toBe(1);
    expect(onlyShohi[0].formalName).toBe('消費税法基本通達');
  });

  it('該当が無ければ空配列', () => {
    seedSections(db, '消費税法基本通達', '消基通', 'https://x/', [
      { chapter: 1, section: 1, fetchedAt: new Date().toISOString() },
    ]);
    expect(findStaleSections(db, 30)).toEqual([]);
  });

  it('古い順（昇順）でソートされる', () => {
    seedSections(db, '消費税法基本通達', '消基通', 'https://x/', [
      { chapter: 1, section: 2, fetchedAt: daysAgoIso(40) },
      { chapter: 1, section: 1, fetchedAt: daysAgoIso(60) }, // 一番古い
      { chapter: 1, section: 3, fetchedAt: daysAgoIso(50) },
    ]);
    const stale = findStaleSections(db, 30);
    expect(stale.map((s) => s.sectionNumber)).toEqual([1, 3, 2]);
  });
});

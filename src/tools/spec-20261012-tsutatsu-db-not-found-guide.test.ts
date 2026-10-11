/**
 * 差分 20261012-tsutatsu-db-not-found-guide（houki-nta-mcp #164）の受入テスト。
 *
 * - SPEC-NTA-GET-TSUTATSU-005 DB に通達はあるが条項が無いときの hint と next_actions（国税庁サイトの経路 010 と同じ組み立て）
 * - SPEC-NTA-GET-TSUTATSU-019 available_clauses_total と、上限で切れたときの hint の文
 *
 * 国税庁サイトには取りに行かない経路なので、fetch は呼ばれてはいけない。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initSchema } from '../db/schema.js';
import { writeBackLiveSection } from '../services/bulk-downloader.js';
import { getTsutatsu } from './handlers.js';

const NTA_ORIGIN = 'https://www.nta.go.jp';
const BULK_COMMAND_SHOHI =
  'npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download --tsutatsu="消費税法基本通達"';

interface NotFound {
  code?: string;
  error?: string;
  hint?: string;
  available_clauses?: string[];
  available_clauses_total?: number;
  next_actions?: Array<{ action: string; example?: Record<string, unknown> }>;
  retryable?: boolean;
  detail?: unknown;
}

function fetchMustNotBeCalled(): typeof fetch {
  return vi.fn(async () => {
    throw new Error('国税庁サイトを取りに行ってはいけない');
  }) as unknown as typeof fetch;
}

/** 消費税法基本通達の条項を DB に入れ、bulk download で全節取り込んだ印（tsutatsu.bulk_completed_at）を付ける */
function seedShohiBulkCompleted(dbPath: string, clauses: string[]): void {
  const db = new Database(dbPath);
  initSchema(db);
  const tsutatsuId = (
    db
      .prepare(
        `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
      )
      .get('消費税法基本通達', '消基通', `${NTA_ORIGIN}/law/tsutatsu/kihon/shohi/`) as {
      id: number;
    }
  ).id;
  const insert = db.prepare(
    `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const clauseNumber of clauses) {
    const [chapter, section] = clauseNumber.split('-').map(Number);
    insert.run(
      tsutatsuId,
      clauseNumber,
      `${NTA_ORIGIN}/law/tsutatsu/kihon/shohi/0${chapter}/0${section}.htm`,
      chapter,
      section,
      `表題 ${clauseNumber}`,
      `本文 ${clauseNumber}`,
      '[]'
    );
  }
  db.prepare('UPDATE tsutatsu SET bulk_completed_at = ? WHERE id = ?').run(
    '2026-09-01T00:00:00.000Z',
    tsutatsuId
  );
  db.close();
}

describe('SPEC-NTA-GET-TSUTATSU-005 DB に通達はあるが条項が無いときは、国税庁サイトから取らない通達なら番号の候補と探し方を返す', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-164-005-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('SPEC-NTA-GET-TSUTATSU-005 (a) bulk download 済みの基本通達 4 種: hint に番号の形・nta_search_tsutatsu・027 の形の --bulk-download --tsutatsu のコマンド、next_actions は 2 件', async () => {
    const dbPath = join(dir, 'shohi-bulk.db');
    seedShohiBulkCompleted(dbPath, ['1-1-1', '1-1-2', '5-1-1']);
    const fetchImpl = fetchMustNotBeCalled();

    const r = (await getTsutatsu(
      { name: '消基通', clause: '99-9-9', format: 'json' },
      { fetchImpl, dbPath }
    )) as NotFound;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.error).toBe('clause "99-9-9" は DB 内の "消費税法基本通達" に見つかりません');
    // 番号の形（消基通は 章-節-条）の確認
    expect(r.hint).toContain('消費税法基本通達の番号の形は 章-節-条（例: 5-1-9 / 1-4-13の2）');
    expect(r.hint).toContain('番号の形を確かめてください');
    expect(r.hint).toContain('`nta_search_tsutatsu` で条項を検索するか');
    // 案内のコマンドは SPEC-NTA-DB-SCHEMA-027 の形。dbPath を渡したときは HOUKI_NTA_DB_PATH を指定したときと同じ
    expect(r.hint).toContain(`\`HOUKI_NTA_DB_PATH=`);
    expect(r.hint).toContain(
      `${BULK_COMMAND_SHOHI}\` で全節を取り直すと、DB に投入した後の改正を反映できます`
    );
    // フラグだけの文（v0.27.0）ではない
    expect(r.hint).not.toContain('再取得してください');
    expect(r.next_actions?.map((a) => a.action)).toEqual([
      'nta_search_tsutatsu',
      'cli_bulk_download',
    ]);
    expect(r.next_actions?.[0]?.example).toEqual({ keyword: '99-9-9' });
    const command = r.next_actions?.[1]?.example?.command;
    expect(typeof command).toBe('string');
    expect(command).toMatch(/^HOUKI_NTA_DB_PATH=/);
    expect(command).toContain(BULK_COMMAND_SHOHI);
    expect(r.hint).toContain(`\`${command}\``);
    expect(r.available_clauses).toEqual(['1-1-1', '1-1-2', '5-1-1']);
    expect(r.retryable).toBeUndefined();
    expect(r.detail).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('SPEC-NTA-GET-TSUTATSU-005 (b) 基本通達 4 種以外の通達の条項が DB にあるとき: 投入のコマンドを案内せず、next_actions は nta_search_tsutatsu の 1 件', async () => {
    const formalName = resolveAbbreviation('電帳法取通')?.formal;
    expect(formalName).toBeDefined();
    const dbPath = join(dir, 'denshicho.db');
    const db = new Database(dbPath);
    try {
      initSchema(db);
      writeBackLiveSection(db, {
        formalName: `${formalName}`,
        abbr: '電帳法取通',
        rootUrl: `${NTA_ORIGIN}/law/tsutatsu/kobetsu/denshicho/`,
        chapterNumber: 4,
        sectionNumber: 1,
        sectionUrl: `${NTA_ORIGIN}/law/tsutatsu/kobetsu/denshicho/04/01.htm`,
        fetchedAt: '2026-09-01T00:00:00.000Z',
        sectionTitle: '第1節 テスト',
        chapterTitle: '第4章 テスト',
        clauses: [
          {
            clauseNumber: '4-1',
            title: 'テストの条項',
            fullText: 'テストの本文',
            paragraphs: [{ indent: 1, text: 'テストの本文' }],
          },
        ],
      });
    } finally {
      db.close();
    }
    const fetchImpl = fetchMustNotBeCalled();

    const r = (await getTsutatsu(
      { name: '電帳法取通', clause: '4-99', format: 'json' },
      { fetchImpl, dbPath }
    )) as NotFound;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.hint).toContain(
      `この通達（${formalName}）は国税庁サイトから取れず、投入のフラグ（--bulk-download の --tsutatsu）でも DB に入れられません（入れられるのは基本通達 4 種だけです）`
    );
    expect(r.hint).toContain('DB にある条項は available_clauses のとおりです');
    expect(r.hint).toContain('`nta_search_tsutatsu` で条項を検索してください');
    expect(r.hint).not.toContain('--bulk-download --tsutatsu');
    expect(r.hint).not.toContain('npx -y');
    expect(r.next_actions?.map((a) => a.action)).toEqual(['nta_search_tsutatsu']);
    expect(r.available_clauses).toEqual(['4-1']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('SPEC-NTA-GET-TSUTATSU-019 available_clauses を返すときは元になった条項の総数を available_clauses_total に付け、上限で切れたときは hint に書く', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-164-019-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('SPEC-NTA-GET-TSUTATSU-019 DB に 60 件あるとき: available_clauses は先頭 50 件、available_clauses_total は 60、hint の末尾に「先頭 50 件です（全 60 件）」', async () => {
    const dbPath = join(dir, 'sixty.db');
    seedShohiBulkCompleted(
      dbPath,
      Array.from({ length: 60 }, (_, i) => `1-1-${i + 1}`)
    );

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as NotFound;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.available_clauses).toHaveLength(50);
    expect(r.available_clauses?.[0]).toBe('1-1-1');
    expect(r.available_clauses?.[49]).toBe('1-1-50');
    expect(r.available_clauses_total).toBe(60);
    expect(r.hint?.endsWith('。available_clauses は先頭 50 件です（全 60 件）')).toBe(true);
  });

  it('SPEC-NTA-GET-TSUTATSU-019 DB に 3 件のとき: available_clauses は全件、available_clauses_total は 3、hint に打ち切りの文は無い', async () => {
    const dbPath = join(dir, 'three.db');
    seedShohiBulkCompleted(dbPath, ['1-1-1', '1-1-2', '1-1-3']);

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as NotFound;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.available_clauses).toEqual(['1-1-1', '1-1-2', '1-1-3']);
    expect(r.available_clauses_total).toBe(3);
    expect(r.hint).not.toContain('先頭 50 件');
  });

  it('SPEC-NTA-GET-TSUTATSU-019 available_clauses を返さないエラー（clause の省略）には available_clauses_total も付かない', async () => {
    const r = (await getTsutatsu(
      { name: '消基通', format: 'json' },
      { dbPath: ':memory:' }
    )) as NotFound;

    expect(r.code).toBe('INVALID_ARGUMENT');
    expect(r.available_clauses).toBeUndefined();
    expect(r.available_clauses_total).toBeUndefined();
  });
});

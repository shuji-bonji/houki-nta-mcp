/**
 * v0.14.1: 取得系（改正通達・事務運営指針・文書回答事例）で docId が DB に無いとき、理由を分けて返す。
 *
 * - その種別の文書が DB に 1 件も無い → 投入を案内する（next_actions は cli_bulk_download）
 * - 文書はあるが、その docId が無い → 「見つかりません」。available_doc_ids と検索ツールへの next_actions
 *
 * v0.14.0 までは、どちらの場合も「DB に未投入です」と返し、bulk download を案内していた。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initSchema } from '../db/schema.js';
import {
  handleNtaGetBunshokaitou,
  handleNtaGetJimuUnei,
  handleNtaGetKaiseiTsutatsu,
} from './handlers.js';

interface NotFoundResponse {
  code?: string;
  error?: string;
  hint?: string;
  tool?: string;
  available_doc_ids?: Array<{ docId: string; title: string; issuedAt: string | null }>;
  next_actions?: Array<{ action: string; example?: { command?: string } }>;
}

function seed(dbPath: string, docs: Array<[docType: string, docId: string, title: string]>) {
  const db = new Database(dbPath);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [docType, docId, title] of docs) {
    stmt.run(
      docType,
      docId,
      'shohi',
      title,
      `https://x/${docType}/${docId}.htm`,
      new Date().toISOString(),
      `${title}の本文`,
      '[]',
      null
    );
  }
  db.close();
}

type Getter = (docId: string, dbPath: string) => Promise<unknown>;

const cases: ReadonlyArray<
  [
    tool: string,
    docType: string,
    code: string,
    flag: string,
    searchTool: string,
    label: string,
    call: Getter,
  ]
> = [
  [
    'nta_get_kaisei_tsutatsu',
    'kaisei',
    'TSUTATSU_NOT_FOUND',
    '--bulk-download-kaisei',
    'nta_search_kaisei_tsutatsu',
    '改正通達',
    (docId, dbPath) => handleNtaGetKaiseiTsutatsu({ docId }, { dbPath }),
  ],
  [
    'nta_get_jimu_unei',
    'jimu-unei',
    'TSUTATSU_NOT_FOUND',
    '--bulk-download-jimu-unei',
    'nta_search_jimu_unei',
    '事務運営指針',
    (docId, dbPath) => handleNtaGetJimuUnei({ docId }, { dbPath }),
  ],
  [
    'nta_get_bunshokaitou',
    'bunshokaitou',
    'DOC_NOT_FOUND',
    '--bulk-download-bunshokaitou',
    'nta_search_bunshokaitou',
    '文書回答事例',
    (docId, dbPath) => handleNtaGetBunshokaitou({ docId }, { dbPath }),
  ],
];

describe('取得系: その種別の文書が DB に 1 件も無いときは投入を案内する', () => {
  for (const [tool, , code, flag, , label, call] of cases) {
    it(`SPEC-NTA-GET-JIMU-UNEI-001 SPEC-NTA-GET-BUNSHOKAITOU-002 ${tool}: code=${code}、next_actions に ${flag}、hint に DB のパス`, async () => {
      const r = (await call('0025004-999', ':memory:')) as NotFoundResponse;
      expect(r.code).toBe(code);
      expect(r.tool).toBe(tool);
      expect(r.error).toBe(
        `ローカル DB に${label}が 1 件も無いため、docId="0025004-999" を取得できません`
      );
      expect(r.hint).toContain(':memory:');
      expect(r.hint).toContain('HOUKI_NTA_DB_PATH');
      expect(r.available_doc_ids).toBeUndefined();
      expect(r.next_actions?.[0]?.action).toBe('cli_bulk_download');
      expect(r.next_actions?.[0]?.example?.command).toBe(`houki-nta-mcp ${flag}`);
    });
  }
});

describe('取得系: 文書がある DB で docId が無いときは「見つかりません」', () => {
  let dir: string;
  let dbPath: string;
  let otherTypeOnlyPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-get-not-found-'));
    dbPath = join(dir, 'cache.db');
    seed(dbPath, [
      ['kaisei', '0025004-026', '消費税法基本通達の一部改正について'],
      ['jimu-unei', 'shotoku/shinkoku/170331', '調査手続の実施に当たっての指針'],
      ['bunshokaitou', 'shotoku/250416', '外国法人から受ける配当'],
    ]);
    // 質疑応答事例だけの DB: 取得する種別の文書は 0 件
    otherTypeOnlyPath = join(dir, 'qa-only.db');
    seed(otherTypeOnlyPath, [['qa-jirei', 'shohi/02/19', '会議費と軽減税率']]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  for (const [tool, docType, code, flag, searchTool, label, call] of cases) {
    it(`SPEC-NTA-GET-JIMU-UNEI-002 SPEC-NTA-GET-BUNSHOKAITOU-003 ${tool}: 「見つかりません」、available_doc_ids、next_actions に ${searchTool}`, async () => {
      const r = (await call('no-such-doc', dbPath)) as NotFoundResponse;
      expect(r.code).toBe(code);
      expect(r.tool).toBe(tool);
      expect(r.error).toBe(`${label} docId="no-such-doc" は見つかりません`);
      expect(r.error).not.toContain('未投入');
      expect(r.hint).toContain(`DB の${label} 1 件に、この docId はありません`);
      expect(r.hint).toContain(searchTool);
      expect(r.hint).toContain(`houki-nta-mcp ${flag}`);
      expect(r.available_doc_ids?.map((d) => d.docId)).toHaveLength(1);
      expect(r.next_actions).toEqual([
        { action: searchTool, reason: 'キーワード検索で正しい docId を探せます' },
      ]);
      // 別の種別の docId は available_doc_ids に入らない
      expect(r.available_doc_ids?.every((d) => !d.docId.includes('/02/'))).toBe(true);
      expect(docType).toBeTruthy();
    });

    it(`SPEC-NTA-GET-JIMU-UNEI-001 SPEC-NTA-GET-BUNSHOKAITOU-002 ${tool}: 別の種別の文書しか無い DB では投入を案内する`, async () => {
      const r = (await call('no-such-doc', otherTypeOnlyPath)) as NotFoundResponse;
      expect(r.code).toBe(code);
      expect(r.next_actions?.[0]?.action).toBe('cli_bulk_download');
      expect(r.next_actions?.[0]?.example?.command).toBe(`houki-nta-mcp ${flag}`);
    });

    it(`SPEC-NTA-GET-JIMU-UNEI-003 SPEC-NTA-GET-BUNSHOKAITOU-001 ${tool}: DB にある docId はこれまでどおり取得できる`, async () => {
      const docId =
        docType === 'kaisei'
          ? '0025004-026'
          : docType === 'jimu-unei'
            ? 'shotoku/shinkoku/170331'
            : 'shotoku/250416';
      const r = (await call(docId, dbPath)) as NotFoundResponse;
      expect(r.code).toBeUndefined();
    });
  }
});

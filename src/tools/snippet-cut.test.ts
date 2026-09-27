/**
 * houki-nta-mcp#97: 検索の snippet が、4 文字以上の語の途中で `<b>` を閉じて切れる。
 *
 * - SPEC-NTA-SEARCH-RULES-015: 文書系 5 ツールの results[].snippet は「合った語を <b> で囲む」
 * - SPEC-NTA-SEARCH-TSUTATSU-004: nta_search_tsutatsu の hits[].snippet は「一致した語を <b>…</b> で囲んだ前後の抜粋」
 *
 * trigram では 4 文字以上の語が 2 つ以上のトークンにまたがる。語が抜粋の端にかかる本文で、
 * 語全体が 1 組の <b>…</b> に入ることを確かめる。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initSchema } from '../db/schema.js';
import {
  handleNtaSearchBunshokaitou,
  handleNtaSearchJimuUnei,
  handleNtaSearchKaiseiTsutatsu,
  handleNtaSearchQa,
  handleNtaSearchTaxAnswer,
  searchTsutatsu,
} from './handlers.js';

const KEYWORD = '源泉徴収';
/** 語が 16 文字目より後ろにある本文（RED になった例と同じ） */
const LATE_BODY = '相続財産から支払う報酬に対する源泉徴収の要否について回答する';
/** 語が長い本文の中ほどにある本文 */
const MIDDLE_BODY = `${'前置きの文です。'.repeat(8)}${KEYWORD}${'後に続く文です。'.repeat(8)}`;

const DOC_TYPES = [
  { tool: 'nta_search_qa', docType: 'qa-jirei', taxonomy: 'shotoku' },
  { tool: 'nta_search_tax_answer', docType: 'tax-answer', taxonomy: 'shotoku' },
  { tool: 'nta_search_kaisei_tsutatsu', docType: 'kaisei', taxonomy: 'shotoku' },
  { tool: 'nta_search_jimu_unei', docType: 'jimu-unei', taxonomy: 'shotoku' },
  { tool: 'nta_search_bunshokaitou', docType: 'bunshokaitou', taxonomy: 'sozoku' },
] as const;

type Tool = (typeof DOC_TYPES)[number]['tool'];

interface DocResponse {
  results?: Array<{ docId: string; snippet: string }>;
}
interface ClauseResponse {
  hits?: Array<{ clauseNumber: string; snippet: string }>;
}

let dir: string;
let latePath: string;
let middlePath: string;

function seed(dbPath: string, body: string): void {
  const db = new Database(dbPath);
  initSchema(db);
  const insertDoc = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES (?, ?, ?, ?, ?, '2026-09-27T00:00:00Z', ?, '[]', NULL)`
  );
  for (const d of DOC_TYPES) {
    insertDoc.run(
      d.docType,
      `${d.docType}-1`,
      d.taxonomy,
      '回答事例',
      `https://x/${d.docType}/1.htm`,
      body
    );
  }
  const tsutatsuId = (
    db
      .prepare(
        `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES ('所得税基本通達', '所基通', 'https://x/shotoku/') RETURNING id`
      )
      .get() as { id: number }
  ).id;
  db.prepare(
    `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at)
     VALUES (?, 1, 1, '源泉徴収の通則', 'https://x/shotoku/1/1.htm', '2026-09-27T00:00:00Z')`
  ).run(tsutatsuId);
  db.prepare(
    `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
     VALUES (?, '183-1', 'https://x/shotoku/1/1.htm', 1, 1, '報酬の支払', ?, ?)`
  ).run(tsutatsuId, body, JSON.stringify([{ indent: 1, text: body }]));
  db.close();
}

function searchDocs(tool: Tool, dbPath: string): Promise<unknown> {
  const args = { keyword: KEYWORD };
  switch (tool) {
    case 'nta_search_qa':
      return handleNtaSearchQa(args, { dbPath });
    case 'nta_search_tax_answer':
      return handleNtaSearchTaxAnswer(args, { dbPath });
    case 'nta_search_kaisei_tsutatsu':
      return handleNtaSearchKaiseiTsutatsu(args, { dbPath });
    case 'nta_search_jimu_unei':
      return handleNtaSearchJimuUnei(args, { dbPath });
    case 'nta_search_bunshokaitou':
      return handleNtaSearchBunshokaitou(args, { dbPath });
  }
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-snippet-cut-'));
  latePath = join(dir, 'late.db');
  middlePath = join(dir, 'middle.db');
  seed(latePath, LATE_BODY);
  seed(middlePath, MIDDLE_BODY);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SPEC-NTA-SEARCH-RULES-015 文書系 5 ツールの snippet は合った語全体を <b> で囲む（#97）', () => {
  for (const { tool } of DOC_TYPES) {
    it(`SPEC-NTA-SEARCH-RULES-015 ${tool}: 語が本文の 16 文字目より後ろにあっても、snippet に <b>${KEYWORD}</b> が入る`, async () => {
      const r = (await searchDocs(tool, latePath)) as DocResponse;
      expect(r.results?.length).toBe(1);
      const snippet = r.results?.[0]?.snippet ?? '';
      expect(snippet).toContain(`<b>${KEYWORD}</b>`);
      expect(count(snippet, '<b>')).toBe(count(snippet, '</b>'));
    });

    it(`SPEC-NTA-SEARCH-RULES-015 ${tool}: 語が長い本文の中ほどにあるときは、前後を切った両側に … を付け、<b> と </b> が対になる`, async () => {
      const r = (await searchDocs(tool, middlePath)) as DocResponse;
      const snippet = r.results?.[0]?.snippet ?? '';
      expect(snippet).toContain(`<b>${KEYWORD}</b>`);
      expect(snippet.startsWith(' … ')).toBe(true);
      expect(snippet.endsWith(' … ')).toBe(true);
      expect(count(snippet, '<b>')).toBe(count(snippet, '</b>'));
    });
  }
});

describe('SPEC-NTA-SEARCH-TSUTATSU-004 nta_search_tsutatsu の snippet は一致した語全体を <b> で囲む（#97）', () => {
  it(`SPEC-NTA-SEARCH-TSUTATSU-004 nta_search_tsutatsu: 語が本文の 16 文字目より後ろにあっても、snippet に <b>${KEYWORD}</b> が入る`, async () => {
    const r = (await searchTsutatsu({ keyword: KEYWORD }, { dbPath: latePath })) as ClauseResponse;
    expect(r.hits?.length).toBe(1);
    const snippet = r.hits?.[0]?.snippet ?? '';
    expect(snippet).toContain(`<b>${KEYWORD}</b>`);
    expect(count(snippet, '<b>')).toBe(count(snippet, '</b>'));
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-004 nta_search_tsutatsu: 語が長い本文の中ほどにあるときは、前後を切った両側に … を付け、<b> と </b> が対になる', async () => {
    const r = (await searchTsutatsu(
      { keyword: KEYWORD },
      { dbPath: middlePath }
    )) as ClauseResponse;
    const snippet = r.hits?.[0]?.snippet ?? '';
    expect(snippet).toContain(`<b>${KEYWORD}</b>`);
    expect(snippet.startsWith(' … ')).toBe(true);
    expect(snippet.endsWith(' … ')).toBe(true);
    expect(count(snippet, '<b>')).toBe(count(snippet, '</b>'));
  });
});

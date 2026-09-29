/**
 * 差分 specs/changes/20260930-nta-73-db-values/ の受入テスト（#73）。
 *
 * nta_get_tax_answer の記事番号（SPEC-NTA-GET-TAX-ANSWER-008・011）、
 * nta_get_kaisei_tsutatsu の kind の無い添付 PDF（SPEC-NTA-GET-KAISEI-TSUTATSU-005・006・008）、
 * nta_inspect_pdf_meta の保存ファイル名（SPEC-NTA-INSPECT-PDF-META-010・018）を確かめる。
 * 期待値は差分の spec.md と proposal.md、specs/current/ の本文から決めた。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { encode as iconvEncode } from 'iconv-lite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initSchema } from '../db/schema.js';
import {
  getTaxAnswer,
  handleNtaGetBunshokaitou,
  handleNtaGetJimuUnei,
  handleNtaGetKaiseiTsutatsu,
  handleNtaInspectPdfMeta,
} from './handlers.js';

/* -------------------------------------------------------------------------- */
/* 準備                                                                        */
/* -------------------------------------------------------------------------- */

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'tests', 'fixtures');
const TAX_ANSWER_FIXTURE = 'www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm';

function readFixture(fileName: string): string {
  return readFileSync(resolve(fixturesDir, fileName), 'utf8');
}

/** fixture は UTF-8 で保存しているので、国税庁サイトと同じ Shift_JIS にして返す */
function sjisHtmlResponse(html: string): Response {
  return new Response(iconvEncode(html, 'shift_jis'), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
  });
}

function htmlFetch(html: string): typeof fetch {
  return vi.fn(async () => sjisHtmlResponse(html)) as unknown as typeof fetch;
}

function fetchMustNotBeCalled(): typeof fetch {
  return vi.fn(async () => {
    throw new Error('国税庁サイトを取りに行ってはいけない');
  }) as unknown as typeof fetch;
}

function callCount(fn: typeof fetch): number {
  return (fn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
}

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-20260930-nta-73-'));
  dbPath = join(dir, 'cache.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** DB の行を直接読む・書く */
function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/* -------------------------------------------------------------------------- */
/* nta_get_tax_answer                                                         */
/* -------------------------------------------------------------------------- */

type TaxAnswerJson = {
  source?: string;
  taxAnswer?: { no: string; title: string; sections: unknown[] };
};

/** 見出しから `No.6101 ` を除いた 6101 のページ */
function pageWithoutNo(): string {
  const html = readFixture(TAX_ANSWER_FIXTURE);
  expect(html).toContain('<h1>No.6101 消費税の基本的なしくみ</h1>');
  return html.replace('<h1>No.6101 消費税の基本的なしくみ</h1>', '<h1>消費税の基本的なしくみ</h1>');
}

describe('nta_get_tax_answer — SPEC-NTA-GET-TAX-ANSWER-011 記事番号は引数の no で決め、応答と DB の行に空の番号を入れない', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-011 SPEC-NTA-GET-TAX-ANSWER-008 見出しに No. が無いページでも taxAnswer.no は引数の no、題名は見出しの文字列', async () => {
    const r = (await getTaxAnswer(
      { no: ' 6101 ', format: 'json' },
      { fetchImpl: htmlFetch(pageWithoutNo()), dbPath }
    )) as TaxAnswerJson;

    expect(r.source).toBe('live');
    expect(r.taxAnswer?.no).toBe('6101');
    expect(r.taxAnswer?.title).toBe('消費税の基本的なしくみ');
    expect(r.taxAnswer?.sections.length).toBeGreaterThan(0);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-011 見出しに No. が無いページでも markdown の見出しは # No.<no> <題名>', async () => {
    const md = (await getTaxAnswer(
      { no: '6101' },
      { fetchImpl: htmlFetch(pageWithoutNo()), dbPath }
    )) as string;

    expect(md.startsWith('# No.6101 消費税の基本的なしくみ\n')).toBe(true);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-011 書き戻す行の文書 ID は no、税目は先頭の桁の税目フォルダで、文書 ID が空の行は作らない。次の呼び出しは DB から返す', async () => {
    await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: htmlFetch(pageWithoutNo()), dbPath }
    );

    const rows = withDb((db) =>
      db
        .prepare('SELECT doc_id, taxonomy FROM document WHERE doc_type = ? ORDER BY doc_id')
        .all('tax-answer')
    ) as Array<{ doc_id: string; taxonomy: string | null }>;
    expect(rows).toEqual([{ doc_id: '6101', taxonomy: 'shohi' }]);

    const fetchImpl = fetchMustNotBeCalled();
    const again = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl, dbPath }
    )) as TaxAnswerJson;
    expect(again.source).toBe('db');
    expect(again.taxAnswer?.no).toBe('6101');
    expect(callCount(fetchImpl)).toBe(0);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-011 SPEC-NTA-GET-TAX-ANSWER-004 DB の行に記録された番号が空でも、DB から返す taxAnswer.no は no', async () => {
    await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: htmlFetch(readFixture(TAX_ANSWER_FIXTURE)), dbPath }
    );
    // bulk download で見出しに No. の無いページを取り込んだ行と同じ状態にする
    const changed = withDb((db) => {
      const row = db
        .prepare('SELECT structured_json FROM document WHERE doc_type = ? AND doc_id = ?')
        .get('tax-answer', '6101') as { structured_json: string };
      const structured = JSON.parse(row.structured_json) as { no: string };
      structured.no = '';
      return db
        .prepare('UPDATE document SET structured_json = ? WHERE doc_type = ? AND doc_id = ?')
        .run(JSON.stringify(structured), 'tax-answer', '6101').changes;
    });
    expect(changed).toBe(1);

    const r = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as TaxAnswerJson;
    expect(r.source).toBe('db');
    expect(r.taxAnswer?.no).toBe('6101');

    const md = (await getTaxAnswer(
      { no: '6101' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as string;
    expect(md.startsWith('# No.6101 消費税の基本的なしくみ\n')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* nta_get_kaisei_tsutatsu                                                    */
/* -------------------------------------------------------------------------- */

type AttachedPdfJson = { title: string; url: string; kind?: string };
type KaiseiJson = { document?: { attachedPdfs: AttachedPdfJson[] } };

/** 添付 PDF 付きの文書を 1 件入れる（`kind` を持たない v0.6.0 期の行の形） */
function seedDocument(
  docType: 'kaisei' | 'jimu-unei' | 'bunshokaitou',
  docId: string,
  pdfs: AttachedPdfJson[]
): void {
  withDb((db) => {
    initSchema(db);
    db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      docType,
      docId,
      'shohi',
      `${docType} の題名`,
      `https://x/${docType}/index.htm`,
      '2026-05-06T00:00:00Z',
      '本文',
      JSON.stringify(pdfs),
      'h1'
    );
  });
}

function seedKaisei(docId: string, pdfs: AttachedPdfJson[]): void {
  seedDocument('kaisei', docId, pdfs);
}

describe('nta_get_kaisei_tsutatsu — SPEC-NTA-GET-KAISEI-TSUTATSU-008 kind の無い添付 PDF は題名から kind を決めて返す', () => {
  const OLD_ROW_PDFS: AttachedPdfJson[] = [
    { title: '新旧対応表', url: 'https://x/kaisei/pdf/01.pdf' },
    { title: '参考資料', url: 'https://x/kaisei/pdf/02.pdf' },
    { title: '別紙1', url: 'https://x/kaisei/pdf/03.pdf' },
    { title: '資料', url: 'https://x/kaisei/pdf/04.pdf' },
  ];

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-008 SPEC-NTA-GET-KAISEI-TSUTATSU-006 json では全要素に kind が付き、「別紙 N」は決めた kind に対して 007 で付け替える', async () => {
    seedKaisei('old-001', OLD_ROW_PDFS);

    const r = (await handleNtaGetKaiseiTsutatsu(
      { docId: 'old-001', format: 'json' },
      { dbPath }
    )) as KaiseiJson;

    expect(r.document?.attachedPdfs.map((p) => p.kind)).toEqual([
      'comparison',
      'related',
      'comparison',
      'unknown',
    ]);
    // 題名と URL は DB のまま
    expect(r.document?.attachedPdfs.map((p) => p.title)).toEqual(OLD_ROW_PDFS.map((p) => p.title));
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-008 SPEC-NTA-GET-KAISEI-TSUTATSU-005 markdown の表と読み方は決めた種別になり、「その他」は unknown のときだけ', async () => {
    seedKaisei('old-002', OLD_ROW_PDFS.slice(0, 3));

    const md = (await handleNtaGetKaiseiTsutatsu({ docId: 'old-002' }, { dbPath })) as string;

    expect(md).toContain('## 添付 PDF (3 件)');
    expect(md).toContain('| 🔄 新旧対照表 | 新旧対応表 |');
    expect(md).toContain('| 📚 参考資料 | 参考資料 |');
    expect(md).toContain('| 🔄 新旧対照表 | 別紙1 |');
    expect(md).not.toContain('その他');
    expect(md).toContain('- 新旧対照表: ');
    expect(md).toContain('- 参考資料: ');
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-008 同じ文書を nta_inspect_pdf_meta で見たときと kind が一致し、DB は書き換えない', async () => {
    seedKaisei('old-003', OLD_ROW_PDFS);

    const got = (await handleNtaGetKaiseiTsutatsu(
      { docId: 'old-003', format: 'json' },
      { dbPath }
    )) as KaiseiJson;
    const inspected = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'old-003' },
      { dbPath }
    )) as { attachedPdfs: AttachedPdfJson[] };

    const kindByUrl = (pdfs: AttachedPdfJson[]) =>
      Object.fromEntries(pdfs.map((p) => [p.url, p.kind]));
    expect(kindByUrl(got.document?.attachedPdfs ?? [])).toEqual(kindByUrl(inspected.attachedPdfs));

    const stored = withDb(
      (db) =>
        db
          .prepare('SELECT attached_pdfs_json FROM document WHERE doc_type = ? AND doc_id = ?')
          .get('kaisei', 'old-003') as { attached_pdfs_json: string }
    );
    expect(JSON.parse(stored.attached_pdfs_json)).toEqual(OLD_ROW_PDFS);
  });
});

/* -------------------------------------------------------------------------- */
/* nta_get_jimu_unei / nta_get_bunshokaitou（判断 3）                          */
/* -------------------------------------------------------------------------- */

const OLD_ROW_PDFS_NO_KAISEI: AttachedPdfJson[] = [
  { title: '参考資料', url: 'https://x/doc/pdf/01.pdf' },
  { title: '別紙1', url: 'https://x/doc/pdf/02.pdf' },
  { title: 'Q&A', url: 'https://x/doc/pdf/03.pdf' },
];

describe('nta_get_jimu_unei — SPEC-NTA-GET-JIMU-UNEI-008 kind の無い添付 PDF は題名から kind を決めて返す', () => {
  it('SPEC-NTA-GET-JIMU-UNEI-008 SPEC-NTA-GET-JIMU-UNEI-007 json では全要素に kind が付き、「別紙 N」は comparison に付け替えない', async () => {
    seedDocument('jimu-unei', 'ju-old-001', OLD_ROW_PDFS_NO_KAISEI);

    const r = (await handleNtaGetJimuUnei(
      { docId: 'ju-old-001', format: 'json' },
      { dbPath }
    )) as KaiseiJson;

    expect(r.document?.attachedPdfs.map((p) => p.kind)).toEqual([
      'related',
      'attachment',
      'qa-pdf',
    ]);
    expect(r.document?.attachedPdfs.map((p) => p.title)).toEqual(
      OLD_ROW_PDFS_NO_KAISEI.map((p) => p.title)
    );
  });

  it('SPEC-NTA-GET-JIMU-UNEI-008 markdown の表と読み方は決めた種別になり、「その他」は無い', async () => {
    seedDocument('jimu-unei', 'ju-old-002', OLD_ROW_PDFS_NO_KAISEI);

    const md = (await handleNtaGetJimuUnei({ docId: 'ju-old-002' }, { dbPath })) as string;

    expect(md).toContain('## 添付 PDF (3 件)');
    expect(md).toContain('| 📎 別紙・別表 | 別紙1 |');
    expect(md).toContain('| ❓ Q&A | Q&A |');
    expect(md).toContain('| 📚 参考資料 | 参考資料 |');
    expect(md).not.toContain('その他');
  });

  it('SPEC-NTA-GET-JIMU-UNEI-008 同じ文書を nta_inspect_pdf_meta で見たときと kind が一致し、DB は書き換えない', async () => {
    seedDocument('jimu-unei', 'ju-old-003', OLD_ROW_PDFS_NO_KAISEI);

    const got = (await handleNtaGetJimuUnei(
      { docId: 'ju-old-003', format: 'json' },
      { dbPath }
    )) as KaiseiJson;
    const inspected = (await handleNtaInspectPdfMeta(
      { docType: 'jimu-unei', docId: 'ju-old-003' },
      { dbPath }
    )) as { attachedPdfs: AttachedPdfJson[] };

    const kindByUrl = (pdfs: AttachedPdfJson[]) =>
      Object.fromEntries(pdfs.map((p) => [p.url, p.kind]));
    expect(kindByUrl(got.document?.attachedPdfs ?? [])).toEqual(kindByUrl(inspected.attachedPdfs));

    const stored = withDb(
      (db) =>
        db
          .prepare('SELECT attached_pdfs_json FROM document WHERE doc_type = ? AND doc_id = ?')
          .get('jimu-unei', 'ju-old-003') as { attached_pdfs_json: string }
    );
    expect(JSON.parse(stored.attached_pdfs_json)).toEqual(OLD_ROW_PDFS_NO_KAISEI);
  });
});

describe('nta_get_bunshokaitou — SPEC-NTA-GET-BUNSHOKAITOU-008 kind の無い添付 PDF は題名から kind を決めて返す', () => {
  it('SPEC-NTA-GET-BUNSHOKAITOU-008 SPEC-NTA-GET-BUNSHOKAITOU-006 json では全要素に kind が付き、「別紙 N」は comparison に付け替えない', async () => {
    seedDocument('bunshokaitou', 'bk-old-001', OLD_ROW_PDFS_NO_KAISEI);

    const r = (await handleNtaGetBunshokaitou(
      { docId: 'bk-old-001', format: 'json' },
      { dbPath }
    )) as KaiseiJson;

    expect(r.document?.attachedPdfs.map((p) => p.kind)).toEqual([
      'related',
      'attachment',
      'qa-pdf',
    ]);
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-008 SPEC-NTA-GET-BUNSHOKAITOU-005 markdown の表と読み方は決めた種別になり、「その他」は無い', async () => {
    seedDocument('bunshokaitou', 'bk-old-002', OLD_ROW_PDFS_NO_KAISEI);

    const md = (await handleNtaGetBunshokaitou({ docId: 'bk-old-002' }, { dbPath })) as string;

    expect(md).toContain('## 添付 PDF (3 件)');
    expect(md).toContain('| 📎 別紙・別表 | 別紙1 |');
    expect(md).toContain('| ❓ Q&A | Q&A |');
    expect(md).toContain('| 📚 参考資料 | 参考資料 |');
    expect(md).not.toContain('その他');
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-008 同じ文書を nta_inspect_pdf_meta で見たときと kind が一致し、DB は書き換えない', async () => {
    seedDocument('bunshokaitou', 'bk-old-003', OLD_ROW_PDFS_NO_KAISEI);

    const got = (await handleNtaGetBunshokaitou(
      { docId: 'bk-old-003', format: 'json' },
      { dbPath }
    )) as KaiseiJson;
    const inspected = (await handleNtaInspectPdfMeta(
      { docType: 'bunshokaitou', docId: 'bk-old-003' },
      { dbPath }
    )) as { attachedPdfs: AttachedPdfJson[] };

    const kindByUrl = (pdfs: AttachedPdfJson[]) =>
      Object.fromEntries(pdfs.map((p) => [p.url, p.kind]));
    expect(kindByUrl(got.document?.attachedPdfs ?? [])).toEqual(kindByUrl(inspected.attachedPdfs));

    const stored = withDb(
      (db) =>
        db
          .prepare('SELECT attached_pdfs_json FROM document WHERE doc_type = ? AND doc_id = ?')
          .get('bunshokaitou', 'bk-old-003') as { attached_pdfs_json: string }
    );
    expect(JSON.parse(stored.attached_pdfs_json)).toEqual(OLD_ROW_PDFS_NO_KAISEI);
  });
});

/* -------------------------------------------------------------------------- */
/* nta_inspect_pdf_meta                                                       */
/* -------------------------------------------------------------------------- */

type InspectJson = {
  attachedPdfs: Array<{ url: string; kind: string }>;
  saved?: Array<{ url: string; path: string | null; bytes: number | null; cached: boolean }>;
};

const KAISEI_PDF_ROOT = 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei';

describe('nta_inspect_pdf_meta — SPEC-NTA-INSPECT-PDF-META-018 同じ文書の中で最後のパス要素が同じ URL は、前のパス要素を付けて区別する', () => {
  const URL_A = `${KAISEI_PDF_ROOT}/0026003-067/pdf/01.pdf`;
  const URL_B = `${KAISEI_PDF_ROOT}/0026003-068/pdf/01.pdf`;
  const URL_C = `${KAISEI_PDF_ROOT}/0026003-067/pdf/02.pdf`;
  const bytesByUrl: Record<string, Buffer> = {
    [URL_A]: Buffer.from('%PDF-1.7\n%A\n'),
    [URL_B]: Buffer.from('%PDF-1.7\n%B\n'),
    [URL_C]: Buffer.from('%PDF-1.7\n%C\n'),
  };

  function pdfFetch(): typeof fetch {
    return vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = bytesByUrl[url];
      if (!body) return new Response('not found', { status: 404 });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }) as unknown as typeof fetch;
  }

  function seedSameName(): string {
    seedKaisei('0026003-067', [
      { title: '新旧対照表', url: URL_A, kind: 'comparison' },
      { title: '参考資料', url: URL_B, kind: 'related' },
      { title: '別紙1 計算明細書', url: URL_C, kind: 'attachment' },
    ]);
    return mkdtempSync(join(dir, 'files-'));
  }

  it('SPEC-NTA-INSPECT-PDF-META-018 SPEC-NTA-INSPECT-PDF-META-010 重なる URL は前のパス要素を付けた別のファイルに置き、重ならない URL は最後のパス要素のまま。全件を取得する', async () => {
    const filesDir = seedSameName();
    const fetchImpl = pdfFetch();

    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: '0026003-067', save: true },
      { dbPath, filesDir, fetchImpl }
    )) as InspectJson;

    const pathOf = (url: string) => r.saved?.find((s) => s.url === url)?.path;
    const base = resolve(filesDir, 'kaisei', '0026003-067');
    expect(pathOf(URL_A)).toBe(resolve(base, '0026003-067_pdf_01.pdf'));
    expect(pathOf(URL_B)).toBe(resolve(base, '0026003-068_pdf_01.pdf'));
    expect(pathOf(URL_C)).toBe(resolve(base, '02.pdf'));
    expect(r.saved?.map((s) => s.url)).toEqual([URL_A, URL_C, URL_B]);
    expect(r.saved?.map((s) => s.cached)).toEqual([false, false, false]);
    expect(callCount(fetchImpl)).toBe(3);

    // saved[].path はその PDF 自身のファイルを指す
    expect(readFileSync(pathOf(URL_A) as string)).toEqual(bytesByUrl[URL_A]);
    expect(readFileSync(pathOf(URL_B) as string)).toEqual(bytesByUrl[URL_B]);
    expect(readFileSync(pathOf(URL_C) as string)).toEqual(bytesByUrl[URL_C]);
    expect(r.saved?.find((s) => s.url === URL_B)?.bytes).toBe(bytesByUrl[URL_B].byteLength);
  });

  it('SPEC-NTA-INSPECT-PDF-META-018 kind で絞って 1 件だけ保存しても、同じ URL のファイル名は変わらず、保存済みなら cached: true', async () => {
    const filesDir = seedSameName();
    await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: '0026003-067', save: true },
      { dbPath, filesDir, fetchImpl: pdfFetch() }
    );

    const fetchImpl = pdfFetch();
    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: '0026003-067', save: true, kind: 'related' },
      { dbPath, filesDir, fetchImpl }
    )) as InspectJson;

    expect(r.saved).toHaveLength(1);
    expect(r.saved?.[0].url).toBe(URL_B);
    expect(r.saved?.[0].path).toBe(
      resolve(filesDir, 'kaisei', '0026003-067', '0026003-068_pdf_01.pdf')
    );
    expect(r.saved?.[0].cached).toBe(true);
    expect(callCount(fetchImpl)).toBe(0);
  });

  it('SPEC-NTA-INSPECT-PDF-META-018 kind で絞った呼び出しが先でも、ファイル名は文書の添付 PDF 全体から決める', async () => {
    const filesDir = seedSameName();

    const first = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: '0026003-067', save: true, kind: 'comparison' },
      { dbPath, filesDir, fetchImpl: pdfFetch() }
    )) as InspectJson;
    expect(first.saved?.[0].path).toBe(
      resolve(filesDir, 'kaisei', '0026003-067', '0026003-067_pdf_01.pdf')
    );

    const fetchImpl = pdfFetch();
    const second = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: '0026003-067', save: true },
      { dbPath, filesDir, fetchImpl }
    )) as InspectJson;
    // saved[] は attachedPdfs と同じ順（kind の順: comparison → attachment → related）
    expect(second.saved?.map((s) => [s.url, s.cached])).toEqual([
      [URL_A, true],
      [URL_C, false],
      [URL_B, false],
    ]);
    expect(callCount(fetchImpl)).toBe(2);
    const savedB = second.saved?.find((s) => s.url === URL_B);
    expect(savedB?.path).toBe(resolve(filesDir, 'kaisei', '0026003-067', '0026003-068_pdf_01.pdf'));
    expect(readFileSync(savedB?.path as string)).toEqual(bytesByUrl[URL_B]);
  });
});

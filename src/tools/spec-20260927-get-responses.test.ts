/**
 * 差分 specs/changes/20260927-get-responses/ の受入テスト。
 *
 * 取得系ツール（文書回答事例・事務運営指針・改正通達・基本通達・質疑応答事例）、
 * resolve_abbreviation、nta_inspect_pdf_meta の応答の形に振った仕様 ID（ADDED 16 件）を確かめる。
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
  getQa,
  getTsutatsu,
  handleNtaGetBunshokaitou,
  handleNtaGetJimuUnei,
  handleNtaGetKaiseiTsutatsu,
  handleNtaInspectPdfMeta,
  handleResolveAbbreviation,
} from './handlers.js';

/* -------------------------------------------------------------------------- */
/* 準備                                                                        */
/* -------------------------------------------------------------------------- */

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'tests', 'fixtures');
const NTA_ORIGIN = 'https://www.nta.go.jp';

function sjisHtml(html: string): Response {
  return new Response(iconvEncode(html, 'shift_jis'), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
  });
}

function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** 存在しないページは 302 で /error/404.htm に転送される国税庁サイトの応答 */
function ntaRedirectTo404Response(init?: RequestInit): Response {
  const errorPageUrl = `${NTA_ORIGIN}/error/404.htm`;
  if (init?.redirect === 'manual') {
    return new Response(null, { status: 302, headers: { Location: errorPageUrl } });
  }
  const res = new Response(
    '<html><head><title>ページが見つかりません</title></head><body><p>お探しのページは見つかりませんでした。</p></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
  );
  Object.defineProperty(res, 'url', { value: errorPageUrl });
  Object.defineProperty(res, 'redirected', { value: true });
  return res;
}

/** パスごとにフィクスチャーを返し、それ以外は 404 ページへ転送する fetch */
function ntaFetch(pages: Record<string, string>): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    const fixture = pages[new URL(url).pathname];
    return fixture ? sjisHtml(readFixture(fixture)) : ntaRedirectTo404Response(init);
  }) as unknown as typeof fetch;
}

/** 呼ばれたら必ず失敗する fetch（DB から返したことを確かめる） */
const failingFetch = vi.fn(async () => {
  throw new Error('国税庁サイトを取りに行ってはいけない');
}) as unknown as typeof fetch;

type PdfRecord = { title: string; url: string; sizeKb?: number; kind?: string };

type DocRow = {
  docType: string;
  docId: string;
  taxonomy?: string | null;
  title: string;
  issuedAt?: string | null;
  issuer?: string | null;
  sourceUrl?: string;
  fetchedAt?: string;
  fullText?: string;
  /** 配列なら JSON にして入れる。文字列ならそのまま入れる（壊れた JSON の再現用） */
  pdfs?: PdfRecord[] | string;
};

const FETCHED_AT = '2026-09-07T00:00:00Z';

function seedDocuments(dbPath: string, rows: DocRow[]): void {
  const db = new Database(dbPath);
  initSchema(db);
  const insert = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, issued_at, issuer, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of rows) {
    insert.run(
      r.docType,
      r.docId,
      r.taxonomy === undefined ? 'shohi' : r.taxonomy,
      r.title,
      r.issuedAt ?? null,
      r.issuer ?? null,
      r.sourceUrl ?? `https://www.nta.go.jp/example/${r.docId}.htm`,
      r.fetchedAt ?? FETCHED_AT,
      r.fullText ?? '本文です。',
      typeof r.pdfs === 'string' ? r.pdfs : JSON.stringify(r.pdfs ?? []),
      `hash-${r.docId}`
    );
  }
  db.close();
}

function readAttachedPdfsJson(dbPath: string, docType: string, docId: string): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare('SELECT attached_pdfs_json FROM document WHERE doc_type = ? AND doc_id = ?')
      .get(docType, docId) as { attached_pdfs_json: string };
    return row.attached_pdfs_json;
  } finally {
    db.close();
  }
}

type LegalStatus = {
  binds_citizens: boolean;
  binds_courts: boolean;
  binds_tax_office: boolean;
  note: string;
};

type DocumentJson = {
  document: {
    docType: string;
    docId: string;
    taxonomy?: string | null;
    title: string;
    issuedAt?: string | null;
    issuer?: string | null;
    sourceUrl: string;
    fetchedAt: string;
    fullText: string;
    attachedPdfs: PdfRecord[];
  };
  legal_status: LegalStatus;
  source: string;
  code?: string;
};

type InspectResult = {
  docType: string;
  docId: string;
  title: string;
  sourceUrl: string;
  attachedPdfs: Array<{ title: string; url: string; kind: string; layout_note: string }>;
  legal_status: LegalStatus;
  saved?: Array<{
    url: string;
    path: string | null;
    bytes: number | null;
    cached: boolean;
    error?: string;
  }>;
  next_actions?: Array<{ action: string; example?: Record<string, unknown> }>;
  note?: string;
  code?: string;
};

/** 文字列の中で、各部分がこの順に現れることを確かめる */
function expectInOrder(text: string, parts: string[]): void {
  let from = -1;
  for (const p of parts) {
    const at = text.indexOf(p, from + 1);
    expect(at, `「${p}」が前の部分の後ろに無い`).toBeGreaterThan(from);
    from = at;
  }
}

/** `## 添付 PDF` の節（次の `---` まで）を取り出す */
function pdfSection(md: string): string {
  const start = md.indexOf('## 添付 PDF');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = md.indexOf('\n---', start);
  return md.slice(start, end < 0 ? undefined : end);
}

/** `### 読み方` の節を取り出す */
function readingSection(md: string): string {
  const sec = pdfSection(md);
  const start = sec.indexOf('### 読み方');
  expect(start).toBeGreaterThanOrEqual(0);
  return sec.slice(start);
}

/** 種別ごとの layout_note を nta_inspect_pdf_meta から得る（SPEC-NTA-INSPECT-PDF-META-005 と同じ文） */
async function layoutNotes(dbPath: string): Promise<Record<string, string>> {
  seedDocuments(dbPath, [
    {
      docType: 'bunshokaitou',
      docId: 'layout-probe',
      title: '読み方の確認用',
      pdfs: [
        { title: '新旧対照表', url: 'https://x/p-c.pdf', kind: 'comparison' },
        { title: '別紙1 計算明細書', url: 'https://x/p-a.pdf', kind: 'attachment' },
        { title: 'Q&A', url: 'https://x/p-q.pdf', kind: 'qa-pdf' },
        { title: '参考資料', url: 'https://x/p-r.pdf', kind: 'related' },
        { title: 'お知らせ', url: 'https://x/p-n.pdf', kind: 'notice' },
        { title: '資料X', url: 'https://x/p-u.pdf', kind: 'unknown' },
      ],
    },
  ]);
  const r = (await handleNtaInspectPdfMeta(
    { docType: 'bunshokaitou', docId: 'layout-probe' },
    { dbPath }
  )) as InspectResult;
  return Object.fromEntries(r.attachedPdfs.map((p) => [p.kind, p.layout_note]));
}

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-20260927-get-responses-'));
  dbPath = join(dir, 'cache.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* nta_get_bunshokaitou                                                        */
/* -------------------------------------------------------------------------- */

describe('nta_get_bunshokaitou', () => {
  const PDFS: PdfRecord[] = [
    { title: '通知文', url: 'https://x/notice.pdf', sizeKb: 10, kind: 'notice' },
    { title: '別紙1 計算明細書', url: 'https://x/att1.pdf', sizeKb: 20, kind: 'attachment' },
    { title: '新旧対照表', url: 'https://x/cmp.pdf', sizeKb: 30, kind: 'comparison' },
    { title: '資料X', url: 'https://x/unk.pdf', sizeKb: 40, kind: 'unknown' },
    { title: '別表2', url: 'https://x/att2.pdf', sizeKb: 50, kind: 'attachment' },
    { title: 'Q&A', url: 'https://x/qa.pdf', sizeKb: 60, kind: 'qa-pdf' },
    { title: '参考資料', url: 'https://x/rel.pdf', sizeKb: 70, kind: 'related' },
  ];

  function seedBunshokaitou(): void {
    seedDocuments(dbPath, [
      {
        docType: 'bunshokaitou',
        docId: 'full-001',
        title: '文書回答事例の題名',
        issuedAt: '2026-05-01',
        issuer: '東京国税局審理課長\n照会者 株式会社例',
        sourceUrl: 'https://www.nta.go.jp/about/organization/tokyo/bunshokaito/x/full-001.htm',
        fullText: '照会の内容と回答の本文。',
        pdfs: PDFS,
      },
      {
        docType: 'bunshokaitou',
        docId: 'plain-001',
        taxonomy: null,
        title: '添付の無い文書回答事例',
        fullText: '添付の無い本文。',
        pdfs: [],
      },
    ]);
  }

  it('SPEC-NTA-GET-BUNSHOKAITOU-005 markdown（既定）は見出し・種別などの行・宛先・本文・添付 PDF・末尾の注の順に並ぶ', async () => {
    seedBunshokaitou();
    const md = (await handleNtaGetBunshokaitou({ docId: 'full-001' }, { dbPath })) as string;
    const explicit = (await handleNtaGetBunshokaitou(
      { docId: 'full-001', format: 'markdown' },
      { dbPath }
    )) as string;

    expect(typeof md).toBe('string');
    expect(explicit).toBe(md);
    expect(md.startsWith('# 文書回答事例の題名')).toBe(true);
    expectInOrder(md, [
      '# 文書回答事例の題名',
      '- **種別**: 文書回答事例',
      '- **発出日**: 2026-05-01',
      '- **税目**: ',
      '- **docId**: `full-001`',
      '- **出典**: https://www.nta.go.jp/about/organization/tokyo/bunshokaito/x/full-001.htm',
      `- **取得**: ${FETCHED_AT}`,
      '## 宛先・発出者',
      '> 東京国税局審理課長',
      '> 照会者 株式会社例',
      '## 本文',
      '照会の内容と回答の本文。',
      '## 添付 PDF (7 件)',
      '---',
      '*文書回答事例は照会者・国税庁双方の合意に基づく個別事案回答であり、一般的な法的拘束力はない（実務判断は通達・法令本文に基づく必要あり）*',
    ]);
    // 注は最後に置く
    expect(
      md
        .trimEnd()
        .endsWith(
          '*文書回答事例は照会者・国税庁双方の合意に基づく個別事案回答であり、一般的な法的拘束力はない（実務判断は通達・法令本文に基づく必要あり）*'
        )
    ).toBe(true);
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-005 markdown: 発出日・税目・宛先・添付が DB に無ければその行と節を出さない', async () => {
    seedBunshokaitou();
    const md = (await handleNtaGetBunshokaitou({ docId: 'plain-001' }, { dbPath })) as string;

    expect(md).toContain('# 添付の無い文書回答事例');
    expect(md).toContain('- **種別**: 文書回答事例');
    expect(md).not.toContain('- **発出日**');
    expect(md).not.toContain('- **税目**');
    expect(md).not.toContain('## 宛先・発出者');
    expect(md).not.toContain('## 添付 PDF');
    expectInOrder(md, ['- **docId**: `plain-001`', '## 本文', '添付の無い本文。', '---']);
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-005 markdown の添付 PDF の節: 案内の引用・種別の順の表・表に出た種別ごとの読み方', async () => {
    seedBunshokaitou();
    const md = (await handleNtaGetBunshokaitou({ docId: 'full-001' }, { dbPath })) as string;
    const sec = pdfSection(md);

    // 案内（> の引用）: pdf-reader-mcp の read_url か、nta_inspect_pdf_meta を save: true で呼んで extract_tables
    const quoted = sec
      .split('\n')
      .filter((l) => l.startsWith('>'))
      .join('\n');
    expect(quoted).toContain('read_url');
    expect(quoted).toContain('nta_inspect_pdf_meta');
    expect(quoted).toContain('save: true');
    expect(quoted).toContain('extract_tables');

    // 表の行は種別の順（新旧対照表・別紙・Q&A・参考資料・通知・その他）、同じ種別の中は DB の順
    const table = sec.slice(0, sec.indexOf('### 読み方'));
    expectInOrder(table, [
      'https://x/cmp.pdf',
      'https://x/att1.pdf',
      'https://x/att2.pdf',
      'https://x/qa.pdf',
      'https://x/rel.pdf',
      'https://x/notice.pdf',
      'https://x/unk.pdf',
    ]);

    // 読み方: 表に現れた種別ごとに 1 行、nta_inspect_pdf_meta の layout_note と同じ文
    const notes = await layoutNotes(join(dir, 'probe.db'));
    const reading = readingSection(md);
    for (const kind of ['comparison', 'attachment', 'qa-pdf', 'related', 'notice', 'unknown']) {
      const note = notes[kind];
      expect(note, kind).toBeTruthy();
      expect(reading.split(note).length - 1, kind).toBe(1);
    }
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-005 markdown の読み方は表に現れない種別を書かない', async () => {
    seedDocuments(dbPath, [
      {
        docType: 'bunshokaitou',
        docId: 'one-kind',
        title: '参考資料だけの事例',
        pdfs: [{ title: '参考資料', url: 'https://x/rel.pdf', kind: 'related' }],
      },
    ]);
    const md = (await handleNtaGetBunshokaitou({ docId: 'one-kind' }, { dbPath })) as string;
    expect(md).toContain('## 添付 PDF (1 件)');
    const notes = await layoutNotes(join(dir, 'probe.db'));
    const reading = readingSection(md);
    expect(reading).toContain(notes.related);
    expect(reading).not.toContain(notes.comparison);
    expect(reading).not.toContain(notes.unknown);
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-006 json は document の各フィールド・legal_status（拘束力なし）・source=db を持つ', async () => {
    seedBunshokaitou();
    const r = (await handleNtaGetBunshokaitou(
      { docId: 'full-001', format: 'json' },
      { dbPath }
    )) as DocumentJson;

    expect(r.code).toBeUndefined();
    expect(r.document.docType).toBe('bunshokaitou');
    expect(r.document.docId).toBe('full-001');
    expect(r.document.taxonomy).toBe('shohi');
    expect(r.document.title).toBe('文書回答事例の題名');
    expect(r.document.issuedAt).toBe('2026-05-01');
    expect(r.document.issuer).toContain('東京国税局審理課長');
    expect(r.document.sourceUrl).toBe(
      'https://www.nta.go.jp/about/organization/tokyo/bunshokaito/x/full-001.htm'
    );
    expect(r.document.fetchedAt).toBe(FETCHED_AT);
    expect(r.document.fullText).toContain('照会の内容と回答の本文。');
    expect(r.document.attachedPdfs).toHaveLength(PDFS.length);
    for (const p of r.document.attachedPdfs) {
      expect(Object.keys(p).sort()).toEqual(['kind', 'sizeKb', 'title', 'url']);
    }
    expect(r.legal_status.binds_citizens).toBe(false);
    expect(r.legal_status.binds_courts).toBe(false);
    expect(r.legal_status.binds_tax_office).toBe(false);
    expect(r.legal_status.note).toContain('個別');
    expect(r.legal_status.note).toContain('拘束力');
    expect(r.source).toBe('db');
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-006 json: 発出日・宛先が無ければ付かず、添付が無ければ attachedPdfs は空の配列', async () => {
    seedBunshokaitou();
    const r = (await handleNtaGetBunshokaitou(
      { docId: 'plain-001', format: 'json' },
      { dbPath }
    )) as DocumentJson;

    expect(r.document.docType).toBe('bunshokaitou');
    expect(r.document.issuedAt ?? undefined).toBeUndefined();
    expect(r.document.issuer ?? undefined).toBeUndefined();
    expect(r.document.attachedPdfs).toEqual([]);
    expect(r.source).toBe('db');
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-007 available_doc_ids は発出日の新しい順で、発出日の無い文書は後ろ（仕様の例）', async () => {
    seedDocuments(dbPath, [
      { docType: 'bunshokaitou', docId: 'B', title: '発出日の無い事例' },
      { docType: 'bunshokaitou', docId: 'A', title: '4 月の事例', issuedAt: '2026-04-01' },
      { docType: 'bunshokaitou', docId: 'souzoku-X', title: '5 月の事例', issuedAt: '2026-05-01' },
    ]);
    const r = (await handleNtaGetBunshokaitou({ docId: 'no-such-doc' }, { dbPath })) as {
      code?: string;
      available_doc_ids?: Array<{ docId: string; title: string; issuedAt: string | null }>;
    };

    expect(r.code).toBe('DOC_NOT_FOUND');
    expect(r.available_doc_ids?.map((d) => d.docId)).toEqual(['souzoku-X', 'A', 'B']);
    expect(r.available_doc_ids?.find((d) => d.docId === 'B')?.issuedAt).toBeNull();
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-007 発出日が同じなら docId の降順で、31 件以上あっても 30 件まで', async () => {
    const rows: DocRow[] = [];
    for (let i = 1; i <= 33; i++) {
      rows.push({
        docType: 'bunshokaitou',
        docId: `d${String(i).padStart(2, '0')}`,
        title: `事例 ${i}`,
        issuedAt: '2026-03-01',
      });
    }
    rows.push({ docType: 'bunshokaitou', docId: 'z-none', title: '発出日なし' });
    seedDocuments(dbPath, rows);

    const r = (await handleNtaGetBunshokaitou({ docId: 'no-such-doc' }, { dbPath })) as {
      available_doc_ids?: Array<{ docId: string }>;
    };
    const ids = r.available_doc_ids?.map((d) => d.docId) ?? [];
    expect(ids).toHaveLength(30);
    const expected = Array.from({ length: 33 }, (_, i) => `d${String(33 - i).padStart(2, '0')}`);
    expect(ids).toEqual(expected.slice(0, 30));
    expect(ids).not.toContain('z-none');
  });
});

/* -------------------------------------------------------------------------- */
/* nta_get_jimu_unei                                                           */
/* -------------------------------------------------------------------------- */

describe('nta_get_jimu_unei', () => {
  const PDFS: PdfRecord[] = [
    { title: 'お知らせ', url: 'https://x/j-notice.pdf', sizeKb: 11, kind: 'notice' },
    { title: '別紙様式', url: 'https://x/j-att.pdf', sizeKb: 22, kind: 'attachment' },
    { title: '新旧対照表', url: 'https://x/j-cmp.pdf', sizeKb: 33, kind: 'comparison' },
  ];

  function seedJimuUnei(): void {
    seedDocuments(dbPath, [
      {
        docType: 'jimu-unei',
        docId: 'jimu-001',
        taxonomy: 'shotoku',
        title: '事務運営指針の題名',
        issuedAt: '2025-06-30',
        issuer: '国税局長 殿\n国税庁長官',
        sourceUrl: 'https://www.nta.go.jp/law/jimu-unei/shotoku/jimu-001.htm',
        fullText: '事務運営の本文。',
        pdfs: PDFS,
      },
      {
        docType: 'jimu-unei',
        docId: 'jimu-plain',
        taxonomy: null,
        title: '添付の無い事務運営指針',
        fullText: '添付の無い本文。',
        pdfs: [],
      },
    ]);
  }

  it('SPEC-NTA-GET-JIMU-UNEI-005 json は document の各フィールド・legal_status（税務署員を拘束）・source=db を持つ', async () => {
    seedJimuUnei();
    const r = (await handleNtaGetJimuUnei(
      { docId: 'jimu-001', format: 'json' },
      { dbPath }
    )) as DocumentJson;

    expect(r.code).toBeUndefined();
    expect(r.document.docType).toBe('jimu-unei');
    expect(r.document.docId).toBe('jimu-001');
    expect(r.document.taxonomy).toBe('shotoku');
    expect(r.document.title).toBe('事務運営指針の題名');
    expect(r.document.issuedAt).toBe('2025-06-30');
    expect(r.document.issuer).toContain('国税庁長官');
    expect(r.document.sourceUrl).toBe('https://www.nta.go.jp/law/jimu-unei/shotoku/jimu-001.htm');
    expect(r.document.fetchedAt).toBe(FETCHED_AT);
    expect(r.document.fullText).toContain('事務運営の本文。');
    expect(Array.isArray(r.document.attachedPdfs)).toBe(true);
    expect(r.legal_status.binds_citizens).toBe(false);
    expect(r.legal_status.binds_courts).toBe(false);
    expect(r.legal_status.binds_tax_office).toBe(true);
    expect(typeof r.legal_status.note).toBe('string');
    expect(r.legal_status.note.length).toBeGreaterThan(0);
    expect(r.source).toBe('db');
  });

  it('SPEC-NTA-GET-JIMU-UNEI-005 json: 発出日・宛先が DB に無ければ付かない', async () => {
    seedJimuUnei();
    const r = (await handleNtaGetJimuUnei(
      { docId: 'jimu-plain', format: 'json' },
      { dbPath }
    )) as DocumentJson;
    expect(r.document.issuedAt ?? undefined).toBeUndefined();
    expect(r.document.issuer ?? undefined).toBeUndefined();
    expect(r.source).toBe('db');
  });

  it('SPEC-NTA-GET-JIMU-UNEI-006 markdown（既定）は見出し・種別などの行・宛先・本文・添付 PDF・末尾の注の順に並ぶ', async () => {
    seedJimuUnei();
    const md = (await handleNtaGetJimuUnei({ docId: 'jimu-001' }, { dbPath })) as string;
    const explicit = (await handleNtaGetJimuUnei(
      { docId: 'jimu-001', format: 'markdown' },
      { dbPath }
    )) as string;

    expect(typeof md).toBe('string');
    expect(explicit).toBe(md);
    expect(md.startsWith('# 事務運営指針の題名')).toBe(true);
    expectInOrder(md, [
      '# 事務運営指針の題名',
      '- **種別**: 事務運営指針',
      '- **発出日**: 2025-06-30',
      '- **税目**: ',
      '- **docId**: `jimu-001`',
      '- **出典**: https://www.nta.go.jp/law/jimu-unei/shotoku/jimu-001.htm',
      `- **取得**: ${FETCHED_AT}`,
      '## 宛先・発出者',
      '> 国税局長 殿',
      '> 国税庁長官',
      '## 本文',
      '事務運営の本文。',
      '## 添付 PDF (3 件)',
      '---',
      '*通達・事務運営指針は行政内部文書であり、納税者・裁判所への直接的拘束力なし（最高裁 昭和43.12.24）*',
    ]);
    expect(
      md
        .trimEnd()
        .endsWith(
          '*通達・事務運営指針は行政内部文書であり、納税者・裁判所への直接的拘束力なし（最高裁 昭和43.12.24）*'
        )
    ).toBe(true);
  });

  it('SPEC-NTA-GET-JIMU-UNEI-006 markdown: 発出日・税目・宛先・添付が DB に無ければその行と節を出さない', async () => {
    seedJimuUnei();
    const md = (await handleNtaGetJimuUnei({ docId: 'jimu-plain' }, { dbPath })) as string;
    expect(md).toContain('- **種別**: 事務運営指針');
    expect(md).not.toContain('- **発出日**');
    expect(md).not.toContain('- **税目**');
    expect(md).not.toContain('## 宛先・発出者');
    expect(md).not.toContain('## 添付 PDF');
    expectInOrder(md, ['- **docId**: `jimu-plain`', '## 本文', '添付の無い本文。', '---']);
  });

  it('SPEC-NTA-GET-JIMU-UNEI-007 json の document.attachedPdfs は DB の添付 PDF をそのまま入れ、無ければ空の配列', async () => {
    seedJimuUnei();
    const r = (await handleNtaGetJimuUnei(
      { docId: 'jimu-001', format: 'json' },
      { dbPath }
    )) as DocumentJson;
    expect(r.document.attachedPdfs).toEqual(PDFS);

    const plain = (await handleNtaGetJimuUnei(
      { docId: 'jimu-plain', format: 'json' },
      { dbPath }
    )) as DocumentJson;
    expect(plain.document.attachedPdfs).toEqual([]);
  });

  it('SPEC-NTA-GET-JIMU-UNEI-007 markdown の添付 PDF の節: 案内の引用・種別の順の表・表に出た種別ごとの読み方', async () => {
    seedJimuUnei();
    const md = (await handleNtaGetJimuUnei({ docId: 'jimu-001' }, { dbPath })) as string;
    const sec = pdfSection(md);
    expectInOrder(md, ['## 本文', '## 添付 PDF (3 件)']);

    const quoted = sec
      .split('\n')
      .filter((l) => l.startsWith('>'))
      .join('\n');
    expect(quoted).toContain('read_url');
    expect(quoted).toContain('nta_inspect_pdf_meta');
    expect(quoted).toContain('save: true');
    expect(quoted).toContain('extract_tables');

    const table = sec.slice(0, sec.indexOf('### 読み方'));
    expectInOrder(table, ['https://x/j-cmp.pdf', 'https://x/j-att.pdf', 'https://x/j-notice.pdf']);

    const notes = await layoutNotes(join(dir, 'probe.db'));
    const reading = readingSection(md);
    for (const kind of ['comparison', 'attachment', 'notice']) {
      expect(reading.split(notes[kind]).length - 1, kind).toBe(1);
    }
    for (const kind of ['qa-pdf', 'related', 'unknown']) {
      expect(reading, kind).not.toContain(notes[kind]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* nta_get_kaisei_tsutatsu                                                     */
/* -------------------------------------------------------------------------- */

describe('nta_get_kaisei_tsutatsu', () => {
  const PDFS: PdfRecord[] = [
    {
      title: '新旧対照表（PDF/100KB）',
      url: 'https://x/k-cmp.pdf',
      sizeKb: 100,
      kind: 'comparison',
    },
    { title: '別紙1（PDF/221KB）', url: 'https://x/k-01.pdf', sizeKb: 221, kind: 'attachment' },
  ];

  function seedKaisei(): void {
    seedDocuments(dbPath, [
      {
        docType: 'kaisei',
        docId: 'kaisei-001',
        taxonomy: 'shohi',
        title: '消費税法基本通達の一部改正について（法令解釈通達）',
        issuedAt: '2025-04-01',
        issuer: '国税局長 殿\n国税庁長官',
        sourceUrl: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei-001/index.htm',
        fullText: '標題のことについては、別紙のとおり改める。',
        pdfs: PDFS,
      },
      {
        docType: 'kaisei',
        docId: 'kaisei-plain',
        taxonomy: null,
        title: '添付の無い改正通達',
        fullText: '添付の無い本文。',
        pdfs: [],
      },
    ]);
  }

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-005 markdown（既定）は種別の行を持たず、見出し・行・宛先・本文・添付 PDF・末尾の注の順に並ぶ', async () => {
    seedKaisei();
    const md = (await handleNtaGetKaiseiTsutatsu({ docId: 'kaisei-001' }, { dbPath })) as string;
    const explicit = (await handleNtaGetKaiseiTsutatsu(
      { docId: 'kaisei-001', format: 'markdown' },
      { dbPath }
    )) as string;

    expect(typeof md).toBe('string');
    expect(explicit).toBe(md);
    expect(md).not.toContain('- **種別**');
    expect(md.startsWith('# 消費税法基本通達の一部改正について（法令解釈通達）')).toBe(true);
    expectInOrder(md, [
      '# 消費税法基本通達の一部改正について（法令解釈通達）',
      '- **発出日**: 2025-04-01',
      '- **税目**: ',
      '- **docId**: `kaisei-001`',
      '- **出典**: https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei-001/index.htm',
      `- **取得**: ${FETCHED_AT}`,
      '## 宛先・発出者',
      '> 国税局長 殿',
      '> 国税庁長官',
      '## 本文',
      '標題のことについては、別紙のとおり改める。',
      '## 添付 PDF (2 件)',
      '---',
      '*通達は行政内部文書であり、納税者・裁判所への直接的拘束力なし（最高裁 昭和43.12.24）*',
    ]);
    expect(
      md
        .trimEnd()
        .endsWith(
          '*通達は行政内部文書であり、納税者・裁判所への直接的拘束力なし（最高裁 昭和43.12.24）*'
        )
    ).toBe(true);
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-005 markdown: 発出日・税目・宛先・添付が DB に無ければその行と節を出さない', async () => {
    seedKaisei();
    const md = (await handleNtaGetKaiseiTsutatsu({ docId: 'kaisei-plain' }, { dbPath })) as string;
    expect(md).not.toContain('- **種別**');
    expect(md).not.toContain('- **発出日**');
    expect(md).not.toContain('- **税目**');
    expect(md).not.toContain('## 宛先・発出者');
    expect(md).not.toContain('## 添付 PDF');
    expectInOrder(md, ['- **docId**: `kaisei-plain`', '## 本文', '添付の無い本文。', '---']);
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-005 markdown の添付 PDF の節: 案内の引用・種別の順の表・表に出た種別ごとの読み方', async () => {
    seedDocuments(dbPath, [
      {
        docType: 'kaisei',
        docId: 'kaisei-mixed',
        title: '改正通達（添付が混ざる）',
        pdfs: [
          { title: '参考資料', url: 'https://x/m-rel.pdf', kind: 'related' },
          { title: '別紙1 計算明細書', url: 'https://x/m-att.pdf', kind: 'attachment' },
          { title: '新旧対照表', url: 'https://x/m-cmp.pdf', kind: 'comparison' },
        ],
      },
    ]);
    const md = (await handleNtaGetKaiseiTsutatsu({ docId: 'kaisei-mixed' }, { dbPath })) as string;
    const sec = pdfSection(md);

    const quoted = sec
      .split('\n')
      .filter((l) => l.startsWith('>'))
      .join('\n');
    expect(quoted).toContain('read_url');
    expect(quoted).toContain('nta_inspect_pdf_meta');
    expect(quoted).toContain('save: true');
    expect(quoted).toContain('extract_tables');

    const table = sec.slice(0, sec.indexOf('### 読み方'));
    expectInOrder(table, ['https://x/m-cmp.pdf', 'https://x/m-att.pdf', 'https://x/m-rel.pdf']);

    const notes = await layoutNotes(join(dir, 'probe.db'));
    const reading = readingSection(md);
    for (const kind of ['comparison', 'attachment', 'related']) {
      expect(reading.split(notes[kind]).length - 1, kind).toBe(1);
    }
    for (const kind of ['qa-pdf', 'notice', 'unknown']) {
      expect(reading, kind).not.toContain(notes[kind]);
    }
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-006 json は document の各フィールド・legal_status（税務署員を拘束）・source=db を持つ', async () => {
    seedKaisei();
    const r = (await handleNtaGetKaiseiTsutatsu(
      { docId: 'kaisei-001', format: 'json' },
      { dbPath }
    )) as DocumentJson;

    expect(r.code).toBeUndefined();
    expect(r.document.docType).toBe('kaisei');
    expect(r.document.docId).toBe('kaisei-001');
    expect(r.document.taxonomy).toBe('shohi');
    expect(r.document.title).toBe('消費税法基本通達の一部改正について（法令解釈通達）');
    expect(r.document.issuedAt).toBe('2025-04-01');
    expect(r.document.issuer).toContain('国税庁長官');
    expect(r.document.sourceUrl).toBe(
      'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei-001/index.htm'
    );
    expect(r.document.fetchedAt).toBe(FETCHED_AT);
    expect(r.document.fullText).toContain('別紙のとおり改める');
    expect(r.document.attachedPdfs).toHaveLength(2);
    for (const p of r.document.attachedPdfs) {
      expect(Object.keys(p).sort()).toEqual(['kind', 'sizeKb', 'title', 'url']);
    }
    expect(r.legal_status.binds_citizens).toBe(false);
    expect(r.legal_status.binds_courts).toBe(false);
    expect(r.legal_status.binds_tax_office).toBe(true);
    expect(r.legal_status.note.length).toBeGreaterThan(0);
    expect(r.source).toBe('db');
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-006 json: 発出日・宛先が無ければ付かず、添付が無ければ attachedPdfs は空の配列', async () => {
    seedKaisei();
    const r = (await handleNtaGetKaiseiTsutatsu(
      { docId: 'kaisei-plain', format: 'json' },
      { dbPath }
    )) as DocumentJson;
    expect(r.document.issuedAt ?? undefined).toBeUndefined();
    expect(r.document.issuer ?? undefined).toBeUndefined();
    expect(r.document.attachedPdfs).toEqual([]);
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-007 json: 「別紙1（PDF/221KB）」は kind を comparison にして返す（仕様の例）。DB は書き換えない', async () => {
    seedKaisei();
    const before = readAttachedPdfsJson(dbPath, 'kaisei', 'kaisei-001');
    const r = (await handleNtaGetKaiseiTsutatsu(
      { docId: 'kaisei-001', format: 'json' },
      { dbPath }
    )) as DocumentJson;

    expect(r.document.attachedPdfs.map((p) => p.title)).toEqual([
      '新旧対照表（PDF/100KB）',
      '別紙1（PDF/221KB）',
    ]);
    expect(r.document.attachedPdfs[1].kind).toBe('comparison');
    expect(readAttachedPdfsJson(dbPath, 'kaisei', 'kaisei-001')).toBe(before);
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-007 json: 「別紙」と番号だけの題名はどれも comparison、別の語を含む題名は attachment のまま', async () => {
    seedDocuments(dbPath, [
      {
        docType: 'kaisei',
        docId: 'kaisei-bessi',
        title: '別紙の題名いろいろ',
        pdfs: [
          { title: '別紙1', url: 'https://x/b1.pdf', kind: 'attachment' },
          { title: '（別紙2）', url: 'https://x/b2.pdf', kind: 'attachment' },
          { title: '別紙1-2', url: 'https://x/b12.pdf', kind: 'attachment' },
          { title: '別紙1 計算明細書', url: 'https://x/bm.pdf', kind: 'attachment' },
        ],
      },
    ]);
    const r = (await handleNtaGetKaiseiTsutatsu(
      { docId: 'kaisei-bessi', format: 'json' },
      { dbPath }
    )) as DocumentJson;
    const kindOf = (url: string) => r.document.attachedPdfs.find((p) => p.url === url)?.kind;
    expect(kindOf('https://x/b1.pdf')).toBe('comparison');
    expect(kindOf('https://x/b2.pdf')).toBe('comparison');
    expect(kindOf('https://x/b12.pdf')).toBe('comparison');
    expect(kindOf('https://x/bm.pdf')).toBe('attachment');
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-007 markdown: 付け替えた後の種別で表を並べ、読み方も付け替えた後の種別で書く', async () => {
    seedDocuments(dbPath, [
      {
        docType: 'kaisei',
        docId: 'kaisei-md',
        title: '別紙だけの改正通達',
        pdfs: [
          { title: '参考資料', url: 'https://x/md-rel.pdf', kind: 'related' },
          { title: '別紙1（PDF/221KB）', url: 'https://x/md-01.pdf', kind: 'attachment' },
        ],
      },
    ]);
    const md = (await handleNtaGetKaiseiTsutatsu({ docId: 'kaisei-md' }, { dbPath })) as string;
    const sec = pdfSection(md);
    const table = sec.slice(0, sec.indexOf('### 読み方'));
    // comparison（付け替え後）は related より前
    expectInOrder(table, ['https://x/md-01.pdf', 'https://x/md-rel.pdf']);

    const notes = await layoutNotes(join(dir, 'probe.db'));
    const reading = readingSection(md);
    expect(reading).toContain(notes.comparison);
    expect(reading).toContain(notes.related);
    expect(reading).not.toContain(notes.attachment);
  });
});

/* -------------------------------------------------------------------------- */
/* nta_get_tsutatsu                                                            */
/* -------------------------------------------------------------------------- */

describe('nta_get_tsutatsu', () => {
  const SHOTOKU_04_01 = '/law/tsutatsu/kihon/shotoku/04/01.htm';
  const SHOTOKU_PAGES: Record<string, string> = {
    '/law/tsutatsu/kihon/shotoku/01.htm': 'www.nta.go.jp_law_tsutatsu_kihon_shotoku_01.htm',
    [SHOTOKU_04_01]: 'www.nta.go.jp_law_tsutatsu_kihon_shotoku_04_01.htm',
  };
  const ALT_24_6 =
    '株式等を取得するために要した負債の利子の総額×配当所得の収入金額÷（配当所得の収入金額+その利子の額を差し引く前の株式等に係る譲渡所得等の金額及び総合課税の株式等に係る事業所得等の金額）';

  function imageNote(count: number, alts: string[] | null): string {
    const altPart = alts ? `（${alts.map((a) => `"${a}"`).join(' / ')}）` : '';
    return `本文に画像が ${count} 箇所含まれています（算式などが GIF 画像で掲載されている箇所）。画像の内容は取得できないため、本文には alt テキストを [画像: …] として同じ位置に残しています${altPart}。算式の正確な内容は出典 URL の原ページで確認してください`;
  }

  /** 所得税基本通達の条項を DB に入れる */
  function seedShotokuClause(
    clauseNumber: string,
    paragraphs: Array<{
      indent: number;
      text: string;
      images?: Array<{ alt: string; src: string }>;
    }>
  ): void {
    const db = new Database(dbPath);
    initSchema(db);
    const tsutatsuId = (
      db
        .prepare(
          'INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id'
        )
        .get('所得税基本通達', '所基通', `${NTA_ORIGIN}/law/tsutatsu/kihon/shotoku/`) as {
        id: number;
      }
    ).id;
    db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tsutatsuId,
      clauseNumber,
      `${NTA_ORIGIN}${SHOTOKU_04_01}`,
      null,
      null,
      `表題 ${clauseNumber}`,
      paragraphs.map((p) => p.text).join('\n'),
      JSON.stringify(paragraphs)
    );
    db.close();
  }

  it('SPEC-NTA-GET-TSUTATSU-016 DB から返すとき（json）: 画像の箇所数と alt を並べた注記 1 件を content_notes に入れる', async () => {
    seedShotokuClause('24-6', [
      { indent: 1, text: '次の算式による。' },
      {
        indent: 2,
        text: '[画像: 算式A]',
        images: [{ alt: '算式A', src: `${NTA_ORIGIN}/law/a.gif` }],
      },
      {
        indent: 2,
        text: '[画像: 算式B]',
        images: [{ alt: '算式B', src: `${NTA_ORIGIN}/law/b.gif` }],
      },
    ]);
    const r = (await getTsutatsu(
      { name: '所基通', clause: '24-6', format: 'json' },
      { fetchImpl: failingFetch, dbPath }
    )) as { source?: string; content_notes?: string[] };

    expect(r.source).toBe('db');
    expect(r.content_notes).toEqual([imageNote(2, ['算式A', '算式B'])]);
  });

  it('SPEC-NTA-GET-TSUTATSU-016 DB から返すとき（markdown）: 本文の後、出典の行の前に「> 注意:」の行を入れる', async () => {
    seedShotokuClause('24-6', [
      { indent: 1, text: '次の算式による。' },
      {
        indent: 2,
        text: '[画像: 算式A]',
        images: [{ alt: '算式A', src: `${NTA_ORIGIN}/law/a.gif` }],
      },
    ]);
    const md = (await getTsutatsu(
      { name: '所基通', clause: '24-6' },
      { fetchImpl: failingFetch, dbPath }
    )) as string;

    expect(typeof md).toBe('string');
    expectInOrder(md, ['次の算式による。', `> 注意: ${imageNote(1, ['算式A'])}`, '出典:']);
  });

  it('SPEC-NTA-GET-TSUTATSU-016 alt テキストが 1 つも無いときは（"…"）の部分を書かない', async () => {
    seedShotokuClause('24-6', [
      { indent: 1, text: '次の算式による。' },
      { indent: 2, text: '[画像: ]', images: [{ alt: '', src: `${NTA_ORIGIN}/law/a.gif` }] },
    ]);
    const r = (await getTsutatsu(
      { name: '所基通', clause: '24-6', format: 'json' },
      { fetchImpl: failingFetch, dbPath }
    )) as { content_notes?: string[] };

    expect(r.content_notes).toEqual([imageNote(1, null)]);
  });

  it('SPEC-NTA-GET-TSUTATSU-016 画像の無い条項（DB）には注記を付けない', async () => {
    seedShotokuClause('24-7', [{ indent: 1, text: '画像の無い本文。' }]);
    const json = (await getTsutatsu(
      { name: '所基通', clause: '24-7', format: 'json' },
      { fetchImpl: failingFetch, dbPath }
    )) as { source?: string; content_notes?: string[] };
    expect(json.source).toBe('db');
    expect(json.content_notes).toBeUndefined();

    const md = (await getTsutatsu(
      { name: '所基通', clause: '24-7' },
      { fetchImpl: failingFetch, dbPath }
    )) as string;
    expect(md).not.toContain('> 注意:');
  });

  it('SPEC-NTA-GET-TSUTATSU-016 国税庁サイトから取ったとき（所基通 24-6）: json の content_notes と markdown の「> 注意:」の行', async () => {
    const fetchImpl = ntaFetch(SHOTOKU_PAGES);
    const json = (await getTsutatsu(
      { name: '所基通', clause: '24-6', format: 'json' },
      { fetchImpl, dbPath: join(dir, 'live-json.db') }
    )) as { source?: string; content_notes?: string[] };
    expect(json.source).toBe('live');
    expect(json.content_notes).toEqual([imageNote(1, [ALT_24_6])]);

    const md = (await getTsutatsu(
      { name: '所基通', clause: '24-6' },
      { fetchImpl: ntaFetch(SHOTOKU_PAGES), dbPath: join(dir, 'live-md.db') }
    )) as string;
    expectInOrder(md, [`> 注意: ${imageNote(1, [ALT_24_6])}`, '出典:']);
  });

  it('SPEC-NTA-GET-TSUTATSU-016 国税庁サイトから取ったとき、画像の無い条項（所基通 24-7）には注記を付けない', async () => {
    const json = (await getTsutatsu(
      { name: '所基通', clause: '24-7', format: 'json' },
      { fetchImpl: ntaFetch(SHOTOKU_PAGES), dbPath: join(dir, 'live-24-7.db') }
    )) as { source?: string; content_notes?: string[] };
    expect(json.source).toBe('live');
    expect(json.content_notes).toBeUndefined();

    const md = (await getTsutatsu(
      { name: '所基通', clause: '24-7' },
      { fetchImpl: ntaFetch(SHOTOKU_PAGES), dbPath: join(dir, 'live-24-7-md.db') }
    )) as string;
    expect(md).not.toContain('> 注意:');
  });
});

/* -------------------------------------------------------------------------- */
/* nta_get_qa                                                                  */
/* -------------------------------------------------------------------------- */

describe('nta_get_qa', () => {
  const ORIGINAL_RELATED = '<p>　消費税法第2条第1項第8号、消費税法基本通達5-1-1</p>';

  /** shohi/02/19 の【関係法令通達】を差し替えたページを返す fetch */
  function qaFetchWithRelated(paragraphs: string[]): typeof fetch {
    const html = readFixture('www.nta.go.jp_law_shitsugi_shohi_02_19.htm');
    expect(html).toContain(ORIGINAL_RELATED);
    const replaced = html.replace(
      ORIGINAL_RELATED,
      paragraphs.map((p) => `<p>　${p}</p>`).join('\n')
    );
    return vi.fn(async () => sjisHtml(replaced)) as unknown as typeof fetch;
  }

  type QaJson = {
    related_laws?: Array<{ law_name: string; article?: string; raw: string }>;
    related_tsutatsu?: Array<{ name: string; clause?: string; raw: string }>;
    next_actions?: Array<{ action: string; example?: Record<string, unknown> }>;
  };

  const lawActions = (r: QaJson) =>
    (r.next_actions ?? []).filter((a) => a.example?.tool === 'get_law');
  const tsutatsuActions = (r: QaJson) =>
    (r.next_actions ?? []).filter((a) => a.action === 'nta_get_tsutatsu');

  it('SPEC-NTA-GET-QA-011 条約・「旧」の付く法令は next_actions に入れず related_laws に残す。通達の細目は example.clause から外す（仕様の例）', async () => {
    const fetchImpl = qaFetchWithRelated([
      '消費税法第2条第1項第8号、消費税法基本通達5-1-1(4)',
      '日米租税条約第3条',
      '旧所得税法第9条',
    ]);
    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl, dbPath: join(dir, 'qa.db') }
    )) as QaJson;

    expect(r.related_laws).toHaveLength(3);
    expect(r.related_laws?.map((l) => l.law_name)).toEqual(
      expect.arrayContaining(['消費税法', '日米租税条約', '旧所得税法'])
    );
    expect(lawActions(r).map((a) => a.example?.law_name)).toEqual(['消費税法']);

    expect(tsutatsuActions(r).map((a) => a.example)).toEqual([
      { name: '消費税法基本通達', clause: '5-1-1' },
    ]);
    expect(r.related_tsutatsu?.find((t) => t.name === '消費税法基本通達')?.clause).toBe('5-1-1(4)');
  });

  it('SPEC-NTA-GET-QA-011 条まで読めない法令、「改正前」を含む法令、基本通達 4 種以外の通達は next_actions に入れず related_* に残す', async () => {
    const fetchImpl = qaFetchWithRelated([
      '消費税法別表第二第7号ハ',
      '改正前所得税法第9条',
      '所得税法第27条',
      '租税特別措置法関係通達（法人税編）65の7(1)-22',
      '財産評価基本通達5',
      '所得税基本通達34-1',
    ]);
    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl, dbPath: join(dir, 'qa2.db') }
    )) as QaJson;

    const lawNames = r.related_laws?.map((l) => l.law_name) ?? [];
    expect(lawNames).toContain('消費税法');
    expect(lawNames.some((n) => n.includes('改正前'))).toBe(true);
    expect(lawNames).toContain('所得税法');
    // 案内は条まで読めた現行の法令だけ
    expect(lawActions(r).map((a) => [a.example?.law_name, a.example?.article])).toEqual([
      ['所得税法', '27'],
    ]);

    const tsutatsuNames = r.related_tsutatsu?.map((t) => t.name) ?? [];
    expect(tsutatsuNames).toEqual(
      expect.arrayContaining([
        '租税特別措置法関係通達（法人税編）',
        '財産評価基本通達',
        '所得税基本通達',
      ])
    );
    expect(tsutatsuActions(r).map((a) => a.example)).toEqual([
      { name: '所得税基本通達', clause: '34-1' },
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* resolve_abbreviation                                                        */
/* -------------------------------------------------------------------------- */

describe('resolve_abbreviation', () => {
  type ResolveResult = {
    abbr: string;
    resolved: { abbr: string; formal: string; source_mcp_hint: string } | null;
    in_scope: boolean;
    hint?: string;
  };

  it('SPEC-NTA-RESOLVE-ABBREVIATION-006 別名「電帳法取扱通達」は電帳法取通のエントリに解決され、in_scope=true', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '電帳法取扱通達' })) as ResolveResult;
    expect(r.abbr).toBe('電帳法取扱通達');
    expect(r.resolved?.abbr).toBe('電帳法取通');
    expect(r.resolved?.source_mcp_hint).toBe('houki-nta');
    expect(r.in_scope).toBe(true);
    expect(r.hint).toBeUndefined();
  });

  it('SPEC-NTA-RESOLVE-ABBREVIATION-006 別名「消費税」は消法のエントリに解決され、houki-egov の管轄なので in_scope=false と誘導の hint', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '消費税' })) as ResolveResult;
    expect(r.abbr).toBe('消費税');
    expect(r.resolved?.abbr).toBe('消法');
    expect(r.resolved?.formal).toBe('消費税法');
    expect(r.resolved?.source_mcp_hint).toBe('houki-egov');
    expect(r.in_scope).toBe(false);
    expect(r.hint).toContain('houki-egov');
  });
});

/* -------------------------------------------------------------------------- */
/* nta_inspect_pdf_meta                                                        */
/* -------------------------------------------------------------------------- */

describe('nta_inspect_pdf_meta', () => {
  let filesDir: string;

  beforeEach(() => {
    filesDir = join(dir, 'files');
  });

  it('SPEC-NTA-INSPECT-PDF-META-014 保存した unknown の PDF の next_actions は pdf-reader-mcp:summarize と { file_path }', async () => {
    seedDocuments(dbPath, [
      {
        docType: 'kaisei',
        docId: 'unk-001',
        title: '種別の分からない添付',
        pdfs: [{ title: '資料X', url: 'https://x/unk.pdf', kind: 'unknown' }],
      },
    ]);
    const fetchImpl = vi.fn(
      async () =>
        new Response(Buffer.from('%PDF-1.7\n%test\n'), {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        })
    ) as unknown as typeof fetch;

    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'unk-001', save: true },
      { dbPath, filesDir, fetchImpl }
    )) as InspectResult;

    const saved = r.saved?.[0];
    expect(saved?.path).toBe(resolve(filesDir, 'kaisei', 'unk-001', 'unk.pdf'));
    const first = r.next_actions?.[0];
    expect(first?.action).toBe('pdf-reader-mcp:summarize');
    expect(first?.example).toEqual({ file_path: saved?.path });
    expect(r.next_actions?.map((a) => a.action)).toEqual(['pdf-reader-mcp:summarize', 'read_pdf']);
  });

  it('SPEC-NTA-INSPECT-PDF-META-015 PDF でない応答・Content-Type の無い応答・ネットワークの例外は saved[] に error 付きで残し、note の件数に数える', async () => {
    seedDocuments(dbPath, [
      {
        docType: 'kaisei',
        docId: 'fail-001',
        title: '保存に失敗する添付',
        pdfs: [
          { title: '新旧対照表', url: 'https://x/html.pdf', kind: 'comparison' },
          { title: '別紙1 計算明細書', url: 'https://x/noct.pdf', kind: 'attachment' },
          { title: '参考資料', url: 'https://x/neterr.pdf', kind: 'related' },
          { title: 'お知らせ', url: 'https://x/ok.pdf', kind: 'notice' },
        ],
      },
    ]);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.endsWith('html.pdf')) {
        return new Response('<html><body>not pdf</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      if (url.endsWith('noct.pdf')) {
        const res = new Response(new TextEncoder().encode('<html>not pdf</html>'), {
          status: 200,
        });
        res.headers.delete('Content-Type');
        return res;
      }
      if (url.endsWith('neterr.pdf')) throw new Error('ネットワークに接続できません');
      return new Response(Buffer.from('%PDF-1.7\n%ok\n'), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    }) as unknown as typeof fetch;

    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'fail-001', save: true },
      { dbPath, filesDir, fetchImpl }
    )) as InspectResult;

    const byUrl = (u: string) => r.saved?.find((s) => s.url === u);
    for (const u of ['https://x/html.pdf', 'https://x/noct.pdf', 'https://x/neterr.pdf']) {
      const s = byUrl(u);
      expect(s, u).toBeDefined();
      expect(s?.path, u).toBeNull();
      expect(s?.bytes, u).toBeNull();
      expect(s?.cached, u).toBe(false);
    }
    expect(byUrl('https://x/html.pdf')?.error).toBe(
      'PDF ではありません（Content-Type: text/html）'
    );
    expect(byUrl('https://x/noct.pdf')?.error).toBe('PDF ではありません（Content-Type: 不明）');
    expect(byUrl('https://x/neterr.pdf')?.error).toContain('ネットワークに接続できません');
    expect(byUrl('https://x/ok.pdf')?.path).toBe(resolve(filesDir, 'kaisei', 'fail-001', 'ok.pdf'));
    expect(r.note).toContain('3 件の PDF を保存できませんでした');
  });

  it('SPEC-NTA-INSPECT-PDF-META-015 Content-Type が application/pdf でなくても本文の先頭が %PDF- なら保存する（仕様の例）', async () => {
    seedDocuments(dbPath, [
      {
        docType: 'kaisei',
        docId: 'octet-001',
        title: 'octet-stream の添付',
        pdfs: [{ title: '新旧対照表', url: 'https://x/octet.pdf', kind: 'comparison' }],
      },
    ]);
    const body = Buffer.from('%PDF-1.4\n%octet\n');
    const fetchImpl = vi.fn(
      async () =>
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        })
    ) as unknown as typeof fetch;

    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'octet-001', save: true },
      { dbPath, filesDir, fetchImpl }
    )) as InspectResult;

    const s = r.saved?.[0];
    expect(s?.error).toBeUndefined();
    expect(s?.path).toBe(resolve(filesDir, 'kaisei', 'octet-001', 'octet.pdf'));
    expect(s?.bytes).toBe(body.byteLength);
    expect(readFileSync(s?.path as string)).toEqual(body);
    expect(r.note ?? '').not.toContain('保存できませんでした');
  });

  it('SPEC-NTA-INSPECT-PDF-META-015 本文が 50MB（52,428,800 バイト）を超える PDF は保存せず、バイト数と上限を error に書く', async () => {
    seedDocuments(dbPath, [
      {
        docType: 'kaisei',
        docId: 'big-001',
        title: '大きすぎる添付',
        pdfs: [{ title: '新旧対照表', url: 'https://x/big.pdf', kind: 'comparison' }],
      },
    ]);
    const size = 52_428_801;
    const fetchImpl = vi.fn(async () => {
      const buf = Buffer.alloc(size, 0x20);
      buf.write('%PDF-1.7\n', 0);
      return new Response(buf, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    }) as unknown as typeof fetch;

    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'big-001', save: true },
      { dbPath, filesDir, fetchImpl }
    )) as InspectResult;

    const s = r.saved?.[0];
    expect(s?.path).toBeNull();
    expect(s?.bytes).toBeNull();
    expect(s?.cached).toBe(false);
    expect(s?.error).toBe(`${size} バイトあり、上限 52428800 バイトを超えています`);
    expect(r.note).toContain('1 件の PDF を保存できませんでした');
  });

  it('SPEC-NTA-INSPECT-PDF-META-016 legal_status は docType ごとの位置付けを返す（kaisei / jimu-unei / bunshokaitou / tax-answer）', async () => {
    const pdfs: PdfRecord[] = [{ title: '参考資料', url: 'https://x/r.pdf', kind: 'related' }];
    seedDocuments(dbPath, [
      { docType: 'kaisei', docId: 'ls-k', title: '改正通達', pdfs },
      { docType: 'jimu-unei', docId: 'ls-j', title: '事務運営指針', pdfs },
      { docType: 'bunshokaitou', docId: 'ls-b', title: '文書回答事例', pdfs },
      { docType: 'tax-answer', docId: 'ls-t', title: 'タックスアンサー', pdfs },
    ]);
    const call = async (
      docType: 'kaisei' | 'jimu-unei' | 'bunshokaitou' | 'tax-answer',
      docId: string
    ) =>
      ((await handleNtaInspectPdfMeta({ docType, docId }, { dbPath })) as InspectResult)
        .legal_status;

    for (const [docType, docId] of [
      ['kaisei', 'ls-k'],
      ['jimu-unei', 'ls-j'],
    ] as const) {
      const ls = await call(docType, docId);
      expect(ls.binds_citizens, docType).toBe(false);
      expect(ls.binds_courts, docType).toBe(false);
      expect(ls.binds_tax_office, docType).toBe(true);
      expect(ls.note, docType).toContain('行政内部文書');
      expect(ls.note, docType).toContain('昭和43.12.24');
    }

    const b = await call('bunshokaitou', 'ls-b');
    expect(b.binds_citizens).toBe(false);
    expect(b.binds_courts).toBe(false);
    expect(b.binds_tax_office).toBe(false);
    expect(b.note).toContain('個別');
    expect(b.note).toContain('拘束力');

    const t = await call('tax-answer', 'ls-t');
    expect(t.binds_citizens).toBe(false);
    expect(t.binds_courts).toBe(false);
    expect(t.binds_tax_office).toBe(false);
    expect(t.note).toContain('解説');
    expect(t.note).toContain('拘束力');
  });

  it('SPEC-NTA-INSPECT-PDF-META-017 添付 PDF の記録が JSON として読めない文書は、エラーにせず PDF の無い文書として返す', async () => {
    seedDocuments(dbPath, [
      {
        docType: 'kaisei',
        docId: 'broken-001',
        title: '記録の壊れた改正通達',
        sourceUrl: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/broken-001/index.htm',
        pdfs: '{not json',
      },
    ]);
    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'broken-001' },
      { dbPath }
    )) as InspectResult & { error?: string };

    expect(r.code).toBeUndefined();
    expect(r.error).toBeUndefined();
    expect(r.docType).toBe('kaisei');
    expect(r.docId).toBe('broken-001');
    expect(r.title).toBe('記録の壊れた改正通達');
    expect(r.sourceUrl).toBe(
      'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/broken-001/index.htm'
    );
    expect(r.attachedPdfs).toEqual([]);
    expect(r.next_actions).toBeUndefined();
    expect(r.legal_status.binds_tax_office).toBe(true);
  });
});

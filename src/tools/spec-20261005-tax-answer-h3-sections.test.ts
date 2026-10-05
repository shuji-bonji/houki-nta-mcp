/**
 * 差分 specs/changes/20261005-tax-answer-h3-sections/（PR #149、houki-nta-mcp #147）の受入テスト。
 *
 * - SPEC-NTA-GET-TAX-ANSWER-019（ADDED）: ページの見出し h2 と h3 をどちらも節の区切りにし、節ごとに見出しの段を
 *   `level` で返す。例 1〜4 と本文の箇条書き
 * - SPEC-NTA-GET-TAX-ANSWER-007（MODIFIED）: markdown の見出しの行（`level` 2 は `## `、3 は `### `、段落の無い節は見出しの行だけ）
 * - SPEC-NTA-GET-TAX-ANSWER-008（MODIFIED）: json の `taxAnswer.sections` の行（キーは heading・paragraphs・level の 3 つ、
 *   `paragraphs` が空になるのは次の見出しが h3 の h2 の節だけ）
 *
 * 期待値は差分の spec.md の本文・表・「例」から決めている。fixture は 2026-10-05 JST に国税庁サイトから保存した
 * No.6101（h3 あり）と No.1222（h2 の直後に h3）、2026-05-01 に保存した No.6101（見出しがすべて h2。例 3）。
 * 国税庁サイトには取りに行かない（fetchImpl を差し替える）。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type IndexEntry,
  MEASURED_INDEX,
  withTaxAnswerIndex,
} from '../../tests/support/tax-answer-index.js';
import { initSchema } from '../db/schema.js';
import { bulkDownloadTaxAnswer } from '../services/tax-answer-bulk-downloader.js';
import { getTaxAnswer } from './handlers.js';

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'tests', 'fixtures');

/** 2026-10-05 JST の No.6101（h2「概要」の下に h3 が 4 つ） */
const FX_6101_H3 = 'www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101_20261005.htm';
/** 2026-10-05 JST の No.1222（h2 の直後に h3 が続く節がある） */
const FX_1222 = 'www.nta.go.jp_taxes_shiraberu_taxanswer_shotoku_1222_20261005.htm';
/** 2026-05-01 に保存した No.6101（見出しがすべて h2。h3 が無い） */
const FX_6101_H2_ONLY = 'www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm';

/** 測った索引に、1222（所得税）を足したもの */
const INDEX: readonly IndexEntry[] = [
  ...MEASURED_INDEX,
  { no: '1222', folder: 'shotoku', title: '記事 1222' },
];

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-h3-sections-'));
  dbPath = join(dir, 'cache.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Section {
  heading: string;
  paragraphs: string[];
  level?: number;
}

interface TaxAnswerJson {
  source?: string;
  code?: string;
  taxAnswer?: { taxCategory?: string | null; sections: Section[] };
}

function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

function requestPath(input: string | URL | Request): string {
  if (typeof input === 'string') return new URL(input).pathname;
  if (input instanceof URL) return input.pathname;
  return new URL(input.url).pathname;
}

/** 記事のページ（パス → HTML）を返し、それ以外は 404 にする fetch。索引は withTaxAnswerIndex が返す */
function articleFetch(
  pages: Record<string, string>,
  entries: readonly IndexEntry[] = INDEX
): typeof fetch {
  const inner = vi.fn(async (input: string | URL | Request) => {
    const html = pages[requestPath(input)];
    if (html === undefined) return new Response('not found', { status: 404 });
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
  }) as unknown as typeof fetch;
  return withTaxAnswerIndex(inner, entries);
}

/** 呼ばれたら必ず失敗する fetch。DB から返したことを確かめるために使う */
function fetchMustNotBeCalled(): typeof fetch {
  return vi.fn(async () => {
    throw new Error('国税庁サイトを取りに行ってはいけない');
  }) as unknown as typeof fetch;
}

const PATH_6101 = '/taxes/shiraberu/taxanswer/shohi/6101.htm';
const PATH_1222 = '/taxes/shiraberu/taxanswer/shotoku/1222.htm';

async function liveJson(no: string, path: string, html: string): Promise<TaxAnswerJson> {
  return (await getTaxAnswer(
    { no, format: 'json' },
    { fetchImpl: articleFetch({ [path]: html }), dbPath }
  )) as TaxAnswerJson;
}

async function liveMarkdown(no: string, path: string, html: string): Promise<string> {
  return (await getTaxAnswer(
    { no, format: 'markdown' },
    { fetchImpl: articleFetch({ [path]: html }), dbPath }
  )) as string;
}

/** 節の見出しの行（`## ` と `### `）を上から並べる */
function headingLines(md: string): string[] {
  return md.split('\n').filter((l) => l.startsWith('## ') || l.startsWith('### '));
}

/** 表の行 [heading, level, paragraphs の数] */
type Row = [string, number, number];

function rowsOf(sections: Section[]): Row[] {
  return sections.map((s) => [s.heading, s.level as number, s.paragraphs.length]);
}

/** 019 の例 1 の表 */
const EXAMPLE_1: Row[] = [
  ['概要', 2, 5],
  ['消費税の負担者', 3, 1],
  ['課税のしくみ', 3, 4],
  ['申告・納付', 3, 4],
  ['納税事務の負担軽減措置等', 3, 12],
  ['根拠法令等', 2, 1],
  ['関連リンク', 2, 8],
];

/** 019 の例 2 の表 */
const EXAMPLE_2: Row[] = [
  ['概要', 2, 4],
  ['対象者または対象物', 2, 0],
  ['対象者', 3, 1],
  ['控除の適用を受けるための要件', 3, 2],
  ['計算方法・計算式', 2, 0],
  ['住宅耐震改修特別控除の控除額の計算方法', 3, 26],
  ['手続き', 2, 0],
  ['申告等の方法', 3, 2],
  ['申告先等', 3, 1],
  ['提出書類等', 2, 4],
  ['根拠法令等', 2, 1],
  ['関連リンク', 2, 8],
];

/** 本文の規則を確かめるための小さなページ（国税庁のページと同じく見出しは div#bodyArea の直下） */
function page(body: string): string {
  return `<html><head><meta content="text/html; charset=utf-8" http-equiv="Content-Type"></head><body><div class="imp-cnt" id="bodyArea">
<div class="page-header"><h1>No.6101 消費税の基本的なしくみ</h1></div>
<p>[令和8年4月1日現在法令等]</p>
${body}
</div></body></html>`;
}

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-GET-TAX-ANSWER-019                                                 */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-GET-TAX-ANSWER-019 ページの見出し h2 と h3 をどちらも節の区切りにし、節ごとに見出しの段を level で返す', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-019 例 1: 2026-10-05 JST の No.6101 を国税庁サイトから取ると、sections は 7 つ（概要 2・h3 の 4 つは 3・根拠法令等と関連リンクは 2）', async () => {
    const r = await liveJson('6101', PATH_6101, readFixture(FX_6101_H3));
    expect(r.source).toBe('live');
    expect(rowsOf(r.taxAnswer?.sections ?? [])).toEqual(EXAMPLE_1);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-019 例 1: h3 の段落は、その上の h2（概要）の節に入らない', async () => {
    const r = await liveJson('6101', PATH_6101, readFixture(FX_6101_H3));
    const sections = r.taxAnswer?.sections ?? [];
    const overview = sections.find((s) => s.heading === '概要');
    const h3Sections = sections.filter((s) => s.level === 3);
    expect(h3Sections.map((s) => s.heading)).toEqual([
      '消費税の負担者',
      '課税のしくみ',
      '申告・納付',
      '納税事務の負担軽減措置等',
    ]);
    expect(overview?.paragraphs).toHaveLength(5);
    // v0.25.0 では概要に 26 段落が入っていた。h3 の 4 つの節の段落（1・4・4・12）は概要から外れ、合計は変わらない
    // （ページには同じ文の段落が概要と h3 の節の両方にあるので、段落の文字列ではなく数で確かめる）
    const h3Total = h3Sections.reduce((n, s) => n + s.paragraphs.length, 0);
    expect(h3Total).toBe(21);
    expect((overview?.paragraphs.length ?? 0) + h3Total).toBe(26);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-019 例 2: 2026-10-05 JST の No.1222 の sections は 12 で、h2 の直後に h3 が続く 3 つの h2 の節は paragraphs: []', async () => {
    const r = await liveJson('1222', PATH_1222, readFixture(FX_1222));
    expect(r.source).toBe('live');
    expect(rowsOf(r.taxAnswer?.sections ?? [])).toEqual(EXAMPLE_2);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-019 h3 の節の親は、配列の中でその前にある最も近い level: 2 の節（No.1222 の 対象者 は 対象者または対象物、申告先等 は 手続き の下）', async () => {
    const r = await liveJson('1222', PATH_1222, readFixture(FX_1222));
    const sections = r.taxAnswer?.sections ?? [];
    const parentOf = (heading: string): string | undefined => {
      const i = sections.findIndex((s) => s.heading === heading);
      for (let j = i - 1; j >= 0; j--) if (sections[j].level === 2) return sections[j].heading;
      return undefined;
    };
    expect(parentOf('対象者')).toBe('対象者または対象物');
    expect(parentOf('申告先等')).toBe('手続き');
    // 入れ子にしない: 要素は 1 つの配列に並び、h2 の節の中に h3 の節を持たない
    for (const s of sections)
      expect(Object.keys(s).sort()).toEqual(['heading', 'level', 'paragraphs']);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-019 例 3: 見出しがすべて h2 のページ（2026-05-01 に保存した No.6101）は、h2 ごとの節で、どの節も level: 2', async () => {
    const html = readFixture(FX_6101_H2_ONLY);
    const r = await liveJson('6101', PATH_6101, html);
    const sections = r.taxAnswer?.sections ?? [];
    // ページの h2 の見出しのうち、「対象税目」（taxCategory にする）と「お問い合わせ先」「サイトマップ」で始まるものを除いたもの
    const $ = cheerio.load(html);
    const h2 = $('#bodyArea h2')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(
        (h) => h !== '対象税目' && !h.startsWith('お問い合わせ先') && !h.startsWith('サイトマップ')
      );
    expect(sections.map((s) => s.heading)).toEqual(h2);
    expect(sections).toHaveLength(7);
    for (const s of sections) expect(s.level).toBe(2);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-019 例 4: 0.25.0 で入れた行（節に level が無い）を DB から返すと、同じ 3 つの節にどれも level: 2 を入れる', async () => {
    const db = new Database(dbPath);
    initSchema(db);
    const structured = {
      no: '6101',
      title: '消費税の基本的なしくみ',
      effectiveDate: '令和8年4月1日現在法令等',
      taxCategory: '消費税',
      sections: [
        {
          heading: '概要',
          paragraphs: ['消費税は、商品の販売やサービスの提供などの取引に対して課税される税です。'],
        },
        { heading: '根拠法令等', paragraphs: ['消費税法'] },
        { heading: '関連リンク', paragraphs: ['消費税のあらまし'] },
      ],
    };
    db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, structured_json)
       VALUES ('tax-answer', '6101', 'shohi', '消費税の基本的なしくみ', 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6101.htm',
               '2026-10-04T03:47:44.159Z', '消費税の基本的なしくみ', '[]', 'hash-6101', ?)`
    ).run(JSON.stringify(structured));
    db.close();

    const r = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as TaxAnswerJson;
    expect(r.source).toBe('db');
    expect(r.taxAnswer?.sections).toEqual(
      structured.sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs, level: 2 }))
    );

    // markdown も補った level を使う（どれも `## `）
    const md = (await getTaxAnswer(
      { no: '6101', format: 'markdown' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as string;
    expect(headingLines(md)).toEqual(['## 概要', '## 根拠法令等', '## 関連リンク']);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-019 国税庁サイトから取った記事を DB に書き戻した後、DB から返すときも節の分け方と level は同じ（006 の経路）', async () => {
    const fetchImpl = articleFetch({ [PATH_1222]: readFixture(FX_1222) });
    const first = (await getTaxAnswer(
      { no: '1222', format: 'json' },
      { fetchImpl, dbPath }
    )) as TaxAnswerJson;
    const again = (await getTaxAnswer(
      { no: '1222', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as TaxAnswerJson;
    expect(first.source).toBe('live');
    expect(again.source).toBe('db');
    expect(again.taxAnswer?.sections).toEqual(first.taxAnswer?.sections);
    expect(rowsOf(again.taxAnswer?.sections ?? [])).toEqual(EXAMPLE_2);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-019 --bulk-download-tax-answer で入れた行を DB から返すときも節の分け方と level は同じ（004 の経路）', async () => {
    const db = new Database(dbPath);
    try {
      initSchema(db);
      await bulkDownloadTaxAnswer(db, {
        // 索引は 1222 だけにする（ほかの記事の 404 を避ける）
        fetchImpl: articleFetch({ [PATH_1222]: readFixture(FX_1222) }, [
          { no: '1222', folder: 'shotoku', title: '記事 1222' },
        ]),
        taxonomies: ['shotoku'],
        requestIntervalMs: 0,
        baselinePath: join(dir, 'baseline.json'),
      });
    } finally {
      db.close();
    }
    const r = (await getTaxAnswer(
      { no: '1222', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as TaxAnswerJson;
    expect(r.source).toBe('db');
    expect(rowsOf(r.taxAnswer?.sections ?? [])).toEqual(EXAMPLE_2);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-019 「サイトマップ」「お問い合わせ先」で始まる見出しは h2 でも h3 でも節にせず、「対象税目」の h2 は taxCategory にする', async () => {
    const html = page(`
<h2>対象税目</h2>
<p>消費税</p>
<h2>概要</h2>
<p>概要の段落</p>
<h3>お問い合わせ先（小見出し）</h3>
<p>問い合わせの段落</p>
<h3>サイトマップ（小見出し）</h3>
<p>サイトマップの段落</p>
<h2>根拠法令等</h2>
<p>消費税法</p>
<h2>お問い合わせ先</h2>
<p>電話相談センター</p>`);
    const r = await liveJson('6101', PATH_6101, html);
    const headings = (r.taxAnswer?.sections ?? []).map((s) => s.heading);
    expect(headings).not.toContain('お問い合わせ先（小見出し）');
    expect(headings).not.toContain('サイトマップ（小見出し）');
    expect(headings).not.toContain('お問い合わせ先');
    expect(headings).not.toContain('対象税目');
    expect(r.taxAnswer?.taxCategory).toBe('消費税');
    expect(headings[0]).toBe('概要');
    expect(headings).toContain('根拠法令等');
  });

  it('SPEC-NTA-GET-TAX-ANSWER-019 h4 以下の見出しは、節の区切りにも段落にもしない', async () => {
    const html = page(`
<h2>概要</h2>
<p>段落 1</p>
<h4>小小見出し</h4>
<p>段落 2</p>
<h2>根拠法令等</h2>
<p>消費税法</p>`);
    const r = await liveJson('6101', PATH_6101, html);
    const sections = r.taxAnswer?.sections ?? [];
    expect(sections.map((s) => s.heading)).toEqual(['概要', '根拠法令等']);
    expect(sections[0].paragraphs).toEqual(['段落 1', '段落 2']);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-019 段落が 1 つも無い節は作らない（次の見出しが h3 の h2 だけは例外）', async () => {
    const html = page(`
<h2>概要</h2>
<p>概要の段落</p>
<h3>段落の無い小見出し</h3>
<h3>手続きの小見出し</h3>
<p>小見出しの段落</p>
<h2>段落の無い見出し</h2>
<h2>根拠法令等</h2>
<p>消費税法</p>`);
    const r = await liveJson('6101', PATH_6101, html);
    expect(rowsOf(r.taxAnswer?.sections ?? [])).toEqual([
      ['概要', 2, 1],
      ['手続きの小見出し', 3, 1],
      ['根拠法令等', 2, 1],
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-GET-TAX-ANSWER-007（MODIFIED）                                     */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-GET-TAX-ANSWER-007 markdown の見出しの行は、level 2 の節が ## 、level 3 の節が ### ', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-007 例: 2026-10-05 JST の No.6101 の見出しの行は 7 行（## 概要 → ### 4 つ → ## 根拠法令等・## 関連リンク）', async () => {
    const md = await liveMarkdown('6101', PATH_6101, readFixture(FX_6101_H3));
    expect(headingLines(md)).toEqual([
      '## 概要',
      '### 消費税の負担者',
      '### 課税のしくみ',
      '### 申告・納付',
      '### 納税事務の負担軽減措置等',
      '## 根拠法令等',
      '## 関連リンク',
    ]);
    // 「対象税目」は節にせず、> 対象税目: の行にする
    expect(md).toContain('> 対象税目: 消費税');
    expect(md).not.toContain('## 対象税目');
  });

  it('SPEC-NTA-GET-TAX-ANSWER-007 段落の無い節（No.1222 の 2・5・7 番）は見出しの行だけを出し、h3 の節は ### の行と段落を出す', async () => {
    const md = await liveMarkdown('1222', PATH_1222, readFixture(FX_1222));
    expect(headingLines(md)).toEqual(EXAMPLE_2.map(([h, level]) => `${'#'.repeat(level)} ${h}`));
    const lines = md.split('\n');
    const nextNonEmpty = (line: string): string | undefined => {
      const i = lines.indexOf(line);
      return lines.slice(i + 1).find((l) => l.trim() !== '');
    };
    // 2・5・7 番の次の行は、すぐ次の節の見出し（### ）
    expect(nextNonEmpty('## 対象者または対象物')).toBe('### 対象者');
    expect(nextNonEmpty('## 計算方法・計算式')).toBe('### 住宅耐震改修特別控除の控除額の計算方法');
    expect(nextNonEmpty('## 手続き')).toBe('### 申告等の方法');
    // 3・4・6・8・9 番の次の行は段落（見出しの行ではない）
    for (const h of [
      '### 対象者',
      '### 控除の適用を受けるための要件',
      '### 住宅耐震改修特別控除の控除額の計算方法',
      '### 申告等の方法',
      '### 申告先等',
    ]) {
      expect(nextNonEmpty(h)?.startsWith('#')).toBe(false);
    }
  });

  it('SPEC-NTA-GET-TAX-ANSWER-007 DB から返したときも国税庁サイトから取ったときと同じ見出しの行', async () => {
    const fetchImpl = articleFetch({ [PATH_6101]: readFixture(FX_6101_H3) });
    const live = (await getTaxAnswer({ no: '6101' }, { fetchImpl, dbPath })) as string;
    const fromDb = (await getTaxAnswer(
      { no: '6101' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as string;
    expect(fromDb).toContain('取得元: ローカル DB');
    expect(headingLines(fromDb)).toEqual(headingLines(live));
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-GET-TAX-ANSWER-008（MODIFIED）                                     */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-GET-TAX-ANSWER-008 json の taxAnswer.sections の要素は heading・paragraphs・level の 3 つのキーを持つ', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-008 要素のキーは heading・paragraphs・level の 3 つで、level は 2 か 3、配列は 1 件以上', async () => {
    for (const [no, path, fx] of [
      ['6101', PATH_6101, FX_6101_H3],
      ['1222', PATH_1222, FX_1222],
      ['6101', PATH_6101, FX_6101_H2_ONLY],
    ] as const) {
      rmSync(dbPath, { force: true });
      const r = await liveJson(no, path, readFixture(fx));
      const sections = r.taxAnswer?.sections ?? [];
      expect(sections.length).toBeGreaterThanOrEqual(1);
      for (const s of sections) {
        expect(Object.keys(s).sort()).toEqual(['heading', 'level', 'paragraphs']);
        expect(typeof s.heading).toBe('string');
        expect(Array.isArray(s.paragraphs)).toBe(true);
        expect([2, 3]).toContain(s.level);
      }
    }
  });

  it('SPEC-NTA-GET-TAX-ANSWER-008 paragraphs が空の要素は、次の見出しが h3 の h2 の節（level 2 で、次の要素が level 3）だけ', async () => {
    for (const [no, path, fx] of [
      ['6101', PATH_6101, FX_6101_H3],
      ['1222', PATH_1222, FX_1222],
    ] as const) {
      rmSync(dbPath, { force: true });
      const r = await liveJson(no, path, readFixture(fx));
      const sections = r.taxAnswer?.sections ?? [];
      // 019 の例 1 では空の節は無く、例 2 では 2・5・7 番の 3 つ
      expect(sections.filter((s) => s.paragraphs.length === 0)).toHaveLength(no === '1222' ? 3 : 0);
      sections.forEach((s, i) => {
        if (s.paragraphs.length > 0) return;
        expect(s.level).toBe(2);
        expect(sections[i + 1]?.level).toBe(3);
      });
    }
  });
});

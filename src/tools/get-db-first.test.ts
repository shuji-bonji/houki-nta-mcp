/**
 * Issue #29: 取得ツールの DB の使い方を揃える
 *
 * `nta_get_qa` / `nta_get_tax_answer` が
 *   1. ローカル DB を先に引き、
 *   2. 無ければ国税庁サイトから取得して DB へ書き戻し、
 *   3. どちらから返したかを `source` で示す
 * ことを確かめる。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encode as iconvEncode } from 'iconv-lite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getQa, getTaxAnswer } from './handlers.js';

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'tests', 'fixtures');

function sjisHtmlResponse(fixtureName: string): Response {
  const html = readFileSync(resolve(fixturesDir, fixtureName), 'utf8');
  const buf = iconvEncode(html, 'shift_jis');
  return new Response(buf, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
  });
}

/** 呼ばれたら必ず失敗する fetch。DB から返したことを確かめるために使う */
const failingFetch = vi.fn(async () => {
  throw new Error('国税庁サイトを取りに行ってはいけない');
}) as unknown as typeof fetch;

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-get-db-first-'));
  dbPath = join(dir, 'cache.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('nta_get_qa — DB を先に引く', () => {
  it('DB が空なら国税庁サイトから取得し source=live を返す', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_shitsugi_shohi_02_19.htm')
    ) as unknown as typeof fetch;

    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl, dbPath }
    )) as { source?: string; qa?: { title: string } };

    expect(r.source).toBe('live');
    expect(r.qa?.title).toContain('ゴルフ会員権');
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it('1 回取得すると DB に入り、2 回目は取得しない（source=db）', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_shitsugi_shohi_02_19.htm')
    ) as unknown as typeof fetch;
    await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl, dbPath }
    );

    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl: failingFetch, dbPath }
    )) as {
      source?: string;
      qa?: { title: string; question: string[]; answer: string[]; relatedLaws: string[] };
      related_laws?: unknown[];
    };

    expect(r.source).toBe('db');
    // live と同じ構造で返る（段落の配列と、そこから作る related_laws が残っている）
    expect(r.qa?.title).toContain('ゴルフ会員権');
    expect(r.qa?.question.length).toBeGreaterThan(0);
    expect(r.qa?.answer.length).toBeGreaterThan(0);
    expect(r.related_laws?.length).toBeGreaterThan(0);
  });

  it('DB から返すと fetchedAt は取得した日時のまま（実行時刻にならない）', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_shitsugi_shohi_02_19.htm')
    ) as unknown as typeof fetch;
    const first = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl, dbPath }
    )) as { qa?: { fetchedAt: string } };

    const second = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl: failingFetch, dbPath }
    )) as { qa?: { fetchedAt: string } };

    expect(second.qa?.fetchedAt).toBe(first.qa?.fetchedAt);
  });

  it('format=markdown でも DB から返し、取得元を書く', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_shitsugi_shohi_02_19.htm')
    ) as unknown as typeof fetch;
    await getQa({ topic: 'shohi', category: '02', id: '19' }, { fetchImpl, dbPath });

    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19' },
      { fetchImpl: failingFetch, dbPath }
    )) as string;

    expect(typeof r).toBe('string');
    expect(r).toContain('ゴルフ会員権');
    expect(r).toContain('取得元: ローカル DB');
  });
});

describe('nta_get_tax_answer — DB を先に引く', () => {
  it('DB が空なら国税庁サイトから取得し source=live を返す', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm')
    ) as unknown as typeof fetch;

    const r = (await getTaxAnswer({ no: '6101', format: 'json' }, { fetchImpl, dbPath })) as {
      source?: string;
      taxAnswer?: { no: string };
    };

    expect(r.source).toBe('live');
    expect(r.taxAnswer?.no).toBe('6101');
  });

  it('1 回取得すると DB に入り、2 回目は取得しない（source=db）', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm')
    ) as unknown as typeof fetch;
    const first = (await getTaxAnswer({ no: '6101', format: 'json' }, { fetchImpl, dbPath })) as {
      taxAnswer?: { sections: unknown[]; fetchedAt: string };
    };

    const r = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: failingFetch, dbPath }
    )) as {
      source?: string;
      taxAnswer?: { no: string; title: string; sections: unknown[]; fetchedAt: string };
    };

    expect(r.source).toBe('db');
    // 見出しごとの節が live と同じ数だけ戻る
    expect(r.taxAnswer?.sections.length).toBe(first.taxAnswer?.sections.length);
    expect(r.taxAnswer?.fetchedAt).toBe(first.taxAnswer?.fetchedAt);
  });
});

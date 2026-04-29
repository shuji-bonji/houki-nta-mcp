import { describe, it, expect, vi } from 'vitest';
import { encode as iconvEncode } from 'iconv-lite';

import { fetchNtaPage, detectCharset, normalizeCharset, NtaFetchError } from './nta-scraper.js';

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function sjisResponse(html: string, contentType = 'text/html; charset=Shift_JIS'): Response {
  const buf = iconvEncode(html, 'shift_jis');
  return new Response(buf, {
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': contentType },
  });
}

/* -------------------------------------------------------------------------- */
/* normalizeCharset                                                           */
/* -------------------------------------------------------------------------- */

describe('normalizeCharset', () => {
  it('Shift_JIS 系の表記揺れを shift_jis に揃える', () => {
    expect(normalizeCharset('Shift_JIS')).toBe('shift_jis');
    expect(normalizeCharset('shift-jis')).toBe('shift_jis');
    expect(normalizeCharset('SJIS')).toBe('shift_jis');
    expect(normalizeCharset('x-sjis')).toBe('shift_jis');
    expect(normalizeCharset('MS_Kanji')).toBe('shift_jis');
    expect(normalizeCharset('csShiftJIS')).toBe('shift_jis');
  });

  it('UTF-8 系を utf-8 に揃える', () => {
    expect(normalizeCharset('UTF-8')).toBe('utf-8');
    expect(normalizeCharset('utf8')).toBe('utf-8');
  });

  it('未知の charset はそのまま小文字で返す', () => {
    expect(normalizeCharset('ISO-8859-1')).toBe('iso-8859-1');
  });
});

/* -------------------------------------------------------------------------- */
/* detectCharset                                                              */
/* -------------------------------------------------------------------------- */

describe('detectCharset', () => {
  it('Content-Type ヘッダから charset を取り出す', () => {
    const buf = Buffer.from('<html></html>');
    expect(detectCharset('text/html; charset=Shift_JIS', buf)).toBe('shift_jis');
    expect(detectCharset('text/html;charset="UTF-8"', buf)).toBe('utf-8');
  });

  it('ヘッダに無いとき HTML <meta charset> から拾う', () => {
    const buf = Buffer.from('<html><head><meta charset="UTF-8"></head>');
    expect(detectCharset(null, buf)).toBe('utf-8');
  });

  it('http-equiv 形式の <meta> も拾う', () => {
    const buf = Buffer.from(
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS"></head>'
    );
    expect(detectCharset(null, buf)).toBe('shift_jis');
  });

  it('Content-Type にも meta にも charset が無ければ shift_jis にフォールバック', () => {
    const buf = Buffer.from('<html><head></head><body></body></html>');
    expect(detectCharset(null, buf)).toBe('shift_jis');
    expect(detectCharset('text/html', buf)).toBe('shift_jis');
  });
});

/* -------------------------------------------------------------------------- */
/* fetchNtaPage — 正常系                                                      */
/* -------------------------------------------------------------------------- */

describe('fetchNtaPage — 正常系', () => {
  it('Shift_JIS でエンコードされた HTML を正しくデコードして返す', async () => {
    const sourceHtml =
      '<html><head><title>テスト</title></head><body>消費税法基本通達 5-1-9</body></html>';
    const fetchImpl = vi.fn(async () => sjisResponse(sourceHtml)) as unknown as typeof fetch;

    const r = await fetchNtaPage('https://www.nta.go.jp/dummy', { fetchImpl });

    expect(r.status).toBe(200);
    expect(r.charset).toBe('shift_jis');
    expect(r.html).toBe(sourceHtml);
    expect(r.sourceUrl).toBe('https://www.nta.go.jp/dummy');
    expect(r.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('User-Agent / Accept-Language を付与してリクエストする', async () => {
    const fetchImpl = vi.fn(async () => sjisResponse('<html></html>')) as unknown as typeof fetch;
    await fetchNtaPage('https://www.nta.go.jp/x', { fetchImpl });

    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls).toHaveLength(1);
    const init = calls[0][1];
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('houki-nta-mcp');
    expect(headers['Accept-Language']).toBe('ja');
    expect(headers['Accept']).toContain('text/html');
  });

  it('forceCharset を指定すれば auto-detect を skip する', async () => {
    const sourceHtml = '消費税法基本通達';
    const sjisBuf = iconvEncode(sourceHtml, 'shift_jis');
    // ヘッダは UTF-8 と嘘をついているが forceCharset で shift_jis に上書き
    const fetchImpl = vi.fn(
      async () =>
        new Response(sjisBuf, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        })
    ) as unknown as typeof fetch;

    const r = await fetchNtaPage('https://x', { fetchImpl, forceCharset: 'Shift_JIS' });
    expect(r.charset).toBe('shift_jis');
    expect(r.html).toBe(sourceHtml);
  });

  it('Content-Type が無くても <meta> から charset を検出してデコードできる', async () => {
    const sourceHtml =
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS"></head><body>軽減税率</body></html>';
    const sjisBuf = iconvEncode(sourceHtml, 'shift_jis');
    const fetchImpl = vi.fn(
      async () =>
        new Response(sjisBuf, {
          status: 200,
          headers: { 'Content-Type': 'text/html' }, // charset 無し
        })
    ) as unknown as typeof fetch;

    const r = await fetchNtaPage('https://x', { fetchImpl });
    expect(r.charset).toBe('shift_jis');
    expect(r.html).toContain('軽減税率');
  });
});

/* -------------------------------------------------------------------------- */
/* fetchNtaPage — エラー系                                                    */
/* -------------------------------------------------------------------------- */

describe('fetchNtaPage — エラー系', () => {
  it('4xx は retry せず即 NtaFetchError を投げる', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('not found', {
          status: 404,
          statusText: 'Not Found',
        })
    ) as unknown as typeof fetch;

    await expect(
      fetchNtaPage('https://x', { fetchImpl, maxRetries: 3, retryBaseMs: 1 })
    ).rejects.toMatchObject({
      name: 'NtaFetchError',
      status: 404,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('5xx は retry し、途中で 200 になれば成功する', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call < 3) {
        return new Response('boom', { status: 500, statusText: 'Internal Server Error' });
      }
      return sjisResponse('OK');
    }) as unknown as typeof fetch;

    const r = await fetchNtaPage('https://x', {
      fetchImpl,
      maxRetries: 3,
      retryBaseMs: 1,
    });
    expect(r.status).toBe(200);
    expect(r.html).toBe('OK');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retry 上限を超えたら NtaFetchError を投げる（5xx を維持）', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('boom', { status: 503, statusText: 'Service Unavailable' })
    ) as unknown as typeof fetch;

    await expect(
      fetchNtaPage('https://x', { fetchImpl, maxRetries: 2, retryBaseMs: 1 })
    ).rejects.toBeInstanceOf(NtaFetchError);

    // 初回 + 2 回 retry = 3 回
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('ネットワーク例外 (TypeError 等) も retry してから最終エラー', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(
      fetchNtaPage('https://x', { fetchImpl, maxRetries: 1, retryBaseMs: 1 })
    ).rejects.toBeInstanceOf(NtaFetchError);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 初回 + 1 retry
  });
});

/* -------------------------------------------------------------------------- */
/* integration test — INTEGRATION=1 でのみ実行                                 */
/* -------------------------------------------------------------------------- */

const integration = process.env.INTEGRATION === '1';
const itIntegration = integration ? it : it.skip;

describe('fetchNtaPage — integration (INTEGRATION=1 でのみ実行)', () => {
  itIntegration(
    '消費税法基本通達 第1章第1節 を国税庁サイトから取得できる',
    async () => {
      const url = 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/01.htm';
      const r = await fetchNtaPage(url);

      expect(r.status).toBe(200);
      expect(r.sourceUrl).toBe(url);
      expect(r.html.length).toBeGreaterThan(500);
      // 文字化けしていないことを確認（消費税 / 通達 のいずれかが含まれているはず）
      expect(r.html).toMatch(/(消費税|通達|基本通達)/);
    },
    30_000
  );
});

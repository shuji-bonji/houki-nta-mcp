import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultFilesDir, MAX_PDF_BYTES, pdfFileNameFromUrl, savePdf } from './pdf-files.js';

const PDF = Buffer.from('%PDF-1.7\n%test\n');

function pdfResponse(body: Buffer = PDF, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/pdf', ...headers },
  });
}

describe('pdfFileNameFromUrl', () => {
  it('URL の最後のパス要素を使う', () => {
    expect(
      pdfFileNameFromUrl('https://www.nta.go.jp/law/tsutatsu/kihon/pdf/0025004-026_01.pdf')
    ).toBe('0025004-026_01.pdf');
  });
  it('拡張子が無ければ .pdf を付け、空なら download.pdf', () => {
    expect(pdfFileNameFromUrl('https://x/files/abc')).toBe('abc.pdf');
    expect(pdfFileNameFromUrl('https://x/')).toBe('download.pdf');
    expect(pdfFileNameFromUrl('not a url')).toBe('download.pdf');
  });
});

describe('defaultFilesDir', () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });
  it('HOUKI_NTA_FILES_DIR が最優先、次に XDG_CACHE_HOME、最後に ~/.cache', () => {
    process.env.HOUKI_NTA_FILES_DIR = '/explicit';
    expect(defaultFilesDir()).toBe('/explicit');
    delete process.env.HOUKI_NTA_FILES_DIR;
    process.env.XDG_CACHE_HOME = '/xdg';
    expect(defaultFilesDir()).toBe(resolve('/xdg', 'houki-nta-mcp', 'files'));
    delete process.env.XDG_CACHE_HOME;
    expect(defaultFilesDir()).toMatch(/\.cache[/\\]houki-nta-mcp[/\\]files$/);
  });
});

describe('savePdf', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('取得して <filesDir>/<docType>/<docId>/<name> に書き、絶対パスを返す', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pdf-files-'));
    const fetchImpl = vi.fn(async () => pdfResponse()) as unknown as typeof fetch;
    const r = await savePdf('https://x/a.pdf', {
      docType: 'kaisei',
      docId: '0025004-026',
      filesDir: dir,
      fetchImpl,
    });
    expect(r).toEqual({
      url: 'https://x/a.pdf',
      path: resolve(dir, 'kaisei', '0025004-026', 'a.pdf'),
      bytes: PDF.byteLength,
      cached: false,
    });
    expect(readFileSync(r.path as string)).toEqual(PDF);
  });

  it('既にあるファイルは再取得せず cached: true', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pdf-files-'));
    const fetchImpl = vi.fn(async () => pdfResponse()) as unknown as typeof fetch;
    const first = await savePdf('https://x/a.pdf', {
      docType: 'k',
      docId: 'd',
      filesDir: dir,
      fetchImpl,
    });
    const second = await savePdf('https://x/a.pdf', {
      docType: 'k',
      docId: 'd',
      filesDir: dir,
      fetchImpl,
    });
    expect(second).toEqual({ ...first, cached: true });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('Content-Type が PDF でなくても %PDF- で始まれば保存する', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pdf-files-'));
    const fetchImpl = vi.fn(async () =>
      pdfResponse(PDF, { 'content-type': 'application/octet-stream' })
    ) as unknown as typeof fetch;
    const r = await savePdf('https://x/a.pdf', {
      docType: 'k',
      docId: 'd',
      filesDir: dir,
      fetchImpl,
    });
    expect(r.path).not.toBeNull();
  });

  it('HTML が返ってきたら PDF ではないとして error（ファイルは書かない）', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pdf-files-'));
    const fetchImpl = vi.fn(
      async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })
    ) as unknown as typeof fetch;
    const r = await savePdf('https://x/a.pdf', {
      docType: 'k',
      docId: 'd',
      filesDir: dir,
      fetchImpl,
    });
    expect(r.path).toBeNull();
    expect(r.error).toContain('PDF ではありません');
    expect(r.error).toContain('text/html');
    expect(existsSync(resolve(dir, 'k', 'd', 'a.pdf'))).toBe(false);
  });

  it('4xx / 5xx は HTTP <status> を error に', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pdf-files-'));
    const fetchImpl = vi.fn(
      async () => new Response('', { status: 503 })
    ) as unknown as typeof fetch;
    const r = await savePdf('https://x/a.pdf', {
      docType: 'k',
      docId: 'd',
      filesDir: dir,
      fetchImpl,
    });
    expect(r).toMatchObject({ path: null, bytes: null, cached: false, error: 'HTTP 503' });
  });

  it('上限を超えるサイズは error', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pdf-files-'));
    const big = Buffer.alloc(MAX_PDF_BYTES + 1, 0x20);
    big.write('%PDF-', 0, 'latin1');
    const fetchImpl = vi.fn(async () => pdfResponse(big)) as unknown as typeof fetch;
    const r = await savePdf('https://x/big.pdf', {
      docType: 'k',
      docId: 'd',
      filesDir: dir,
      fetchImpl,
    });
    expect(r.path).toBeNull();
    expect(r.error).toContain('上限');
  });

  it('ネットワークエラーは message を error に（throw しない）', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pdf-files-'));
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const r = await savePdf('https://x/a.pdf', {
      docType: 'k',
      docId: 'd',
      filesDir: dir,
      fetchImpl,
    });
    expect(r.error).toBe('ECONNRESET');
  });

  it('docId の区切り文字はディレクトリ名で _ に置き換える', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pdf-files-'));
    writeFileSync(join(dir, 'marker'), '');
    const fetchImpl = vi.fn(async () => pdfResponse()) as unknown as typeof fetch;
    const r = await savePdf('https://x/a.pdf', {
      docType: 'k',
      docId: 'a/b',
      filesDir: dir,
      fetchImpl,
    });
    expect(r.path).toBe(resolve(dir, 'k', 'a_b', 'a.pdf'));
  });
});

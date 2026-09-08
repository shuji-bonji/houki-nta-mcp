/**
 * Phase 2e: CLI フラグ拡張のテスト。
 *
 * `--bulk-download-all` / `--refresh-stale=<日数>` / `--apply` などのパース確認。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseArgs, runCliIfRequested } from './cli.js';

// v0.10.2: --refresh が bulkDownloadTsutatsu の forceReload に渡ることを確認するため、
// 実際の DL は mock する (国税庁サイトには触れない)
vi.mock('./services/bulk-downloader.js', () => ({
  bulkDownloadTsutatsu: vi.fn(async () => ({ sections: 0, clauses: 0 })),
}));
// v0.10.4: 残り 5 種別の downloader にも forceReload が渡ることを確認する
const emptyBulkResult = () => ({
  totalEntries: 0,
  documentsFetched: 0,
  documentsFailed: 0,
  durationMs: 0,
  perTaxonomy: {},
  perTopic: {},
});
vi.mock('./services/bunshokaitou-bulk-downloader.js', () => ({
  bulkDownloadBunshokaitou: vi.fn(async () => emptyBulkResult()),
}));
vi.mock('./services/jimu-unei-bulk-downloader.js', () => ({
  bulkDownloadJimuUnei: vi.fn(async () => emptyBulkResult()),
}));
vi.mock('./services/tax-answer-bulk-downloader.js', () => ({
  bulkDownloadTaxAnswer: vi.fn(async () => emptyBulkResult()),
}));
vi.mock('./services/qa-bulk-downloader.js', () => ({
  bulkDownloadQa: vi.fn(async () => emptyBulkResult()),
}));
vi.mock('./services/kaisei-bulk-downloader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/kaisei-bulk-downloader.js')>();
  return { ...actual, bulkDownloadKaisei: vi.fn(async () => emptyBulkResult()) };
});

import { bulkDownloadTsutatsu } from './services/bulk-downloader.js';
import { bulkDownloadBunshokaitou } from './services/bunshokaitou-bulk-downloader.js';
import { bulkDownloadJimuUnei } from './services/jimu-unei-bulk-downloader.js';
import { bulkDownloadKaisei } from './services/kaisei-bulk-downloader.js';
import { bulkDownloadQa } from './services/qa-bulk-downloader.js';
import { bulkDownloadTaxAnswer } from './services/tax-answer-bulk-downloader.js';

describe('parseArgs', () => {
  it('既定値', () => {
    const a = parseArgs([]);
    expect(a.bulkDownload).toBe(false);
    expect(a.bulkDownloadAll).toBe(false);
    expect(a.staleDays).toBeUndefined();
    expect(a.refreshStale).toBe(false);
    expect(a.tsutatsu).toBe('消費税法基本通達');
    expect(a.help).toBe(false);
    expect(a.version).toBe(false);
  });

  it('--bulk-download-all', () => {
    const a = parseArgs(['--bulk-download-all']);
    expect(a.bulkDownloadAll).toBe(true);
    expect(a.bulkDownload).toBe(false);
  });

  it('--refresh-stale=30 で staleDays が 30 になる', () => {
    const a = parseArgs(['--refresh-stale=30']);
    expect(a.staleDays).toBe(30);
    expect(a.refreshStale).toBe(false); // dry-run（未 --apply）
  });

  it('--refresh-stale=30 --apply で再 DL モード', () => {
    const a = parseArgs(['--refresh-stale=30', '--apply']);
    expect(a.staleDays).toBe(30);
    expect(a.refreshStale).toBe(true);
  });

  it('不正な --refresh-stale 値は undefined のまま', () => {
    expect(parseArgs(['--refresh-stale=abc']).staleDays).toBeUndefined();
    expect(parseArgs(['--refresh-stale=-5']).staleDays).toBeUndefined();
  });

  it('--db-path / --tsutatsu の併用', () => {
    const a = parseArgs([
      '--bulk-download',
      '--tsutatsu=所得税基本通達',
      '--db-path=/tmp/cache.db',
    ]);
    expect(a.bulkDownload).toBe(true);
    expect(a.tsutatsu).toBe('所得税基本通達');
    expect(a.dbPath).toBe('/tmp/cache.db');
  });

  it('--help / --version', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--version']).version).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
  });
});

describe('--refresh → forceReload (v0.10.2)', () => {
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  afterEach(() => {
    vi.mocked(bulkDownloadTsutatsu).mockClear();
  });

  it('parseArgs: --refresh で refresh が true', () => {
    expect(parseArgs([]).refresh).toBe(false);
    expect(parseArgs(['--refresh']).refresh).toBe(true);
  });

  it('--bulk-download --refresh は forceReload: true で bulkDownloadTsutatsu を呼ぶ', async () => {
    const handled = await runCliIfRequested(['--bulk-download', '--refresh', '--db-path=:memory:']);
    expect(handled).toBe(true);
    expect(bulkDownloadTsutatsu).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bulkDownloadTsutatsu).mock.calls[0][1]).toMatchObject({
      formalName: '消費税法基本通達',
      forceReload: true,
    });
  });

  it('--bulk-download だけなら forceReload: false (差分更新)', async () => {
    await runCliIfRequested(['--bulk-download', '--db-path=:memory:']);
    expect(vi.mocked(bulkDownloadTsutatsu).mock.calls[0][1]).toMatchObject({ forceReload: false });
  });

  it('--bulk-download-all --refresh も各通達に forceReload: true を渡す', async () => {
    await runCliIfRequested(['--bulk-download-all', '--refresh', '--db-path=:memory:']);
    const calls = vi.mocked(bulkDownloadTsutatsu).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) expect(c[1]).toMatchObject({ forceReload: true });
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe('--refresh → forceReload: 通達以外の 5 種別 (v0.10.4)', () => {
  // v0.10.2 の修正は bulkDownloadTsutatsu の 3 呼び出しだけで、この 5 経路には
  // forceReload が渡っていなかった。--refresh を付けても 304 で parse がスキップされ、
  // パーサーを直しても DB が更新されない (v0.10.3 の文書回答事例で発覚: 510 件全部 304)
  const cases = [
    ['--bulk-download-bunshokaitou', bulkDownloadBunshokaitou],
    ['--bulk-download-jimu-unei', bulkDownloadJimuUnei],
    ['--bulk-download-tax-answer', bulkDownloadTaxAnswer],
    ['--bulk-download-qa', bulkDownloadQa],
    ['--bulk-download-kaisei', bulkDownloadKaisei],
  ] as const;

  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    for (const [, fn] of cases) vi.mocked(fn).mockClear();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  for (const [flag, fn] of cases) {
    it(`${flag} --refresh は forceReload: true を渡す`, async () => {
      await runCliIfRequested([flag, '--refresh', '--db-path=:memory:']);
      const calls = vi.mocked(fn).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const c of calls) expect(c[1]).toMatchObject({ forceReload: true });
    });

    it(`${flag} だけなら forceReload: false (差分更新)`, async () => {
      await runCliIfRequested([flag, '--db-path=:memory:']);
      const calls = vi.mocked(fn).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const c of calls) expect(c[1]).toMatchObject({ forceReload: false });
    });
  }

  it('--bulk-download-everything --refresh は 6 種別すべてに forceReload: true を渡す', async () => {
    await runCliIfRequested(['--bulk-download-everything', '--refresh', '--db-path=:memory:']);
    for (const fn of [bulkDownloadTsutatsu, ...cases.map(([, f]) => f)]) {
      const calls = vi.mocked(fn).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const c of calls) expect(c[1]).toMatchObject({ forceReload: true });
    }
  });
});

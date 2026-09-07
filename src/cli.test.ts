/**
 * Phase 2e: CLI フラグ拡張のテスト。
 *
 * `--bulk-download-all` / `--refresh-stale=<日数>` / `--apply` などのパース確認。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseArgs, runCliIfRequested } from './cli.js';

// v0.10.2: --refresh が bulkDownloadTsutatsu の forceReload に渡ることを確認するため、
// 実際の DL は mock する (国税庁サイトには触れない)
vi.mock('./services/bulk-downloader.js', () => ({
  bulkDownloadTsutatsu: vi.fn(async () => ({ sections: 0, clauses: 0 })),
}));

import { bulkDownloadTsutatsu } from './services/bulk-downloader.js';

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

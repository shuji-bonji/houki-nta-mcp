/**
 * Phase 2e: CLI フラグ拡張のテスト。
 *
 * `--bulk-download-all` / `--refresh-stale=<日数>` / `--apply` などのパース確認。
 */

import { describe, it, expect } from 'vitest';

import { parseArgs } from './cli.js';

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

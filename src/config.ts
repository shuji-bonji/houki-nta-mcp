/**
 * Configuration
 *
 * package.json から動的に version を取得する（hardcode 禁止）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PackageJson {
  name: string;
  version: string;
  description?: string;
}

function loadPackageJson(): PackageJson {
  // dist/config.js から見て ../package.json
  // src/config.ts から見て ../package.json
  const candidates = [
    resolve(__dirname, '..', 'package.json'),
    resolve(__dirname, '..', '..', 'package.json'),
  ];

  for (const path of candidates) {
    try {
      const content = readFileSync(path, 'utf8');
      return JSON.parse(content);
    } catch {
      // 次の候補へ
    }
  }

  // 万が一見つからない場合のフォールバック
  return {
    name: '@shuji-bonji/houki-nta-mcp',
    version: '0.0.0',
  };
}

const pkg = loadPackageJson();

export const PACKAGE_INFO = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description ?? '',
} as const;

/** スクレイピング時のタイムアウト・リトライ設定（Phase 1 で本実装） */
export const FETCH_CONFIG = {
  /** リクエストタイムアウト (ms) */
  timeoutMs: 30_000,
  /** 最大リトライ回数 */
  maxRetries: 3,
  /** リトライ間隔の基準値 (ms)。指数バックオフ */
  retryBaseMs: 1_000,
  /** User-Agent — 国税庁サイトを叩くときに付ける */
  userAgent: `${PACKAGE_INFO.name}/${PACKAGE_INFO.version} (+https://github.com/shuji-bonji/houki-nta-mcp)`,
} as const;

/** キャッシュ設定（Phase 1 で本実装） */
export const CACHE_CONFIG = {
  /** メモリキャッシュ最大件数 */
  maxSize: 100,
  /** 有効期限 (ms)。デフォルト 24時間 */
  ttlMs: 24 * 60 * 60 * 1000,
} as const;

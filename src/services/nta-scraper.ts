/**
 * NTA Scraper — 国税庁サイトの HTML 取得層
 *
 * 責務:
 *  - `fetch` で国税庁サイトから HTML を取得
 *  - `iconv-lite` で Shift_JIS / UTF-8 を自動判定してデコード
 *  - User-Agent / Accept-Language を付与（DATA-SOURCES.md のマナー準拠）
 *  - 5xx / ネットワークエラーを指数バックオフで retry
 *  - 4xx は retry しない（永続エラー）
 *
 * 責務外:
 *  - HTML パース（章-項-号 の抽出など）→ parser 層（`tsutatsu-parser.ts` 等）
 *  - キャッシュ → `utils/cache.ts`（Phase 1 後半で導入予定）
 *
 * 上位レイヤは `cheerio.load(result.html)` を自分で呼んで利用する。
 */

import { decode } from 'iconv-lite';

import { FETCH_CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';

/** スクレイピング結果 */
export interface NtaFetchResult {
  /** デコード済み HTML 文字列。304 Not Modified 時は空文字 */
  html: string;
  /** リクエストした URL（一次情報源として citation に使う） */
  sourceUrl: string;
  /** 取得時刻 ISO 8601 */
  fetchedAt: string;
  /** デコードに使われた charset（小文字、'shift_jis' / 'utf-8' など）。304 時は空文字 */
  charset: string;
  /** HTTP ステータス。304 のときは 304、変更ありなら 200 */
  status: number;
  /**
   * Phase 6-2 (v0.9.0): サーバが返した HTTP `Last-Modified` ヘッダ。
   * RFC 7232 形式 (`Thu, 18 Jan 2024 09:30:37 GMT`)。
   * 304 応答時は通常は不在 (キャッシュ側に既存値があるため)。
   */
  lastModified?: string;
  /** Phase 6-2 (v0.9.0): サーバが返した HTTP `ETag` ヘッダ */
  etag?: string;
  /**
   * Phase 6-2 (v0.9.0): 304 Not Modified を受け取って parse をスキップした場合 `true`。
   * 呼び出し側はこれを見て「DB の content_hash と fetched_at だけ更新」の経路に分岐する。
   */
  notModified?: boolean;
}

/** スクレイピング失敗時の例外。url / status / cause を保持 */
export class NtaFetchError extends Error {
  public readonly url: string;
  public readonly status?: number;
  public readonly cause?: unknown;

  constructor(message: string, url: string, status?: number, cause?: unknown) {
    super(message);
    this.name = 'NtaFetchError';
    this.url = url;
    if (status !== undefined) this.status = status;
    if (cause !== undefined) this.cause = cause;
  }
}

/** `fetchNtaPage` のオプション */
export interface FetchNtaPageOptions {
  /** タイムアウト (ms)。未指定なら `FETCH_CONFIG.timeoutMs` */
  timeoutMs?: number;
  /** 最大リトライ回数。未指定なら `FETCH_CONFIG.maxRetries` */
  maxRetries?: number;
  /**
   * 指数バックオフの基準値 (ms)。未指定なら `FETCH_CONFIG.retryBaseMs`。
   * テストで小さな値を入れて実行時間を縮められる。
   */
  retryBaseMs?: number;
  /** charset を強制指定（デバッグ用）。指定すれば auto-detect は skip */
  forceCharset?: string;
  /**
   * `fetch` の差し替え（テスト用）。デフォルトは `globalThis.fetch`。
   * シグネチャは標準 fetch と同じ。
   */
  fetchImpl?: typeof fetch;
  /**
   * Phase 6-2 (v0.9.0): `If-Modified-Since` ヘッダに渡す値。
   * RFC 7232 形式 (`Thu, 18 Jan 2024 09:30:37 GMT`) を期待。
   * 指定するとサーバ側が同一 Last-Modified なら **304 Not Modified** を返し、
   * `result.notModified === true` + `result.html === ''` で帰る。
   */
  ifModifiedSince?: string;
  /**
   * Phase 6-2 (v0.9.0): `If-None-Match` ヘッダに渡す ETag 値。
   * `ifModifiedSince` と併用可能 (両方を送ってサーバが任意の判定をする)。
   */
  ifNoneMatch?: string;
}

/**
 * 国税庁サイトから HTML を取得してデコードする。
 *
 * - 4xx 応答は retry せず即時 `NtaFetchError` を投げる
 * - 5xx / ネットワークエラーは指数バックオフで `maxRetries` 回まで retry
 *
 * @param url 取得対象 URL（例: 消費税法基本通達のあるページ）
 * @param options
 * @returns デコード済み HTML + メタ
 * @throws {NtaFetchError} 取得失敗時
 */
export async function fetchNtaPage(
  url: string,
  options: FetchNtaPageOptions = {}
): Promise<NtaFetchResult> {
  const maxRetries = options.maxRetries ?? FETCH_CONFIG.maxRetries;
  const timeoutMs = options.timeoutMs ?? FETCH_CONFIG.timeoutMs;
  const retryBaseMs = options.retryBaseMs ?? FETCH_CONFIG.retryBaseMs;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoffMs = retryBaseMs * 2 ** (attempt - 1);
      logger.warn('nta-scraper', 'retrying', { url, attempt, backoffMs });
      await sleep(backoffMs);
    }

    try {
      return await doFetch(url, options, fetchImpl, timeoutMs);
    } catch (err) {
      lastError = err;

      // 4xx は永続エラー扱い: retry せず即 throw
      if (
        err instanceof NtaFetchError &&
        err.status !== undefined &&
        err.status >= 400 &&
        err.status < 500
      ) {
        throw err;
      }

      // 最後の試行でも失敗 → ラップして throw
      if (attempt === maxRetries) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new NtaFetchError(
          `failed after ${maxRetries + 1} attempt(s): ${msg}`,
          url,
          err instanceof NtaFetchError ? err.status : undefined,
          err
        );
      }
      // それ以外は次の retry へ
    }
  }

  // ループ構造上ここには到達しないが TypeScript の網羅性のため
  throw new NtaFetchError('unreachable: scraper exited unexpectedly', url, undefined, lastError);
}

/**
 * 1 回の取得試行。retry 制御の外殻と分離する。
 */
async function doFetch(
  url: string,
  options: FetchNtaPageOptions,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<NtaFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'User-Agent': FETCH_CONFIG.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja',
    };
    // Phase 6-2: conditional GET ヘッダ
    if (options.ifModifiedSince) {
      headers['If-Modified-Since'] = options.ifModifiedSince;
    }
    if (options.ifNoneMatch) {
      headers['If-None-Match'] = options.ifNoneMatch;
    }

    const res = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers,
    });

    // Phase 6-2: 304 Not Modified — body は空、ヘッダだけ受け取って早期 return
    if (res.status === 304) {
      // ボディは消費しないが、Node fetch では cancel しないと socket がリークし得る
      try {
        await res.body?.cancel();
      } catch {
        // cancel 失敗は無視（テスト stub では body が undefined のことがある）
      }
      logger.debug('nta-scraper', 'not-modified', { url });
      const result: NtaFetchResult = {
        html: '',
        sourceUrl: url,
        fetchedAt: new Date().toISOString(),
        charset: '',
        status: 304,
        notModified: true,
      };
      const lastMod = res.headers.get('last-modified');
      const etag = res.headers.get('etag');
      if (lastMod) result.lastModified = lastMod;
      if (etag) result.etag = etag;
      return result;
    }

    if (!res.ok) {
      throw new NtaFetchError(`HTTP ${res.status} ${res.statusText}`, url, res.status);
    }

    // soft-404 検知 (Phase 5 Resilience Lv-3a):
    // 国税庁サイトは存在しない URL を 302 → /error/404.htm に飛ばすため、
    // HTTP ステータスは 200 だが内容は「指定されたページを表示できませんでした」になる。
    // parser を呼ぶ前にここで弾き、4xx 相当として永続エラーで返す。
    if (isNtaSoft404(res.url, url)) {
      throw new NtaFetchError(
        `soft-404 (redirected to ${res.url})`,
        url,
        404 // 4xx 相当にして retry を skip させる
      );
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const charset = options.forceCharset
      ? normalizeCharset(options.forceCharset)
      : detectCharset(res.headers.get('content-type'), buf);
    const html = decode(buf, charset);

    logger.debug('nta-scraper', 'fetched', {
      url,
      status: res.status,
      bytes: buf.byteLength,
      charset,
    });

    const result: NtaFetchResult = {
      html,
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
      charset,
      status: res.status,
    };
    const lastMod = res.headers.get('last-modified');
    const etag = res.headers.get('etag');
    if (lastMod) result.lastModified = lastMod;
    if (etag) result.etag = etag;
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Content-Type ヘッダ → HTML meta タグ → デフォルト Shift_JIS の順で charset を決定する。
 *
 * 国税庁サイトはページによって Shift_JIS / UTF-8 が混在するため auto-detect が必要。
 */
export function detectCharset(contentTypeHeader: string | null, htmlBytes: Buffer): string {
  // 1) Content-Type: text/html; charset=Shift_JIS
  const fromHeader = contentTypeHeader?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
  if (fromHeader) {
    return normalizeCharset(fromHeader);
  }

  // 2) HTML 先頭から <meta charset="..."> / <meta http-equiv="Content-Type" content="...; charset=..."> を探す
  // 先頭 1024 byte までを ASCII 互換として走査（charset 宣言は head 直下にある想定）
  const head = htmlBytes.subarray(0, 1024).toString('ascii');
  const metaCharset =
    head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1] ??
    head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w-]+)/i)?.[1];
  if (metaCharset) {
    return normalizeCharset(metaCharset);
  }

  // 3) フォールバック: 国税庁サイトは伝統的に Shift_JIS が多い
  return 'shift_jis';
}

/**
 * iconv-lite が認識する正規化された charset 名に揃える。
 */
export function normalizeCharset(charset: string): string {
  const lower = charset.toLowerCase().trim();
  if (
    lower === 'shift-jis' ||
    lower === 'shift_jis' ||
    lower === 'sjis' ||
    lower === 'x-sjis' ||
    lower === 'ms_kanji' ||
    lower === 'csshiftjis'
  ) {
    return 'shift_jis';
  }
  if (lower === 'utf8') return 'utf-8';
  return lower;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 国税庁サイトの soft-404 判定 (Phase 5 Resilience Lv-3a)。
 *
 * 国税庁サイトは存在しない URL に対して
 *   1. HTTP 302 → `https://www.nta.go.jp/error/404.htm` にリダイレクト
 *   2. リダイレクト先は HTTP 200 を返す
 * という構造で、parser から見ると「2007 bytes の謎の HTML」が降ってきて
 * 「本体セレクタが見つかりません」という曖昧な失敗になる。
 *
 * `fetch` で `redirect: 'follow'` した結果として `res.url` が
 * `/error/404.htm` で終わる、かつ要求 URL と異なる場合に soft-404 と判定する。
 *
 * 2026-05-11 Canary 失敗 (sozoku/, hojin/01/03.htm) で実際に踏んだケース。
 *
 * @param finalUrl `res.url` (redirect 追従後の最終 URL)
 * @param requestedUrl 元の要求 URL
 */
export function isNtaSoft404(finalUrl: string, requestedUrl: string): boolean {
  if (!finalUrl) return false;
  if (finalUrl === requestedUrl) return false;
  // 末尾のクエリ・ハッシュは無視して pathname 部だけ見たい
  try {
    const u = new URL(finalUrl);
    // 国税庁の soft-404 着地点は通常 /error/404.htm。
    // 将来 /error/40x.htm のような分岐があっても拾えるよう前方一致で判定する。
    return u.hostname.endsWith('nta.go.jp') && u.pathname.startsWith('/error/');
  } catch {
    return false;
  }
}

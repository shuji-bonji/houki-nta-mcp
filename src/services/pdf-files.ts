/**
 * PDF Files — 添付 PDF をサーバー側のキャッシュに保存し、絶対パスを返す（#36、v0.19.0）。
 *
 * houki-nta-mcp は PDF の本文を読まない。pdf-reader-mcp の `extract_tables` / `read_text` /
 * `summarize` はローカルファイルのパス（`file_path`）しか受け取らず、`read_url` は読んだ
 * バイト列を保存しない。そのため「URL のまま読む」以外の経路には、どこかがファイルを置く
 * 必要がある。houki-egov-mcp の `get_attachment` の `save: true` と同じ形で、この責務だけを持つ。
 *
 * 保存先: `${HOUKI_NTA_FILES_DIR ?? ${XDG_CACHE_HOME:-~/.cache}/houki-nta-mcp/files}/<docType>/<docId>/<ファイル名>`
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';

/** 保存する PDF の上限（pdf-reader-mcp の `read_url` と同じ 50MB） */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/**
 * 保存先ディレクトリの既定値。
 *
 * - `HOUKI_NTA_FILES_DIR` があればそれ
 * - なければ `${XDG_CACHE_HOME:-~/.cache}/houki-nta-mcp/files`（DB と同じ置き場所の隣）
 */
export function defaultFilesDir(): string {
  if (process.env.HOUKI_NTA_FILES_DIR) return process.env.HOUKI_NTA_FILES_DIR;
  const xdg = process.env.XDG_CACHE_HOME;
  const cacheRoot = xdg && xdg.length > 0 ? xdg : resolve(homedir(), '.cache');
  return resolve(cacheRoot, 'houki-nta-mcp', 'files');
}

/** `saved[]` の 1 件。失敗した PDF も `error` を付けてここに入る（黙って落とさない） */
export interface SavedPdf {
  /** 元の URL（`attachedPdfs[].url` と同じ値。突き合わせ用） */
  url: string;
  /** 保存したファイルの絶対パス。失敗時は null */
  path: string | null;
  /** ファイルサイズ（バイト）。失敗時は null */
  bytes: number | null;
  /** 既に保存済みのファイルを使った（今回はダウンロードしていない）とき true */
  cached: boolean;
  /** 取得に失敗した理由。成功時は付かない */
  error?: string;
}

export interface SavePdfOptions {
  docType: string;
  docId: string;
  /** 保存先ディレクトリ。未指定なら `defaultFilesDir()` */
  filesDir?: string;
  /** `fetch` の差し替え（テスト用）。既定は `globalThis.fetch` */
  fetchImpl?: typeof fetch;
  /** タイムアウト（ms）。既定 30 秒 */
  timeoutMs?: number;
}

/**
 * URL の最後のパス要素をファイル名にする。ディレクトリ区切りと空白は `_` に置き換え、
 * 拡張子が無ければ `.pdf` を付ける。URL として解釈できない文字列なら `download.pdf`。
 */
export function pdfFileNameFromUrl(url: string): string {
  let name = '';
  try {
    name = basename(new URL(url).pathname);
  } catch {
    name = '';
  }
  name = name.replace(/[\\/\s]+/g, '_');
  if (!name || name === '.' || name === '..') name = 'download.pdf';
  if (!/\.pdf$/i.test(name)) name = `${name}.pdf`;
  return name;
}

/**
 * 1 件の PDF を保存先に置き、絶対パスを返す。
 *
 * - 同じパスに既にファイルがあれば取得せず、そのまま `cached: true` で返す
 * - 応答が 2xx でない、`Content-Type` が PDF でも `%PDF` で始まりもしない、50MB を超える、
 *   のいずれかは `error` に理由を書いて `path: null` で返す（throw しない）
 */
export async function savePdf(url: string, options: SavePdfOptions): Promise<SavedPdf> {
  const filesDir = options.filesDir ?? defaultFilesDir();
  const dir = resolve(filesDir, safeSegment(options.docType), safeSegment(options.docId));
  const path = resolve(dir, pdfFileNameFromUrl(url));

  if (existsSync(path)) {
    return { url, path, bytes: statSync(path).size, cached: true };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/pdf,*/*;q=0.8' },
    });
    if (!res.ok) {
      return { url, path: null, bytes: null, cached: false, error: `HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_PDF_BYTES) {
      return {
        url,
        path: null,
        bytes: null,
        cached: false,
        error: `${buf.byteLength} バイトあり、上限 ${MAX_PDF_BYTES} バイトを超えています`,
      };
    }
    const contentType = res.headers.get('content-type') ?? '';
    const looksLikePdf = buf.subarray(0, 5).toString('latin1') === '%PDF-';
    if (!contentType.toLowerCase().includes('application/pdf') && !looksLikePdf) {
      return {
        url,
        path: null,
        bytes: null,
        cached: false,
        error: `PDF ではありません（Content-Type: ${contentType || '不明'}）`,
      };
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, buf);
    return { url, path, bytes: buf.byteLength, cached: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url, path: null, bytes: null, cached: false, error: message };
  }
}

/** ディレクトリ名に使えない文字を `_` に置き換える（docId に `/` が入ることはないが念のため） */
function safeSegment(s: string): string {
  const cleaned = s.replace(/[\\/\0]+/g, '_').trim();
  return cleaned.length > 0 ? cleaned : '_';
}

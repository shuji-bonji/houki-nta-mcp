/**
 * Document Write-back — Issue #29
 *
 * `nta_get_qa` / `nta_get_tax_answer` が国税庁サイトから取得したときに、その結果を
 * `document` テーブルへ入れるためのヘルパー。次に同じ文書を引いたときは DB から返せる。
 *
 * 目的は「取得ツールと bulk download が同じ行を作る」ことです。そのため
 * `content_hash` の計算式を bulk-downloader と共有します。式が分かれると、取得ツールが
 * 書いた行を次の bulk download が「内容が変わった」と誤って判定します。
 */

import { createHash } from 'node:crypto';

import type DatabaseT from 'better-sqlite3';

import type { NtaDocument } from '../types/document.js';
import { normalizeJpText } from './text-normalize.js';

/**
 * `document` の `content_hash`（SHA-1）を計算する。
 *
 * 5 つの bulk-downloader（改正通達・事務運営指針・文書回答事例・質疑応答事例・
 * タックスアンサー）と、取得ツールの書き戻しで共通に使う。式が分かれると、片方が書いた行を
 * もう片方が「内容が変わった」と誤って数える。
 *
 * 対象は doc_type / doc_id / title / full_text の 4 つで、`structured_json` は含めない
 * （構造だけが変わることは無く、含めると v6 移行直後に全件が「更新」と判定される）。
 * 題名は正規化を通してから混ぜる（呼び出し側が正規化済みの題名を渡しても結果は変わらない）。
 */
export function computeDocumentHash(doc: NtaDocument): string {
  const h = createHash('sha1');
  h.update(doc.docType);
  h.update('\n');
  h.update(doc.docId);
  h.update('\n');
  h.update(normalizeJpText(doc.title));
  h.update('\n');
  h.update(doc.fullText);
  return h.digest('hex');
}

/**
 * 取得した 1 件を `document` に入れる（既にあれば入れ替える）。
 *
 * `last_modified` / `etag` は取得時のヘッダーがあれば渡す。渡さなければ既存の値を消さずに
 * 残すのではなく NULL で上書きするので、呼び出し側は取得した値をそのまま渡してください。
 *
 * best effort で使う想定です。失敗しても応答は返せるので、呼び出し側で握りつぶして構いません。
 */
export function writeBackLiveDocument(
  db: DatabaseT.Database,
  doc: NtaDocument,
  meta: { lastModified?: string | null; etag?: string | null } = {}
): void {
  db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, issued_at, issuer, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, last_modified, etag, structured_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(doc_type, doc_id) DO UPDATE SET
       taxonomy=excluded.taxonomy,
       title=excluded.title,
       issued_at=excluded.issued_at,
       issuer=excluded.issuer,
       source_url=excluded.source_url,
       fetched_at=excluded.fetched_at,
       full_text=excluded.full_text,
       attached_pdfs_json=excluded.attached_pdfs_json,
       content_hash=excluded.content_hash,
       last_modified=excluded.last_modified,
       etag=excluded.etag,
       structured_json=excluded.structured_json`
  ).run(
    doc.docType,
    doc.docId,
    doc.taxonomy ?? null,
    doc.title,
    doc.issuedAt ?? null,
    doc.issuer ?? null,
    doc.sourceUrl,
    doc.fetchedAt,
    doc.fullText,
    JSON.stringify(doc.attachedPdfs),
    computeDocumentHash(doc),
    meta.lastModified ?? null,
    meta.etag ?? null,
    doc.structured ? JSON.stringify(doc.structured) : null
  );
}

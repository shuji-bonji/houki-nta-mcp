/**
 * 国税庁サイトへの要求の失敗を、tools/call のエラーの code・retryable・next_actions・hint に振り分ける
 * （v0.24.0、SPEC-NTA-COMMON-ERRORS-018・019、houki-nta-mcp #120）。
 *
 * houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-027・028 と同じ 4 つの code に分ける。
 * ページが無い（404・410・404 ページへの転送）を `DOC_NOT_FOUND` にするか次の候補へ進むかは、呼び出し側が先に決める。
 * ここに 404・410 が来たときは、URL がこのサーバーの決めた値（通達の目次・タックスアンサーの索引）なので、
 * 番号の誤りではなく 4xx の行（`SOURCE_API_ERROR`・`retryable: false`）として扱う。
 */

import { FETCH_CONFIG } from '../config.js';
import { type LawServiceError, makeError, NEXT_ACTIONS } from '../errors.js';
import { NtaFetchError } from '../services/nta-scraper.js';

/** 例外の連なり（NtaFetchError の cause）を辿り、いちばん内側の例外の文を返す */
function innermostMessage(err: NtaFetchError): string {
  let cur: unknown = err;
  while (cur instanceof NtaFetchError && cur.cause !== undefined) cur = cur.cause;
  if (cur instanceof Error) return cur.message;
  return typeof cur === 'string' ? cur : err.message;
}

/**
 * @param err `fetchNtaPage` が投げた例外
 * @param url 取りに行った URL（`url` と `detail.url` に入れる）
 * @param tool 呼んだツールの名前
 * @param options.missingPageHint 404・410 が来たときの hint（無ければ 4xx の hint）
 */
export function sourceFetchError(
  err: NtaFetchError,
  url: string,
  tool: string,
  options: { missingPageHint?: string } = {}
): LawServiceError {
  const error = `国税庁サイトからの取得に失敗: ${err.message}`;
  const retry = [NEXT_ACTIONS.retryLater()];

  if (err.kind === 'timeout') {
    const seconds = Math.round(FETCH_CONFIG.timeoutMs / 1000);
    return makeError('SOURCE_TIMEOUT', error, {
      url,
      tool,
      retryable: true,
      next_actions: retry,
      hint: `国税庁サイトが ${seconds} 秒以内に応答しませんでした。時間をおいて呼び直してください`,
      detail: { url },
    });
  }

  if (err.kind === 'unreachable') {
    const cause = err.causeCode ?? 'unknown';
    return makeError('SOURCE_UNAVAILABLE', error, {
      url,
      tool,
      retryable: true,
      next_actions: retry,
      hint: `国税庁サイトに接続できませんでした（${cause}）。ネットワークか DNS の設定を確かめてから呼び直してください`,
      detail: { cause, url },
    });
  }

  if (err.kind === 'http' && err.status !== undefined) {
    const status = err.status;
    if (status === 429) {
      return makeError('SOURCE_RATE_LIMITED', error, {
        url,
        tool,
        retryable: true,
        next_actions: retry,
        hint: '国税庁サイトが要求の回数を制限しています（HTTP 429）。間隔をあけて呼び直してください',
        detail: { status, url },
      });
    }
    if (status >= 500) {
      return makeError('SOURCE_API_ERROR', error, {
        url,
        tool,
        retryable: true,
        next_actions: retry,
        hint: `国税庁サイトが一時的に応答できない状態です（HTTP ${status}）。時間をおいて呼び直してください`,
        detail: { status, url },
      });
    }
    // 404・410・429 以外の 4xx（403・400 など）と、このサーバーが決めた URL の 404・410。
    // 取り直しても結果が変わりにくいので retryable: false で、retry_later は付けない
    const hint =
      (status === 404 || status === 410) && options.missingPageHint
        ? options.missingPageHint
        : `国税庁サイトがこの要求を受け付けませんでした（HTTP ${status}）。時間をおいても変わらない見込みです。続くときは報告してください`;
    return makeError('SOURCE_API_ERROR', error, {
      url,
      tool,
      retryable: false,
      hint,
      detail: { status, url },
    });
  }

  // そのほかのネットワークの失敗（例外の cause.code が SPEC-NTA-COMMON-ERRORS-019 の表に無いもの）
  return makeError('SOURCE_API_ERROR', error, {
    url,
    tool,
    retryable: true,
    next_actions: retry,
    hint: '国税庁サイトとの通信に失敗しました。時間をおいて呼び直してください',
    detail: { cause: innermostMessage(err), url },
  });
}

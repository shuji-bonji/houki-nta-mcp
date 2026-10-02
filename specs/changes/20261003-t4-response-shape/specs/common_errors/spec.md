# 差分: common_errors（20261003-t4-response-shape）

`specs/current/common_errors/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える

## MODIFIED

### SPEC-NTA-COMMON-ERRORS-017 DB の取得時点を解釈できないときは `INTERNAL_ERROR`（`retryable: false`）にし、その種別の投入をやり直す案内を付ける

`freshness` を付けるツール（文書系の検索 5 ツールと `nta_search_tsutatsu`）が、`document.fetched_at` または `section.fetched_at` の値を日付（`YYYY-MM-DD`）または時差付きの時刻（`YYYY-MM-DDTHH:MM:SS.sssZ` / `+09:00`）として解釈できないとき（空文字、`2026/05/08` のような別の書き方、`2026-02-30` のような暦に無い日付）は、想定外の例外として止まらず、エラー `INTERNAL_ERROR` を返す。

- `retryable`: `false`（時間をおいても DB の値は変わらない）
- `error`: `取得時点を読めません: <fetched_at の値>`
- `hint`: その種別の投入フラグ（`--bulk-download-qa` など。基本通達は `--bulk-download-all`）で取り込みをやり直す案内
- `next_actions`: `{ action: "cli_bulk_download", example: { command: "houki-nta-mcp <フラグ>" } }` の 1 件
- `detail.cause`: 元の例外の文（houki-abbreviations の `computeDaysSince` が投げる `RangeError` の文）
- `tool`: 呼んだツールの名前

取得 6 ツール（`nta_get_*`）は `freshness` を付けず、取得時点から経過日数を計算しないので、このエラーを返さない。取得ツールの `fetchedAt` は DB の値をそのまま返す。

取り込みが書く `fetched_at` は `new Date().toISOString()` の形（`2026-10-01T00:30:00.000Z`）なので、取り込みを通した DB ではこのエラーは起きない。houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-031 と同じ形である。

例: `document.fetched_at` を `2026/05/08` に書き換えた質疑応答事例だけがある DB で `nta_search_qa` に `{ keyword: "軽減税率" }` を渡すと、`code: "INTERNAL_ERROR"`、`retryable: false`、`error` に `2026/05/08` を含み、`hint` に `--bulk-download-qa` を含み、`results` は返さない（v0.22.0 の本文は対象に「取得 6 ツール」を含めていたが、0.22.0 の実装と受入テストは検索 6 ツールだけだった。houki-nta-mcp #71 の 2026-10-02 のコメント）。

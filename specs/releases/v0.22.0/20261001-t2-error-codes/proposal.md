# 変更: 「見つからない」と「取得元の失敗」の code を分ける（T2）

- 対象: `specs/current/common_errors/spec.md` と、`nta_get_qa` / `nta_get_tax_answer` / `nta_get_kaisei_tsutatsu` / `nta_get_jimu_unei` の `specs/current/<tool>/spec.md`（`nta_get_bunshokaitou` と `resolve_abbreviation` は「未決」を消すだけで、差分のファイルは無い）
- 実装の変更: 要（`nta_get_bunshokaitou` と `resolve_abbreviation` は「未決」を閉じるだけで、動きは変えない）
- 承認日: 2026-10-01（PR #118）
- 状態: 提案中
- 起こした日: 2026-10-01（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #64（取得系と `resolve_abbreviation` の「見つからない」の code）、#65（存在しない番号で `SOURCE_API_ERROR`）、houki-abbreviations 0.7.0 からの申し送り（`computeDaysSince` / `judgeStaleness` の例外）
- 決定の出典: houki-hub `docs/DECISIONS.md` 2026-09-29「T2 code」「T2 の互換の扱い」「houki-nta-mcp #64・#65 の code は置き換える」、2026-10-01「段階 3 の申し送り 2 件の置き場」、`docs/notes/2026-09-29-plan-spec-issues.md` 4 章「段階 4」・7 章・8 章、段階 1 で各 Issue に投稿したコメント（`docs/notes/issues-2026-09-29-decisions/nta-64.md` / `nta-65.md`）、houki-egov-mcp の同じ差分 `spec/20261001-t2-error-codes`（code の規則の文と、同期の記録の日付の扱いを同じにした）
- 前提: 差分 `20261001-t1-argument-guards`（承認 2026-10-01、PR #117）の上に積む。T1 の `common_errors` の ID は 010〜015 まで使っているので、この差分は 016 から振る。同じ版（0.22.0）に入れる T3（`spec/20261001-t3-normalize`）は、この差分のマージ後にその上へ積む

## なぜ変えるか

v0.21.3 では、`nta_get_qa` と `nta_get_tax_answer` が国税庁サイトから取るときに、存在しない `topic` / `category` / `id` の組や存在しない `no` で国税庁サイトが 404（または `/error/404.htm` への転送）を返すと、`SOURCE_API_ERROR`・`retryable: true`・`next_actions: [retry_later]` を返す（#65）。番号の書き間違いなのに、LLM は「時間をおいて取り直す」案内を受ける。文書系 3 ツールは、同じ「DB にその docId が無い」場面で `nta_get_bunshokaitou` が `DOC_NOT_FOUND`、`nta_get_jimu_unei` と `nta_get_kaisei_tsutatsu` が `TSUTATSU_NOT_FOUND` を返し、code が種別で違う（#64）。houki-abbreviations 0.7.0 の `computeDaysSince` は解釈できない日付に `RangeError` を投げるようになり、`document.fetched_at` / `section.fetched_at` が日付として解釈できない値のとき、`freshness` を付けるツールが想定外の例外で止まる。

2026-09-29 の決定（T2）は、`SOURCE_*` は取得元との通信が失敗したときだけ、`*_NOT_FOUND` は問い合わせが成功して 0 件（取得元の 404 を含む）のときだけにする、文書系 3 ツールは `DOC_NOT_FOUND` に揃える、というものである。

## 変わる振る舞い

| 場面                                                                                                    | v0.21.3                                                                        | この差分                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `nta_get_qa` / `nta_get_tax_answer` で、国税庁サイトが 404・410 を返した、または 404 ページに転送した   | `SOURCE_API_ERROR`、`retryable: true`、`next_actions: [retry_later]`           | `DOC_NOT_FOUND`、`retryable: false`、`next_actions` にその種別の検索ツール（`nta_search_qa` / `nta_search_tax_answer`）               |
| `nta_get_jimu_unei` / `nta_get_kaisei_tsutatsu` で、DB にその種別が 1 件も無い、またはその docId が無い | `TSUTATSU_NOT_FOUND`                                                           | `DOC_NOT_FOUND`（本文・`hint`・`available_doc_ids`・`next_actions` は変えない）                                                       |
| `freshness` を付けるツールで、DB の `fetched_at` が日付・時刻として解釈できない                         | 想定外の例外（`INTERNAL_ERROR`、`retryable: true`、`detail.cause` に例外の文） | `INTERNAL_ERROR`、`retryable: false`、`error` にその値、`hint` と `next_actions`（`cli_bulk_download`）でその種別の投入をやり直す案内 |

## 変わらない振る舞い

- `nta_get_bunshokaitou` の code（`DOC_NOT_FOUND`）と、3 ツールの「DB に 1 件も無い」と「その docId が無い」の見分け方（`error` の文・`available_doc_ids`・`next_actions`。SPEC-NTA-GET-BUNSHOKAITOU-002・003 など）。code では分けない（#64 の 2 つ目の「決めること」への答え）
- `nta_get_tsutatsu` と `nta_search_tsutatsu` の `TSUTATSU_NOT_FOUND`（基本通達が DB に無く国税庁サイトから取る先も無い場面）と、`nta_get_tsutatsu` の `ABBREVIATION_NOT_FOUND`（SPEC-NTA-GET-TSUTATSU-001）
- `nta_get_tsutatsu` の 404 の扱い（SPEC-NTA-GET-TSUTATSU-009・010。候補ページの 404 は再試行できるエラーにせず `ARTICLE_NOT_FOUND`）。v0.21.3 の時点で T2 の規則に合っている
- `resolve_abbreviation` の「辞書に無い」が `resolved: null` の正常応答であること（SPEC-NTA-RESOLVE-ABBREVIATION-004）。houki-egov-mcp の `resolve_abbreviation` も `resolved: null` を返し、egov の T1（#57）で「`ABBREVIATION_NOT_FOUND` は返さない」を確かめたので、egov と nta で同じ形のまま（#64 の 3 つ目の「決めること」への答え）
- 国税庁サイトとの通信の失敗（接続できない・時間切れ・5xx・429）の code。nta は `SOURCE_API_ERROR` 1 つのままで、`SOURCE_TIMEOUT` / `SOURCE_UNAVAILABLE` には分けない（下の「人が判断すること」2）
- `INTERNAL_ERROR` の `retryable`（SPEC-NTA-COMMON-ERRORS-006 の `true`）。#70 の T5 で扱う。この差分で足す同期の記録の場面は、時間をおいても変わらないので `false` と書く

## Issue の「決めること」への答え

### #64

| 決めること                                                      | 答え                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 文書系 3 ツールの `code` を揃えるか                             | 揃える。`DOC_NOT_FOUND`（SPEC-NTA-GET-JIMU-UNEI-001・002、SPEC-NTA-GET-KAISEI-TSUTATSU-001・002 を MODIFIED）。code の表の `TSUTATSU_NOT_FOUND` から「改正通達・事務運営指針を含む」を外す |
| 「DB に 1 件も無い」と「その番号が無い」を `code` で分けるか    | 分けない。どちらも DB を引いて 0 件なので `DOC_NOT_FOUND`（SPEC-NTA-COMMON-ERRORS-016）                                                                                                    |
| `resolve_abbreviation` の「辞書に無い」を正常応答のままにするか | 正常応答のまま（SPEC-NTA-RESOLVE-ABBREVIATION-004 は変えない。「未決」1 を消す）                                                                                                           |
| `explainDocIdNotFound()` の JSDoc「v0.14.0 から変えない」       | 実装 PR で書き換える（2026-09-29 の決定）                                                                                                                                                  |

### #65

| 決めること                                                  | 答え                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 404（と 410）を番号の誤りとして再試行できないエラーにするか | する。404・410・国税庁サイトの 404 ページへの転送（soft-404）を `DOC_NOT_FOUND`・`retryable: false` にする（SPEC-NTA-GET-QA-014、SPEC-NTA-GET-TAX-ANSWER-013）。それ以外の通信の失敗は `SOURCE_API_ERROR`（015・014）         |
| そのときの `next_actions`                                   | `nta_get_qa` は `nta_search_qa`（`example` は `{ topic: <渡した topic>, keyword: "<探したい語>" }`）、`nta_get_tax_answer` は `nta_search_tax_answer`（`example` は `{ keyword: "<探したい語>" }`）。`retry_later` は入れない |

### houki-abbreviations 0.7.0 の申し送り（`computeDaysSince` / `judgeStaleness` の例外）

| 決めること                | 答え                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 例外を捕まえたときの code | `INTERNAL_ERROR`、`retryable: false`（SPEC-NTA-COMMON-ERRORS-017）。`hint` と `next_actions`（`cli_bulk_download`）でその種別の投入フラグを案内する。houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-031 と同じ形 |

## 足す仕様 ID（ADDED、6 件）

| 単位               | 仕様 ID                     | 内容                                                                                                              |
| ------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| common_errors      | SPEC-NTA-COMMON-ERRORS-016  | `SOURCE_API_ERROR` は通信の失敗だけ、`*_NOT_FOUND` は問い合わせが成功して求めたものが無いときだけ（規則と対応表） |
| common_errors      | SPEC-NTA-COMMON-ERRORS-017  | DB の `fetched_at` を解釈できないときは `INTERNAL_ERROR`（`retryable: false`）                                    |
| nta_get_qa         | SPEC-NTA-GET-QA-014         | 国税庁サイトの 404・410・404 ページへの転送は `DOC_NOT_FOUND`                                                     |
| nta_get_qa         | SPEC-NTA-GET-QA-015         | 国税庁サイトとの通信の失敗は `SOURCE_API_ERROR`（014 との境界）                                                   |
| nta_get_tax_answer | SPEC-NTA-GET-TAX-ANSWER-013 | 国税庁サイトの 404・410・404 ページへの転送は `DOC_NOT_FOUND`                                                     |
| nta_get_tax_answer | SPEC-NTA-GET-TAX-ANSWER-014 | 国税庁サイトとの通信の失敗は `SOURCE_API_ERROR`（013 との境界）                                                   |

## 変える仕様 ID（MODIFIED、4 件）

| 単位                    | 仕様 ID                          | 変わる点                       |
| ----------------------- | -------------------------------- | ------------------------------ |
| nta_get_jimu_unei       | SPEC-NTA-GET-JIMU-UNEI-001       | code を `DOC_NOT_FOUND` にする |
| nta_get_jimu_unei       | SPEC-NTA-GET-JIMU-UNEI-002       | 同上                           |
| nta_get_kaisei_tsutatsu | SPEC-NTA-GET-KAISEI-TSUTATSU-001 | 同上                           |
| nta_get_kaisei_tsutatsu | SPEC-NTA-GET-KAISEI-TSUTATSU-002 | 同上                           |

仕様 ID の無い本文の変更: `common_errors` の「エラーの code」の表（`TSUTATSU_NOT_FOUND`・`DOC_NOT_FOUND`・`SOURCE_API_ERROR` の説明）。REMOVED は無い。

## 互換性（T2 の互換の扱い）

code が変わる場面は次の 2 つで、実装 PR の CHANGELOG に「互換性」の節で書き、同じ日に houki-research-skill の `docs/ERROR-CODES.md`（`TSUTATSU_NOT_FOUND` の説明から改正通達・事務運営指針を外す）を直す。旧 code を並行して返す期間は設けない。

| 場面                                                                              | 旧 code              | 新 code         |
| --------------------------------------------------------------------------------- | -------------------- | --------------- |
| `nta_get_jimu_unei` / `nta_get_kaisei_tsutatsu` で文書が DB に無い                | `TSUTATSU_NOT_FOUND` | `DOC_NOT_FOUND` |
| `nta_get_qa` / `nta_get_tax_answer` で国税庁サイトが 404・410・404 ページへの転送 | `SOURCE_API_ERROR`   | `DOC_NOT_FOUND` |

## 呼び出し例への影響

2026-10-01 JST に houki-hub `scripts/reference-examples/houki-nta/ja/*.md` と houki-research-skill の `skills/houki-research/` を grep した。

- houki-hub `scripts/reference-examples/houki-nta/ja/nta_get_kaisei_tsutatsu.md` の応答の例に `"code": "TSUTATSU_NOT_FOUND"` がある。段階 6 で `DOC_NOT_FOUND` に直す（実測をやり直す）
- houki-research-skill `examples/error-recovery-patterns.md` の「シナリオ 2 — `TSUTATSU_NOT_FOUND`（docId の typo を検索で救う）」は `nta_get_kaisei_tsutatsu` か `nta_get_jimu_unei` の例なら `DOC_NOT_FOUND` に直す。`SKILL.md` の表と `docs/ERROR-HANDLING.md` は `DOC_NOT_FOUND` / `TSUTATSU_NOT_FOUND` を並べて書いているので、文は変えない
- `docs/ERROR-CODES.md` の `TSUTATSU_NOT_FOUND` の行（「改正通達・事務運営指針を含む」）は実装 PR と同じ日に直す

## 取り込みのとき（Publisher）

- ADDED の見出しを、各 `specs/current/<dir>/spec.md` の「できること」の末尾に足す。MODIFIED は同じ見出しの本文を置き換える
- `common_errors` の「エラーの code」の表を、差分の `common_errors/spec.md` の冒頭の箇条書きのとおりに書き換える
- `nta_get_qa` / `nta_get_tax_answer` の「処理の流れ」の図に、404 の分岐（014 / 013）を足す
- 「未決」から次の項目を消す: nta_get_bunshokaitou 6、nta_get_jimu_unei 1、nta_get_kaisei_tsutatsu 7、nta_get_qa 1、nta_get_tax_answer 1、resolve_abbreviation 1
- 各 `specs/current/<dir>/spec.md` の承認日の行に「差分 `20261001-t2-error-codes` は YYYY-MM-DD（PR #N）」を足す
- この差分のフォルダーを `specs/releases/<実装を出したタグ>/20261001-t2-error-codes/` へ移し、この proposal.md の「状態」を取り込み済みにする

## 人が判断すること

1. **410 と soft-404 を 404 と同じにするか（014・013）。** 同じにした。国税庁サイトは存在しない URL を `/error/404.htm` に転送するので（v0.21.3 の時点で 404 相当として扱っている）、転送も含めないと #65 の場面の大半が残る。
2. **通信の失敗の code を egov と同じく 4 つに分けるか。** 分けなかった。nta の code の表は `SOURCE_TIMEOUT` / `SOURCE_RATE_LIMITED` を「どのツールも返さない」と書いており、#64・#65 のどちらにも無い話なので、この差分では `SOURCE_API_ERROR` 1 つのまま。分けるなら egov の SPEC-EGOV-COMMON-ERRORS-027・028 と同じ表を `common_errors` に足す別の差分にする。
3. **`nta_search_qa` の `next_actions` の `example`。** `keyword` は必須で空文字は T1 で `INVALID_ARGUMENT` になるので、そのまま渡せる値ではなく `"<探したい語>"` という置き換えの印を書いた。`example` を付けない（`action` と `reason` だけ）ほうがよければ 014・013 から `example` を消す。
4. **`fetched_at` を解釈できないときに検索や取得を失敗させるか（017）。** `INTERNAL_ERROR` で止める側で書いた（egov の 031 と同じ）。結果だけ返して `freshness` を省く案は、T4 の「値が無いフィールドは `null`」と衝突するので入れていない。
5. **承認日。** この proposal.md に承認日と PR 番号を書く。

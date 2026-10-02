# 変更: hint・next_actions・説明文・CLI の使い方と実際の動きの食い違いを、行ごとに直す（T5 文書と実装の食い違い）

- 対象: `specs/current/common_errors/spec.md`・`resolve_abbreviation/spec.md`・`nta_search_tsutatsu/spec.md`・`nta_search_tax_answer/spec.md`（動きを変える行）と、tool description・`hint` の文・CLI の使い方・README（文書だけを直す行。仕様 ID なし）
- 実装の変更: 要（`UNKNOWN_TOOL` / `INTERNAL_ERROR` の `retryable` と文、`resolve_abbreviation` の `hint` と `next_actions`、`nta_search_tsutatsu` の空の DB の案内、`nta_search_tax_answer` の `next_actions`。文書だけの行は「実装 PR で直す文書」）
- 承認日: 2026-10-02（PR #126）
- 状態: 提案中
- 起こした日: 2026-10-03（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #70（hint・next_actions・説明文の案内が実際の動きと合わない）、#108（CLI の使い方の `--refresh` の説明・環境変数の欄・`--refresh-stale` の「N 日以上」が実際の動きと合わない）
- 決定の出典: houki-hub `docs/DECISIONS.md` 2026-09-29「T5 文書と実装の食い違い」、`docs/notes/2026-09-29-plan-spec-issues.md` 4 章「段階 1」「段階 4」、段階 1 で #70 に投稿したコメント（2026-09-29）、差分 `20261001-t2-error-codes`（v0.22.0）の proposal.md の「`INTERNAL_ERROR` の `retryable` は #70 の T5 で扱う」、houki-egov-mcp の同じ差分 `spec/20261003-t5-docs-mismatch`（`UNKNOWN_TOOL` と `INTERNAL_ERROR` の文を同じにした）
- 前提: 差分 `20261003-t4-response-shape`（`spec/20261003-t4-response-shape`）の上に積む。マージも T4 → T5 の順。T4 と同じ仕様 ID はこの差分に置かない（`common_errors` は T4 が 017、この差分が 002・006・009。`nta_search_tsutatsu` は T4 が 005・010、この差分が 003 で、重ならない）

## なぜ変えるか

#70 は、エラーの `hint`・`next_actions`・ツールの説明文が実際の動きや他のツールと合っていない 7 行の Issue、#108 は、`houki-nta-mcp --help` の使い方の 3 行が実際の動きと合わない Issue である。2026-09-29 の決定（T5）は、行ごとに振り分けて、動きを変える必要が無い行は文書を直し（仕様 PR に入れず、実装 PR で直す）、動きを変える行だけ仕様 PR に入れる、というものである。

あわせて、v0.22.0 の T2 の差分で「#70 の T5 で扱う」とした `INTERNAL_ERROR` の `retryable`（SPEC-NTA-COMMON-ERRORS-006 は `true`、ページの解析の失敗は `retryable` 無し。common_errors の未決 7）と、`UNKNOWN_TOOL` の英語の `error`（common_errors の未決 5）を、houki-egov-mcp #56 の決定と同じ形に揃える（下の「人が判断すること」1）。

## 行ごとの振り分け（2026-10-03 JST の main `3b2a0f9` で確かめた）

### #70

| #   | Issue の行                                                                                                                | 0.22.0 の状態                                                                                                                                                             | 振り分け                                                                                                                                     | 置き場所                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | `nta_get_tax_answer` の未対応の番号帯のエラーに「v0.2.x では未対応」「Phase 2 で対応予定」                                | 変わっていない（`src/tools/handlers.ts`）                                                                                                                                 | 文書を直す。SPEC-NTA-GET-TAX-ANSWER-002 の文（「未対応」の旨と対応している番号帯の一覧、`8xxx` 帯が未対応である旨）のままで合う              | 実装 PR で直す文書 1                              |
| 2   | `nta_search_tsutatsu` の `TSUTATSU_NOT_FOUND` が `--bulk-download`、説明文と `freshness.warning` が `--bulk-download-all` | 変わっていない                                                                                                                                                            | 動きを変える（案内するフラグを `--bulk-download-all` に揃える。SPEC-NTA-SEARCH-TSUTATSU-003 が `--bulk-download` と書いているので MODIFIED） | SPEC-NTA-SEARCH-TSUTATSU-003（MODIFIED）          |
| 3   | `resolve_abbreviation` の `hint` がまだ無い MCP 名を組み立てる。`next_actions` が無い                                     | 変わっていない                                                                                                                                                            | 動きを変える（`hint` の文と `next_actions` を足す。どちらも SPEC-NTA-RESOLVE-ABBREVIATION-003 の本文に関わる）                               | SPEC-NTA-RESOLVE-ABBREVIATION-003（MODIFIED）     |
| 4   | `resolve_abbreviation` の tools/list の `abbr` の例が `電帳法`                                                            | 変わっていない（`"消基通", "所基通", "電帳法"`）                                                                                                                          | 文書を直す                                                                                                                                   | 実装 PR で直す文書 2                              |
| 5   | `nta_search_tax_answer` が `nta_get_tax_answer` を案内しない                                                              | 変わっていない                                                                                                                                                            | 動きを変える（`next_actions` を足す）                                                                                                        | SPEC-NTA-SEARCH-TAX-ANSWER-006（ADDED）           |
| 6   | `nta_search_kaisei_tsutatsu` の SPEC-NTA-SEARCH-KAISEI-TSUTATSU-002 の `hint` の末尾                                      | `specs/current` の 002 は、改正通達には税目を絞る投入のフラグが無いので「で追加できます」の案内を書かず、`…の値を指定してください。` で終わると約束している。実装もその文 | 今の文面を意図とする（002 のとおり。変えない）                                                                                               | なし（Issue の行は片付いている）                  |
| 7   | `nta_get_jimu_unei` の json の `legal_status.note` が事務運営指針を名指ししない                                           | 変わっていない（SPEC-NTA-GET-JIMU-UNEI-005 は「と注」とだけ書き、文を約束していない）                                                                                     | 文書を直す                                                                                                                                   | 実装 PR で直す文書 3                              |
| —   | `nta_get_tax_answer` の `8xxx` 帯に対応する予定があるか                                                                   | —                                                                                                                                                                         | 対応しない。エラーの文に予定を書かない                                                                                                       | 実装 PR で直す文書 1（下の「人が判断すること」3） |

### #108

| #   | Issue の行                                                                | 0.22.0 の状態                                                                                                                                                        | 振り分け                                                                | 置き場所             |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------- |
| 1   | `--refresh` は「既存 DB を消去して再 DL」                                 | 変わっていない                                                                                                                                                       | 文書を直す（DB を消す動きにはしない。全データを消す入口は #107 で扱う） | 実装 PR で直す文書 5 |
| 2   | 「環境変数」の欄に `HOUKI_NTA_BASELINE_DIR`・`HOUKI_NTA_FILES_DIR` が無い | 変わっていない                                                                                                                                                       | 文書を直す                                                              | 実装 PR で直す文書 6 |
| 3   | `--refresh-stale=<日数>` は「N 日以上古い section」                       | 使い方の 2 行と標準エラー出力の `(<日数> 日以上古い section を対象)` が「以上」のまま。`specs/current/cli_refresh/spec.md` の入力の表はすでに「`<日数>` 日より古い」 | 文書を直す（境界は今の `<` のまま）                                     | 実装 PR で直す文書 7 |

### 揃える行（Issue の外、T2 からの持ち越し）

| #   | 行                                      | 0.22.0 の状態                                                           | 振り分け                                                                        | 置き場所                               |
| --- | --------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| A   | 処理中の想定外の例外の `INTERNAL_ERROR` | `retryable: true`、`next_actions: [retry_later]`、`hint` は報告を求める | 動きを変える（houki-egov-mcp と同じく `retryable: false`、`next_actions` 無し） | SPEC-NTA-COMMON-ERRORS-006（MODIFIED） |
| B   | ページの解析の失敗の `INTERNAL_ERROR`   | `retryable` が無い                                                      | 動きを変える（`retryable: false`）                                              | SPEC-NTA-COMMON-ERRORS-009（MODIFIED） |
| C   | `UNKNOWN_TOOL`                          | `error` が英語、`retryable` が無い                                      | 動きを変える（houki-egov-mcp と同じ文）                                         | SPEC-NTA-COMMON-ERRORS-002（MODIFIED） |
| D   | README のエラーの表                     | `INTERNAL_ERROR` の行は `retryable: true`                               | 文書を直す（A に合わせる）                                                      | 実装 PR で直す文書 8                   |

## 変わる振る舞い

| 場面                                                  | v0.22.0                                           | この差分                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 存在しないツール名を呼ぶ                              | `error: "Unknown tool: <name>"`、`retryable` 無し | `error: "存在しないツールです: <name>"`、`retryable: false`（COMMON-ERRORS-002）                                 |
| 処理中の想定外の例外                                  | `retryable: true`、`next_actions: [retry_later]`  | `retryable: false`、`next_actions` 無し（COMMON-ERRORS-006）                                                     |
| 国税庁のページの解析の失敗                            | `retryable` 無し                                  | `retryable: false`（COMMON-ERRORS-009）                                                                          |
| `resolve_abbreviation` で houki-egov の管轄のエントリ | `hint` だけ                                       | `next_actions: [delegate_to_mcp]` を足す（RESOLVE-ABBREVIATION-003）                                             |
| `resolve_abbreviation` で family に無い管轄のエントリ | `hint` に `<管轄>-mcp で取得してください`         | `hint` は「対応する MCP サーバーはまだありません」、`next_actions` 無し（辞書 0.7.0 には該当するエントリが無い） |
| `nta_search_tsutatsu` で DB に条項が 1 件も無い       | `--bulk-download` を案内                          | `--bulk-download-all` を案内（SEARCH-TSUTATSU-003）                                                              |
| `nta_search_tax_answer` がヒットした                  | `next_actions` 無し                               | 先頭の記事の `nta_get_tax_answer` を案内（SEARCH-TAX-ANSWER-006）                                                |

## 変わらない振る舞い

- `INTERNAL_ERROR` の `error`・`hint`・`detail.cause`（SPEC-NTA-COMMON-ERRORS-006・009）、DB の取得時点を読めないときの `INTERNAL_ERROR`（SPEC-NTA-COMMON-ERRORS-017。すでに `retryable: false`）
- `nta_get_tax_answer` が対応する番号帯と、未対応の番号帯で `INVALID_ARGUMENT` を返すこと（SPEC-NTA-GET-TAX-ANSWER-002）
- `nta_search_kaisei_tsutatsu` の SPEC-NTA-SEARCH-KAISEI-TSUTATSU-002 の `hint`
- `resolve_abbreviation` の `in_scope`・`resolved`、houki-egov の管轄のエントリの `hint` の文
- CLI の動き（`--refresh` が消す範囲、`--refresh-stale` の境界 `<`、環境変数の読み方）

## Issue の「決めること」への答え

### #70

| 決めること                                              | 答え                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 各項目を直すか、今の文面を意図とするか                  | 上の「行ごとの振り分け」のとおり。行 6（改正通達の `hint`）だけは今の文面を意図とする |
| `nta_get_tax_answer` の `8xxx` 帯に対応する予定があるか | 対応しない。エラーの文は「対応していない」とだけ書き、版名と予定を書かない            |

### #108

| 決めること                                                                   | 答え                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| `--refresh` の説明を直すか、DB を消す動きにするか                            | 説明を直す（実装 PR で直す文書 5）                    |
| `HOUKI_NTA_BASELINE_DIR`・`HOUKI_NTA_FILES_DIR` を使い方に載せるか           | 載せる（実装 PR で直す文書 6）                        |
| `--refresh-stale` の文言を「N 日より古い」に直すか、境界を「以上」に変えるか | 文言を直す。境界は `<` のまま（実装 PR で直す文書 7） |

## 実装 PR で直す文書

仕様 ID を作らない行（動きを変えない行）。実装の会話は、この一覧を見て直す。公開文書の文は「〜します」「〜です」で書く。

| #   | 場所                                                                                                                                | 今の文                                                                                                                           | 直した後の文（案）                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `src/tools/handlers.ts` の `nta_get_tax_answer` の未対応の番号帯のエラー                                                            | `error`: `番号 "<no>" の先頭桁 "<d>" は houki-nta-mcp v0.2.x では未対応`。`hint` の末尾: `8xxx 帯は未対応（Phase 2 で対応予定）` | `error`: `番号 "<no>" の先頭桁 "<d>" の番号帯には対応していません`。`hint` の末尾: `8xxx 帯と 0xxx 帯には対応していません`                                                     |
| 2   | `src/tools/definitions.ts` の `resolve_abbreviation` の `abbr` の `description`                                                     | `例: "消基通", "所基通", "電帳法"`                                                                                               | `例: "消基通", "所基通", "法基通"`（`電帳法` は法律で houki-egov の管轄なので、このツールの例にしません）                                                                      |
| 3   | `nta_get_jimu_unei` の json の `legal_status.note`                                                                                  | `通達は行政内部文書。…`                                                                                                          | markdown の注と同じく、`通達・事務運営指針は行政内部文書であり、…` で始まる文にします（SPEC-NTA-GET-JIMU-UNEI-006 の注と同じ語）                                               |
| 4   | （今回の確認で見つけた）`src/tools/handlers.ts` の `nta_get_tsutatsu` の `TSUTATSU_NOT_FOUND`（SPEC-NTA-GET-TSUTATSU-007）の `hint` | `…を実行して DB に投入してください（Phase 2d 以降は他通達も bulk DL 経由で対応）。`                                              | 括弧の中を消します（版の段階名を書きません）                                                                                                                                   |
| 5   | `src/cli.ts` の使い方の `--refresh` の行                                                                                            | `既存 DB を消去して再 DL`                                                                                                        | `投入する通達の節と条項を消して取り直します。文書系は取り直した内容で置き換えます（ほかの通達・ほかの種別の行と、索引から消えた文書の行は残ります）`                           |
| 6   | `src/cli.ts` の使い方の「環境変数」の欄                                                                                             | `HOUKI_NTA_DB_PATH`・`XDG_CACHE_HOME` の 2 行                                                                                    | `HOUKI_NTA_BASELINE_DIR  bulk download の記録と --health-check の baseline の置き場所` と `HOUKI_NTA_FILES_DIR  nta_inspect_pdf_meta の save: true の保存先` の 2 行を足します |
| 7   | `src/cli.ts` の使い方の `--refresh-stale` の 2 行と、標準エラー出力の `[refresh-stale] DB: … (<日数> 日以上古い section を対象)`    | `N 日以上古い`                                                                                                                   | `N 日より古い`（ちょうど N 日前の節は含みません）                                                                                                                              |
| 8   | `README.md` のエラーの表（637・639 行目付近）                                                                                       | `UNKNOWN_TOOL` の行に `retryable` が無い。`INTERNAL_ERROR` の行は `retryable: true`                                              | `UNKNOWN_TOOL` の行に `retryable: false`、`INTERNAL_ERROR` の行を `retryable: false`（不具合の報告を求めます）にします                                                         |

## 足す仕様 ID（ADDED、1 件）

| 単位                  | 仕様 ID                        | 内容                                                                       |
| --------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| nta_search_tax_answer | SPEC-NTA-SEARCH-TAX-ANSWER-006 | ヒットしたら先頭の記事の `nta_get_tax_answer` を `next_actions` で案内する |

## 変える仕様 ID（MODIFIED、5 件）

| 単位                 | 仕様 ID                           | 変わる点                                                                    |
| -------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| common_errors        | SPEC-NTA-COMMON-ERRORS-002        | `error` を日本語に、`retryable: false`                                      |
| common_errors        | SPEC-NTA-COMMON-ERRORS-006        | `retryable: false`、`next_actions` を付けない                               |
| common_errors        | SPEC-NTA-COMMON-ERRORS-009        | `retryable: false` を付ける                                                 |
| resolve_abbreviation | SPEC-NTA-RESOLVE-ABBREVIATION-003 | `next_actions`（houki-egov）を足し、family に無い管轄の `hint` の文を変える |
| nta_search_tsutatsu  | SPEC-NTA-SEARCH-TSUTATSU-003      | 案内するフラグを `--bulk-download-all` に                                   |

## 消す仕様 ID（REMOVED）

無い。

## 互換性

code は変えない。

- `INTERNAL_ERROR` の `retryable` が `true` から `false` に、`next_actions` が `[retry_later]` から無しに変わる。ページの解析の失敗の `INTERNAL_ERROR` に `retryable: false` が付く。CHANGELOG の「互換性」の節に書き、houki-research-skill の `docs/ERROR-CODES.md` と `docs/ERROR-HANDLING.md` を 0.23.0 の publish と同じ日に直す（houki-egov-mcp 0.17.0 と同じ PR でよい）
- `UNKNOWN_TOOL` の `error` の文が変わる。`error` の文で分岐している利用側は無い
- `resolve_abbreviation` と `nta_search_tax_answer` には `next_actions` を足すだけ

## 実装の変更

- `src/server.ts` の `UNKNOWN_TOOL` の文と `retryable: false`
- 想定外の例外を `INTERNAL_ERROR` にする箇所で `retryable: false`、`next_actions` を渡さない。ページの解析の失敗の 3 か所に `retryable: false`
- `resolve_abbreviation` の管轄外の分岐で、`houki-egov` なら `NEXT_ACTIONS.delegateTo('houki-egov')`、それ以外は「まだありません」の `hint`
- `nta_search_tsutatsu` の空の DB の `hint` と `NEXT_ACTIONS.bulkDownload()` を `--bulk-download-all` に
- `nta_search_tax_answer` の成功の応答に `next_actions`
- 上の「実装 PR で直す文書」の 8 行

## 取り込みのとき（Publisher）

- ADDED の見出しを `specs/current/nta_search_tax_answer/spec.md` の「できること」の末尾に足す。MODIFIED は見出しの行（題）も含めて、差分の見出しと本文に置き換える
- `common_errors` の「エラーの code」の表の `INTERNAL_ERROR` の行の説明に「再試行しても結果は変わらない（`retryable: false`）」を足す
- 「未決」を次のように直す
  - common_errors 5 → 「→ SPEC-NTA-COMMON-ERRORS-002」、6 → 「→ SPEC-NTA-COMMON-ERRORS-006」、7 → 「→ SPEC-NTA-COMMON-ERRORS-006・SPEC-NTA-COMMON-ERRORS-009」に書き換える
  - nta_get_tax_answer 4、resolve_abbreviation 5、nta_search_kaisei_tsutatsu 9、nta_get_jimu_unei 6、cli_entry 5、cli_refresh 2・6 → 行を消す（番号は振り直さない）
  - nta_search_tsutatsu 8 → 「→ SPEC-NTA-SEARCH-TSUTATSU-003」、resolve_abbreviation 4 → 「→ SPEC-NTA-RESOLVE-ABBREVIATION-003」、nta_search_tax_answer 8 → 「→ SPEC-NTA-SEARCH-TAX-ANSWER-006」に書き換える
  - cli_refresh 5 の `(<日数> 日以上古い section を対象)` を `(<日数> 日より古い section を対象)` に直す（実装 PR で直す文書 7 に合わせる）
- 各 `specs/current/<dir>/spec.md` の承認日の行に「差分 `20261003-t5-docs-mismatch` は YYYY-MM-DD（PR #N）」を足す
- この差分のフォルダーを `specs/releases/<実装を出したタグ>/20261003-t5-docs-mismatch/` へ移し、この proposal.md の「状態」を取り込み済みにする

## 人が判断すること

1. **Issue の外の `INTERNAL_ERROR` と `UNKNOWN_TOOL` を、この差分で houki-egov-mcp に揃えること（002・006・009）。** 2026-09-29 の決定が `retryable: false` と名指ししたのは houki-egov-mcp #56 だけだが、v0.22.0 の T2 の proposal.md が「#70 の T5 で扱う」と書いており、同じ code の `retryable` が MCP によって違うと Skill の分岐が 2 通りになるので入れた。入れないなら 3 つの ID を MODIFIED から外し、実装 PR で直す文書 8 を消す。
2. **`resolve_abbreviation` の `next_actions` の形（003）。** `nta_get_tsutatsu` の `OUT_OF_SCOPE` と同じ `delegate_to_mcp` にした。family に無い管轄では付けない。
3. **`8xxx` 帯に対応しないこと。** 国税庁のタックスアンサーに `8xxx` 帯の記事があるかは、この会話では確かめていない（bulk download の索引の件数で確かめられる）。記事があるなら、対応するかを別の Issue にする。
4. **改正通達の `hint`（#70 の行 6）を今のままにすること。** SPEC-NTA-SEARCH-KAISEI-TSUTATSU-002 がすでに今の文を約束しているので、Issue の行は片付いていると扱う。#70 にコメントして行を閉じる候補。
5. **空の DB の案内を `--bulk-download-all` にすること（SEARCH-TSUTATSU-003）。** 4 通達を順に投入するので、1 通達だけの `--bulk-download` より時間がかかる。先に 1 つだけ入れたい利用者向けに、`hint` で `--bulk-download --tsutatsu=<正式名>` も併記した。
6. **承認日。** この proposal.md に承認日と PR 番号を書く。

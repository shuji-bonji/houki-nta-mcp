# 変更: 引数の検査と、国税庁のページの解析の失敗のエラーに仕様 ID を振る

- 対象: `specs/current/common_errors/spec.md`（「できること」への追加）。ツールの spec.md には ID を足さない
- 実装の変更: 要（受入テストを足す。`src/` は変えない）
- 承認日:
- 状態: 草案。承認後、実装 PR（Test Designer が受入テストを足す）の最終コミットで `specs/current/` に取り込み、`specs/releases/<tag>/` へ移す
- 起こした日: 2026-09-27（JST）
- 起こした役: Spec Steward
- 関連: houki-nta-mcp #50（初版起こし）、#74（判断が要る未決を Issue に移した仕様 PR）、#77（common_errors の初版）、houki-hub `docs/notes/issues-2026-09-26-nta-undecided/README.md`（A の一覧）

## なぜ変えるか

引数が inputSchema に合わないときの `INVALID_ARGUMENT` と、国税庁のページを解析できなかったときの `INTERNAL_ERROR` は、どちらも複数のツールで同じ処理を通る。初版起こしでは、ツールごとの spec.md の「未決」に「このツールでのテストが無い」として残った。#77 で `common_errors` に共通の規則（SPEC-NTA-COMMON-ERRORS-003・004・006）を置いたので、共通の規則で受けられるものはその ID でテストし、まだ ID の無い共通の振る舞いは `common_errors` に足す。

## 変わる振る舞い

無い。v0.21.0 の振る舞いを仕様 ID 付きで書き起こすだけ。007・008 の例は、v0.21.0 のソースから作った手元のビルドで tools/call の受け口を呼んで確かめた。009 はソースを読んで確かめた（国税庁のページの差し替えが要るため、手元では呼んでいない）。

## 足す仕様 ID（ADDED、3 件、すべて common_errors）

| 仕様 ID | 内容 | 元の未決 |
|---|---|---|
| SPEC-NTA-COMMON-ERRORS-007 | inputSchema の検査で返す `INVALID_ARGUMENT` の `error`・`hint`・`next_actions` | common_errors 1、nta_search_jimu_unei 8・nta_search_kaisei_tsutatsu 8 の `hint`・`next_actions` の部分 |
| SPEC-NTA-COMMON-ERRORS-008 | inputSchema に合わない引数では、ツールの処理に進まない | common_errors 2、nta_search_jimu_unei 8 の「DB は引かない」の部分 |
| SPEC-NTA-COMMON-ERRORS-009 | 国税庁のページの解析に失敗したときの `INTERNAL_ERROR` | nta_get_tsutatsu 2、nta_get_qa 3、nta_get_tax_answer 5 |

## 既存の仕様 ID で受ける項目（ID は足さず、ツールの応答としてのテストを足す）

| ツール | 未決の番号 | 受ける仕様 ID | テストで渡す引数の例 |
|---|---|---|---|
| nta_get_jimu_unei | 5 | SPEC-NTA-COMMON-ERRORS-003・004 | `{}`（`docId` が無い）、`{ docId: "x", foo: 1 }` |
| nta_get_kaisei_tsutatsu | 7 | SPEC-NTA-COMMON-ERRORS-003 | `{}`、`{ docId: 1 }` |
| nta_inspect_pdf_meta | 8 | SPEC-NTA-COMMON-ERRORS-003・004 | `docType: "qa-jirei"`、`kind: "zzz"`、`save: "yes"`、未知の引数。違反は 1 つずつ渡す |
| nta_search_jimu_unei | 8 | SPEC-NTA-COMMON-ERRORS-003・004・007・008 | `{}`、`{ keyword: 1 }`、`{ keyword: "x", foo: 1 }` |
| nta_search_kaisei_tsutatsu | 8 | SPEC-NTA-COMMON-ERRORS-003・004・007 | `{}`、`{ keyword: 1 }`、`{ keyword: "x", foo: 1 }` |

1 回の呼び出しに違反を 2 つ以上入れた場合の `detail.issues` は、この差分では約束しない（→ houki-nta-mcp #79。手元で呼ぶと、違反が 1 件にまとまり、片方の引数名が `message` の中に残るか、落ちる）。

## 取り込みのときに消す「未決」

| spec.md | 消す未決の番号 |
|---|---|
| common_errors | 1、2 |
| nta_get_jimu_unei | 5 |
| nta_get_kaisei_tsutatsu | 7 |
| nta_inspect_pdf_meta | 8 |
| nta_search_jimu_unei | 8 |
| nta_search_kaisei_tsutatsu | 8 |
| nta_get_tsutatsu | 2 |
| nta_get_qa | 3 |
| nta_get_tax_answer | 5 |

## 変わらない振る舞い

- 既存の仕様 ID の本文
- `src/` の実行されるコード

## 対象外

- `INTERNAL_ERROR` の `retryable` がツールと場面で揃わないこと（common_errors の未決 7）。009 は `retryable` について書かない
- inputSchema に無い引数が 2 つ以上あるときの `path` と、`message` の文面（common_errors の未決 4）
- `arguments` を省いた呼び出し（common_errors の未決 3）。今回の A の一覧に入っていないので扱わない。手元で呼ぶと `{}` と同じ応答になった
- 処理中の想定外の例外の `INTERNAL_ERROR` の `hint` など（common_errors の未決 6）

## 取り込みのとき（Publisher）

- ADDED の見出しを `specs/current/common_errors/spec.md` の「できること」の末尾に足す
- 上の表の「未決」の項目を消す。残った項目の番号は変えない
- common_errors の「処理の流れ」の図で、`INVALID_ARGUMENT` のノードに 007・008 を足し、009 のノード（ツールの処理 → 国税庁のページの解析に失敗 → `INTERNAL_ERROR`）を足す
- 変わった各 `spec.md` の承認日の行に「差分 `20260927-argument-and-parse-errors` は YYYY-MM-DD（PR #N）」を足す

## 人が判断すること

1. **承認日。** proposal.md に承認日と PR 番号を書く。
2. **009 の置き場。** ページの解析の失敗は、国税庁サイトから取る 3 ツール（`nta_get_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer`）だけの振る舞いだが、`hint`・`url`・`detail` の形が同じなので `common_errors` に置いた。ツールごとの ID にするなら作り直す。
3. **007 の `error` の文面。** `error` の先頭の文（「引数が tools/list の inputSchema に合いません: 」）までを約束にし、その後に続く問題の文（検査の部品が作る英語の文。例: `must have required property 'docId'`）は約束にしていない。

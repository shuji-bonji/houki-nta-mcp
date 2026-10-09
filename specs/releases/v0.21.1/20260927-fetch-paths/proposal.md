---
approved: 2026-09-27
pr: 88
implementation: required
targets: [nta_get_qa, nta_get_tax_answer, nta_get_tsutatsu]
---
# 変更: DB から返すか国税庁サイトから取るかの分かれ目に、仕様 ID とテストを足す

- 対象: `specs/current/nta_get_qa/spec.md` と `specs/current/nta_get_tax_answer/spec.md`（「できること」への追加）。`nta_get_tsutatsu` は ID を足さずテストだけ足す
- 実装の変更の補足: 受入テストを足す。`src/` は変えない
- 状態: 取り込み済み。受入テストは v0.21.1、`specs/current/` への取り込みは 2026-09-28（JST、実装 PR の最終コミット）
- 起こした日: 2026-09-27（JST）
- 起こした役: Spec Steward
- 関連: houki-nta-mcp #29（取得ツールの DB の使い方）、#54（通達の目次）、#50（初版起こし）、#63（処理の流れ。「人が判断すること」の 3）、#74、houki-hub `docs/notes/issues-2026-09-26-nta-undecided/README.md`（A の一覧）

## なぜ変えるか

国税庁サイトから取れる 3 ツール（`nta_get_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer`）は、DB にあれば DB から返し、無ければ取って DB に書き戻す（#29・#54）。この分かれ目のうち、次のものは受入テストが無い。

- 古い形式の行（構造を持たない行）を DB にあっても取り直すこと（ID も無い）
- bulk download で入れた行を DB から返すこと、取って書き戻した後の 2 回目は取りに行かないこと（ID はあるがテストが無い）
- #63 で書き直した nta_get_tsutatsu の 005・008・014 の条件（ID はあるがテストが無い。#63 の「人が判断すること」の 3 で A と同じ扱いにすると決めた）

分かれ目を間違えると、利用者は古い内容を受け取るか、国税庁サイトに不要な取得をかけることになるので、テストで固定する。

## 変わる振る舞い

無い。v0.21.0 の振る舞いを仕様 ID 付きで書き起こすだけ。本文はソースを読んで確かめた。

## 足す仕様 ID（ADDED、2 件）

| ツール             | 未決の番号 → 仕様 ID            |
| ------------------ | ------------------------------- |
| nta_get_qa         | 5 → SPEC-NTA-GET-QA-012         |
| nta_get_tax_answer | 7 → SPEC-NTA-GET-TAX-ANSWER-010 |

## 既存の仕様 ID で受ける項目（ID は足さず、テストを足す）

| ツール             | 項目     | 受ける仕様 ID               | テストで確かめること                                                                                            |
| ------------------ | -------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| nta_get_tax_answer | 未決 8   | SPEC-NTA-GET-TAX-ANSWER-004 | bulk download と同じ形で入れた行（構造を持つ行）を、国税庁サイトに取りに行かずに `source: "db"` で返す          |
| nta_get_tsutatsu   | 未決 1   | SPEC-NTA-GET-TSUTATSU-006   | 国税庁サイトから取った条項は DB に書き戻され、同じ条項の 2 回目の呼び出しは取りに行かずに `source: "db"` で返す |
| nta_get_tsutatsu   | #63 の 3 | SPEC-NTA-GET-TSUTATSU-005   | 4 通達以外の通達に条項が残っているとき、DB に無い条項は国税庁サイトに取りに行かず `ARTICLE_NOT_FOUND`           |
| nta_get_tsutatsu   | #63 の 3 | SPEC-NTA-GET-TSUTATSU-008   | 番号の形には当たるが、目次から候補ページを決められないとき（取り直しの後も）の `INVALID_ARGUMENT`               |
| nta_get_tsutatsu   | #63 の 3 | SPEC-NTA-GET-TSUTATSU-014   | その呼び出しで目次を取得したときは、条項が見つからなくても目次を取り直さない                                    |

## 取り込みのときに消す「未決」

| spec.md            | 消す未決の番号 |
| ------------------ | -------------- |
| nta_get_qa         | 5              |
| nta_get_tax_answer | 7、8           |
| nta_get_tsutatsu   | 1              |

`nta_get_tsutatsu` の 005・008・014 は「未決」に項目が無い（#63 の proposal に書いた）ので、消すものは無い。

## 変わらない振る舞い

- 既存の仕様 ID の本文
- `src/` の実行されるコード

## 対象外

- 書き戻しに失敗したときの扱い（今は黙って応答を返す）。今回の A の一覧に入っていない
- ページの解析の失敗（差分 `20260927-argument-and-parse-errors` の SPEC-NTA-COMMON-ERRORS-009）

## 取り込みのとき（Publisher）

- ADDED の見出しを、各 `specs/current/<dir>/spec.md` の「できること」の末尾に足す
- 上の表の「未決」の項目を消す。残った項目の番号は変えない
- `nta_get_qa`・`nta_get_tax_answer` の「処理の流れ」の図で、「DB にあるか」の分岐に「構造を持つ行か」（012 / 010）を足す
- 変わった各 `spec.md` の承認日の行に「差分 `20260927-fetch-paths` は YYYY-MM-DD（PR #N）」を足す

## 人が判断すること

1. **承認日。** proposal.md に承認日と PR 番号を書く。
2. **「v0.16.0 より前」の書き方。** 012・010 は、古い行を「構造を持たない行」で定義し、版は括弧書きの説明にとどめた。
3. **番号の前提。** `nta_get_qa` の 010・011、`nta_get_tax_answer` の 009 は、同じ日に出す他の差分（`20260927-index-status-marks`・`20260927-get-responses`）が使う前提で振った。

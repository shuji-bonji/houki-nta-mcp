---
approved: 2026-09-27
pr: 90
implementation: required
targets: [nta_search_bunshokaitou, nta_search_jimu_unei, nta_search_qa, nta_search_tax_answer, nta_search_tsutatsu, search_rules]
---
# 変更: 絞り込んで 0 件になったときの応答と、`freshness` の段階に仕様 ID を振る

- 対象: `specs/current/` の `search_rules`・`nta_search_bunshokaitou`・`nta_search_jimu_unei`・`nta_search_tax_answer` の `spec.md`（「できること」への追加）
- 実装の変更の補足: 受入テストを足す。テスト名を 1 件直す。`src/` は変えない
- 状態: 取り込み済み。受入テストは v0.21.1、`specs/current/` への取り込みは 2026-09-28（JST、実装 PR の最終コミット）
- 起こした日: 2026-09-27（JST）
- 起こした役: Spec Steward
- 関連: houki-nta-mcp #23（0 件の理由を分ける）、#50（初版起こし）、#74、#78（search_rules の初版）、houki-hub `docs/notes/issues-2026-09-26-nta-undecided/README.md`（A の一覧）

## なぜ変えるか

文書系の検索が 0 件のとき、理由を「DB に無い」「税目の範囲に無い」「`hasPdf` の条件に合わない」「キーワードに合わない」の 4 つに分けて返す（#23）。この振る舞いは 5 ツールとも同じ処理だが、`nta_search_qa`・`nta_search_kaisei_tsutatsu` には税目と `hasPdf` の場合の ID があるのに、`nta_search_bunshokaitou`・`nta_search_jimu_unei`・`nta_search_tax_answer` には無い場合が残っている。0 件のときの応答は各ツールの spec.md に書く決まり（search_rules の冒頭）なので、先にある ID にならってツールごとに足す。

`freshness` の段階（`fresh` / `stale` / `outdated`）と `warning` は、検索系 6 ツールが同じ処理で作るので、`search_rules` に 1 つ足す。

## 変わる振る舞い

無い。v0.21.0 の振る舞いを仕様 ID 付きで書き起こすだけ。本文の例は、v0.21.0 のソースから作った手元のビルドで DB に文書を入れて呼び、応答を確かめた。

## 足す仕様 ID（ADDED、6 件）

| 仕様 ID                          | 内容                                                                              | 元の未決                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| SPEC-NTA-SEARCH-RULES-017        | `freshness` のフィールドと段階、`outdated` のときだけ付く `warning`、判定する範囲 | search_rules 1、nta_search_jimu_unei 9、nta_search_qa 6、nta_search_tsutatsu 3 |
| SPEC-NTA-SEARCH-BUNSHOKAITOU-005 | `hasPdf` の条件に合う文書が無いときは `hasPdf` を外すよう案内する                 | nta_search_bunshokaitou 2                                                      |
| SPEC-NTA-SEARCH-BUNSHOKAITOU-006 | 0 件のときの `freshness` の範囲                                                   | nta_search_bunshokaitou 3                                                      |
| SPEC-NTA-SEARCH-JIMU-UNEI-005    | `taxonomy` の範囲に文書が無いときは税目の一覧を返す                               | nta_search_jimu_unei 1                                                         |
| SPEC-NTA-SEARCH-JIMU-UNEI-006    | `hasPdf` の条件に合う文書が無いときは `hasPdf` を外すよう案内する                 | nta_search_jimu_unei 2                                                         |
| SPEC-NTA-SEARCH-TAX-ANSWER-003   | `hasPdf` で絞る。合う文書が無いときは `hasPdf` を外すよう案内する                 | nta_search_tax_answer 2                                                        |

## テスト名を直す項目（ID は足さない）

nta_search_qa の未決 10: `src/tools/doc-search-zero-hit.test.ts` の「SPEC-NTA-SEARCH-TAX-ANSWER-001 nta_search_qa: 他の種別だけが入っている DB（qa のみ）でタックスアンサーを検索すると DOC_NOT_FOUND」は、呼んでいるのが `nta_search_tax_answer` なので、名前の `nta_search_qa:` を `nta_search_tax_answer:` に直す。期待値と仕様 ID は変えない。

## 取り込みのときに消す「未決」

| spec.md                 | 消す未決の番号 |
| ----------------------- | -------------- |
| search_rules            | 1              |
| nta_search_bunshokaitou | 2、3           |
| nta_search_jimu_unei    | 1、2、9        |
| nta_search_tax_answer   | 2              |
| nta_search_qa           | 6、10          |
| nta_search_tsutatsu     | 3              |

## 変わらない振る舞い

- 既存の仕様 ID の本文
- `src/` の実行されるコード

## 対象外

- `nta_search_tsutatsu` が 0 件のときに `freshness` を付けないこと（search_rules の未決 2 → houki-nta-mcp #71）。017 は「付けるときの形」だけを書く
- 閾値（7 日・30 日）の決め方。値は houki-abbreviations の共通値（`STALENESS_THRESHOLDS`）で、houki-abbreviations の仕様（SPEC-ABBR-JUDGE-STALENESS-\*）が正本

## 取り込みのとき（Publisher）

- ADDED の見出しを、各 `specs/current/<dir>/spec.md` の「できること」の末尾に足す
- 上の表の「未決」の項目を消す。残った項目の番号は変えない
- 「処理の流れ」の図で、税目・`hasPdf` の分岐に新しい ID の末尾 3 桁を足す（`nta_search_qa` の図と同じ形）
- 変わった各 `spec.md` の承認日の行に「差分 `20260927-search-zero-hits` は YYYY-MM-DD（PR #N）」を足す

## 人が判断すること

1. **承認日。** proposal.md に承認日と PR 番号を書く。
2. **017 の受入テストの作り方。** `warning` は「最も古い取得日時から 30 日以上」で付くので、テストは DB に古い `fetched_at` の文書を入れて確かめる。呼んだ日の日付に依存しない（数年前の日時を入れる）ように書くことを Test Designer に求める。
3. **番号の前提。** search_rules の 015 は `20260927-search-hit-responses`、016 は `20260927-search-keyword-rules` が使う前提で 017 にした。

---
approved: 2026-09-27
pr: 85
implementation: required
targets: [nta_search_bunshokaitou, nta_search_jimu_unei, nta_search_kaisei_tsutatsu, nta_search_qa, nta_search_tax_answer, nta_search_tsutatsu, search_rules]
---
# 変更: 検索でヒットしたときの応答の形に仕様 ID を振る

- 対象: `specs/current/search_rules/spec.md` と `specs/current/nta_search_tsutatsu/spec.md`（「できること」への追加）
- 実装の変更の補足: 受入テストを足す。`src/` は変えない
- 状態: 取り込み済み。受入テストは v0.21.1、`specs/current/` への取り込みは 2026-09-28（JST、実装 PR の最終コミット）
- 起こした日: 2026-09-27（JST）
- 起こした役: Spec Steward
- 関連: houki-nta-mcp #50（初版起こし）、#74（判断が要る未決を Issue に移した仕様 PR）、#78（search_rules の初版）、houki-hub `docs/notes/issues-2026-09-26-nta-undecided/README.md`（A の一覧）

## なぜ変えるか

検索系ツールでキーワードに合う文書があったときの応答は、利用者（LLM）が最もよく受け取る形である。しかし文書系 5 ツールは、0 件のときの応答には ID があるのに、ヒットしたときの `results` の要素のフィールドを確かめるテストが無い（件数や `docId` だけを見ている）。5 ツールは同じ処理で `results` を作るので、`search_rules` に共通の ID を 1 つ足す。`nta_search_tsutatsu` の並び順と関連度は、すでに SPEC-NTA-SEARCH-RULES-012・013・014 があるので、その ID でツールの応答としてのテストを足す。

## 変わる振る舞い

無い。v0.21.0 の振る舞いを仕様 ID 付きで書き起こすだけ。015 の本文は、v0.21.0 のソースから作った手元のビルドで 5 ツールを同じ DB に対して呼び、応答を確かめた。

## 足す仕様 ID（ADDED、2 件）

| 仕様 ID                      | 内容                                                                                              | 元の未決                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| SPEC-NTA-SEARCH-RULES-015    | 文書系 5 ツールのヒットしたときの応答（`results` の要素・`keyword`・`freshness`・`legal_status`） | nta_search_bunshokaitou 1、nta_search_jimu_unei 10、nta_search_kaisei_tsutatsu 4、nta_search_qa 1、nta_search_tax_answer 1 |
| SPEC-NTA-SEARCH-TSUTATSU-010 | `legal_status` はヒットしたときだけ付ける                                                         | nta_search_tsutatsu 4                                                                                                      |

## 既存の仕様 ID で受ける項目（ID は足さず、ツールの応答としてのテストを足す）

| ツール              | 未決の番号                                                   | 受ける仕様 ID                       |
| ------------------- | ------------------------------------------------------------ | ----------------------------------- |
| nta_search_tsutatsu | 2（`score` / `scoreReasons` と並び順、条項番号の一致の加点） | SPEC-NTA-SEARCH-RULES-012・013・014 |

## 約束にしなかったこと

- `results` の要素の `issuedAt`。改正通達・事務運営指針・文書回答事例は付け（DB に発出日が無ければ `null`）、質疑応答事例とタックスアンサーは付けない。タックスアンサーは DB に日付（法令時点から読んだ日付）があるのに返さない。揃えるかは人が決める（→ houki-nta-mcp #82）ので、015 には書かない。未決 nta_search_bunshokaitou 1・nta_search_jimu_unei 10・nta_search_kaisei_tsutatsu 4 の `issuedAt` の部分はその Issue に移す
- `score` の値そのもの（search_rules の未決 11・12）

## 取り込みのときに消す「未決」

| spec.md                    | 消す未決の番号 |
| -------------------------- | -------------- |
| nta_search_bunshokaitou    | 1              |
| nta_search_jimu_unei       | 10             |
| nta_search_kaisei_tsutatsu | 4              |
| nta_search_qa              | 1              |
| nta_search_tax_answer      | 1              |
| nta_search_tsutatsu        | 2、4           |

## 変わらない振る舞い

- 既存の仕様 ID の本文（SPEC-NTA-SEARCH-JIMU-UNEI-003 の本文も変えない。015 と重なる部分は、取り込みの後で整理するかを別に決める）
- `src/` の実行されるコード

## 対象外

- 0 件のときの応答（各ツールの spec.md の既存の ID と、差分 `20260927-search-zero-hits`）
- `freshness` の段階と `warning`（差分 `20260927-search-zero-hits` の SPEC-NTA-SEARCH-RULES-017）
- 応答の名前の違い（`hits` / `results` など。→ houki-nta-mcp #71）

## 取り込みのとき（Publisher）

- ADDED の見出しを、各 `specs/current/<dir>/spec.md` の「できること」の末尾に足す
- 上の表の「未決」の項目を消す。残った項目の番号は変えない
- 文書系 5 ツールの「処理の流れ」の図で、番号の無い成功の枝（「応答の形は「未決」の N」）に 015 を入れる。`nta_search_tsutatsu` の図の成功のノードに 010 を足す
- 変わった各 `spec.md` の承認日の行に「差分 `20260927-search-hit-responses` は YYYY-MM-DD（PR #N）」を足す

## 人が判断すること

1. **承認日。** proposal.md に承認日と PR 番号を書く。
2. **SPEC-NTA-SEARCH-TSUTATSU-010 の「0 件のときは付けない」。** 今の振る舞いのとおりに書いた。文書系 5 ツールは 0 件のときも `legal_status` を付けるので、#71（応答の形の不揃い）で揃えると決めたら、この ID は MODIFIED か REMOVED になる。#71 の結論を待つなら、この ID だけ外す。
3. **番号の前提。** `spec-ids next` は `specs/current/` しか見ないので、同じ日に出す他の差分と番号が重ならないように手で振った（search_rules の 016 は `20260927-search-keyword-rules`、017 は `20260927-search-zero-hits` が使う）。

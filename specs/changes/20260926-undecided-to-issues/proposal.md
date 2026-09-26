# 変更: 「未決」のうち判断が要る 45 件を Issue に移す

- 対象: `specs/current/` の下の 14 ツールの `spec.md`（`## 未決` の節）
- 実装の変更: 不要
- 承認日: 2026-09-26（PR #74）
- 状態: この仕様 PR の中で `specs/current/` に反映する。次の実装 PR の最終コミットで `specs/releases/<tag>/` へ移す
- 起こした日: 2026-09-26（JST）
- 起こした役: Spec Steward
- 関連する Issue: houki-nta-mcp #50（初版起こし）、#64〜#73（移した先）

## なぜ変えるか

#50 の初版起こしで「未決」に 110 件が残った。このうち 45 件は、意図か不具合かを人が決める必要があり、利用者にとって問題になる箇所でもある。初版起こしは現状を把握するためのもので、ここで見つかった問題は Issue で扱う。同じ問題が複数のツールに出ているため、種別ごとに 10 件の Issue にまとめて起票した（振り分けは houki-hub `docs/notes/issues-2026-09-26-nta-undecided/`）。

## 変わる振る舞い

無い。`spec.md` の「未決」の書き方だけを変える。

## 何を変えるか

- 「未決」の冒頭に、判断が要る項目は Issue に移したことと、テストが無いだけの項目の扱いを 1 段落で書き足す
- 判断が要る 45 件は、項目の題（太字の部分）と Issue の番号（`→ houki-nta-mcp #N`）だけを残し、本文を消す。本文は Issue に移してある
- 項目の番号は変えない（houki-hub の振り分けの表が番号で参照しているため）

| Issue | 種別                                         | 移した未決                                                                                                                                                               |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #64   | 「見つからない」ときのエラー code            | nta_get_bunshokaitou 6、nta_get_jimu_unei 1、nta_get_kaisei_tsutatsu 8、resolve_abbreviation 1                                                                           |
| #65   | 存在しない番号が再試行を案内するエラーになる | nta_get_qa 1、nta_get_tax_answer 1                                                                                                                                       |
| #66   | 識別子の形と全角の表記                       | nta_get_bunshokaitou 1、nta_get_kaisei_tsutatsu 6、nta_get_qa 2、nta_get_tax_answer 2・3、resolve_abbreviation 2                                                         |
| #67   | taxonomy の値の検査                          | nta_search_bunshokaitou 8、nta_search_jimu_unei 7、nta_search_kaisei_tsutatsu 1                                                                                          |
| #68   | limit の丸め                                 | nta_search_tsutatsu 1、nta_search_qa 2、nta_search_tax_answer 6、nta_search_bunshokaitou 6、nta_search_jimu_unei 5、nta_search_kaisei_tsutatsu 3                         |
| #69   | 空のキーワード                               | nta_search_qa 7、nta_search_tax_answer 7、nta_search_bunshokaitou 7、nta_search_jimu_unei 6、nta_search_kaisei_tsutatsu 2、resolve_abbreviation 3、nta_search_tsutatsu 9 |
| #70   | 案内の文面の食い違い                         | nta_get_tax_answer 4、nta_search_tsutatsu 8、resolve_abbreviation 4・5、nta_search_tax_answer 8、nta_search_kaisei_tsutatsu 9、nta_get_jimu_unei 6                       |
| #71   | 応答の形の不揃い                             | nta_search_tsutatsu 10、nta_get_tsutatsu 4、nta_get_jimu_unei 7、nta_inspect_pdf_meta 1・5                                                                               |
| #72   | nta_search_qa の domain 引数                 | nta_search_qa 8・9                                                                                                                                                       |
| #73   | DB に入れる値と保存するファイル名            | nta_get_tax_answer 9、nta_get_kaisei_tsutatsu 5、nta_inspect_pdf_meta 6                                                                                                  |

### 承認日の書き誤りの修正

#63（`20260926-processing-flow`）の承認で、12 本の `spec.md` と `specs/changes/20260926-processing-flow/proposal.md` の承認日が `2026-06-26` になっていた。#63 のマージは 2026-09-26（JST）なので `2026-09-26` に直した。また、#63 で「処理の流れ」を足した `nta_get_qa` と `nta_get_tsutatsu`（本文も書き直した）は、承認日の行に #63 の差分が書かれていなかったので書き足した。

## 変わらない振る舞い

- 仕様 ID と「できること」「できないこと」「処理の流れ」
- テストが無いだけの 65 件の本文（受入テストを書いてから ID を振る）
- `spec-ids check` の結果

## 対象外

- Issue の中身の判断と、それに伴う仕様の変更（Issue ごとに仕様 PR と実装 PR を出す）

## 人が判断すること

1. **承認日。** proposal.md に承認日と PR 番号を書く。`specs/current/` の 14 本の承認日の行にも、この差分（`20260926-undecided-to-issues`）の承認日を書き足す。
2. **#50 の初版の承認。** 12 本の初版（#50）は PR を通さずに main に入った。#63 の承認に初版も含めたとみなし（2026-09-26 に決定）、承認日の行を「初版と差分 `20260926-processing-flow`。PR #63」と書いた。

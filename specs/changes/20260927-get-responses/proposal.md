# 変更: 取得系ツールと nta_inspect_pdf_meta の応答の形に仕様 ID を振る

- 対象: `specs/current/` の `nta_get_bunshokaitou`・`nta_get_jimu_unei`・`nta_get_kaisei_tsutatsu`・`nta_get_tsutatsu`・`nta_get_qa`・`resolve_abbreviation`・`nta_inspect_pdf_meta` の `spec.md`（「できること」への追加）
- 実装の変更: 要（受入テストを足す。`src/` は変えない）
- 承認日: 2026-09-27（PR #89）
- 状態: 草案。承認後、実装 PR（Test Designer が受入テストを足す）の最終コミットで `specs/current/` に取り込み、`specs/releases/<tag>/` へ移す
- 起こした日: 2026-09-27（JST）
- 起こした役: Spec Steward
- 関連: houki-nta-mcp #1（docType 別の `legal_status`）、#17（画像の注記）、#22（関係法令通達の案内）、#36（PDF の保存）、#44（「別紙 N」の付け替え）、#50（初版起こし）、#74、houki-hub `docs/notes/issues-2026-09-26-nta-undecided/README.md`（A の一覧）

## なぜ変えるか

`nta_get_qa`・`nta_get_tax_answer`・`nta_get_tsutatsu` には markdown と json の応答の形の ID があるが、DB だけを引く 3 ツール（文書回答事例・事務運営指針・改正通達）には無く、初版起こしで「未決」（テストが無いだけ）に残った。`nta_inspect_pdf_meta` の応答の一部、`nta_get_tsutatsu` の画像の注記、`nta_get_qa` の案内の絞り込み、`resolve_abbreviation` の別名も同じである。利用者（LLM）はこれらのフィールドや行を読んで次の呼び出しを決めるので、仕様 ID を振ってテストで固定する。

## 変わる振る舞い

無い。v0.21.0 の振る舞いを仕様 ID 付きで書き起こすだけ。本文の形と例は、v0.21.0 のソースから作った手元のビルドで DB に文書を入れて呼び、応答を確かめた（`nta_get_tsutatsu` の 016 はソースを読んで確かめた）。

## 足す仕様 ID（ADDED、16 件）

| ツール                  | 未決の番号 → 仕様 ID                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| nta_get_bunshokaitou    | 2 → 005（markdown）、3 → 006（json）、5 → 007（`available_doc_ids` の並び）                                                           |
| nta_get_jimu_unei       | 2 → 005（json）、3 → 006（markdown）、4 → 007（添付 PDF の一覧）                                                                      |
| nta_get_kaisei_tsutatsu | 1 → 005（markdown）、2 → 006（json）、4 → 007（「別紙 N」の付け替え）                                                                 |
| nta_get_tsutatsu        | 3 → 016（画像の注記）                                                                                                                 |
| nta_get_qa              | 6 → 011（`next_actions` に入れない参照）                                                                                              |
| resolve_abbreviation    | 6 → 006（別名からの解決）                                                                                                             |
| nta_inspect_pdf_meta    | 3 → 014（保存した `unknown` の案内）、4 → 015（HTTP 以外の保存の失敗）、2 → 016（`legal_status`）、7 → 017（読めない添付 PDF の記録） |

markdown と json の形は 3 ツールで同じ処理を通るが、種別の行と末尾の注、`legal_status` が違い、取得系に共通の spec.md も無いので、`nta_get_qa` の 007・008 にならってツールごとに書いた（`20260927-index-status-marks` の「人が判断すること」の 2 と同じ論点）。

## 約束にしなかったこと

- `nta_get_jimu_unei` の markdown に「取得元」の行が無いこと（→ houki-nta-mcp #71）。006 は無いことを書かない
- `kind` の無い古い行の添付 PDF の扱い（→ houki-nta-mcp #73）。markdown の表は `kind` が無いと「その他」になり、`nta_inspect_pdf_meta` は題名から決める。005〜007 は `kind` がある行だけを前提にした
- `available_doc_ids` の並び（007）は `nta_get_jimu_unei`・`nta_get_kaisei_tsutatsu` でも同じ処理だが、両ツールの「未決」に項目が無いので、この差分では文書回答事例だけに書いた

## 取り込みのときに消す「未決」

| spec.md                 | 消す未決の番号 |
| ----------------------- | -------------- |
| nta_get_bunshokaitou    | 2、3、5        |
| nta_get_jimu_unei       | 2、3、4        |
| nta_get_kaisei_tsutatsu | 1、2、4        |
| nta_get_tsutatsu        | 3              |
| nta_get_qa              | 6              |
| resolve_abbreviation    | 6              |
| nta_inspect_pdf_meta    | 2、3、4、7     |

## 変わらない振る舞い

- 既存の仕様 ID の本文
- `src/` の実行されるコード

## 対象外

- 索引から消えた文書の印（差分 `20260927-index-status-marks`）
- `nta_get_tax_answer` の応答（007・008 がすでにある）

## 取り込みのとき（Publisher）

- ADDED の見出しを、各 `specs/current/<dir>/spec.md` の「できること」の末尾に足す
- 上の表の「未決」の項目を消す。残った項目の番号は変えない
- 「処理の流れ」の図で、markdown / json の枝に新しい ID の末尾 3 桁を足す
- 変わった各 `spec.md` の承認日の行に「差分 `20260927-get-responses` は YYYY-MM-DD（PR #N）」を足す

## 人が判断すること

1. **承認日。** proposal.md に承認日と PR 番号を書く。
2. **markdown の文面をどこまで約束にするか。** 行の見出し（`- **種別**` など）と末尾の注の文は、そのまま書いた。PDF の節の案内の引用（pdf-reader-mcp の使い方）は要点だけを書き、文面は約束にしていない。
3. **nta_inspect_pdf_meta 015 の 50MB の上限。** 値（52,428,800 バイト）と `error` の文を書いた。上限を変える見込みがあるなら、値は約束から外す。
4. **番号の前提。** `nta_get_bunshokaitou`・`nta_get_kaisei_tsutatsu` の 004 と `nta_get_qa` の 010 は `20260927-index-status-marks`、`nta_get_qa` の 012 は `20260927-fetch-paths` が使う前提で振った。

# 変更: キーワードの扱い（短い語・略称と通称の展開・全角の揃え方）を、検索系 6 ツールの応答として確かめる

- 対象: `specs/current/search_rules/spec.md`（「できること」への追加 1 件）。ツールの spec.md には ID を足さない
- 実装の変更: 要（受入テストを足す。`src/` は変えない）
- 承認日: 2026-09-27（PR #86）
- 状態: 取り込み済み。受入テストは v0.21.1、`specs/current/` への取り込みは 2026-09-28（JST、実装 PR の最終コミット）
- 起こした日: 2026-09-27（JST）
- 起こした役: Spec Steward
- 関連: houki-nta-mcp #14・#18・#21・#27（キーワードの扱い）、#50（初版起こし）、#74、#78（search_rules の初版）、houki-hub `docs/notes/issues-2026-09-26-nta-undecided/README.md`（A の一覧）

## なぜ変えるか

キーワードの扱い（空白で区切った語の AND、3 文字未満の語の部分一致と除外、略称・通称の展開、全角の揃え方）は、検索系 6 ツールが同じ処理で行う。#78 で `search_rules` に SPEC-NTA-SEARCH-RULES-001〜010 を置いたが、そのテストは共通の処理の単体テストと `nta_search_tsutatsu` の応答だけで、文書系 5 ツールの応答としては確かめていない（search_rules の未決 13）。そのため、ツールごとの spec.md の「未決」に 13 件残っている。新しい ID は、共通の規則のうちまだ ID の無い「展開の対象の範囲」（search_rules の未決 10）の 1 件だけ足し、残りは既存の ID でツールごとのテストを足す。

## 変わる振る舞い

無い。v0.21.0 の振る舞いを仕様 ID 付きで書き起こすだけ。016 の本文はソースと略称辞書（houki-abbreviations 0.4.1）で確かめた。

## 足す仕様 ID（ADDED、1 件）

| 仕様 ID                   | 内容                                                                                                     | 元の未決                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| SPEC-NTA-SEARCH-RULES-016 | 略称・通称を広げるのは houki-nta と houki-egov の管轄の項目だけで、正式名が `keyword` と同じなら広げない | search_rules 10、nta_search_tsutatsu 5 の「判例・裁決の略称は広げない」の部分 |

## 既存の仕様 ID で受ける項目（ID は足さず、ツールの応答としてのテストを足す）

| ツール                     | 未決の番号 | 受ける仕様 ID                                 |
| -------------------------- | ---------- | --------------------------------------------- |
| nta_search_bunshokaitou    | 4          | SPEC-NTA-SEARCH-RULES-003・004・005・006・010 |
| nta_search_jimu_unei       | 3          | SPEC-NTA-SEARCH-RULES-003・004・005・006      |
| nta_search_jimu_unei       | 4          | SPEC-NTA-SEARCH-RULES-009・010                |
| nta_search_kaisei_tsutatsu | 5          | SPEC-NTA-SEARCH-RULES-003・004・005・006      |
| nta_search_kaisei_tsutatsu | 6          | SPEC-NTA-SEARCH-RULES-009・010                |
| nta_search_qa              | 3          | SPEC-NTA-SEARCH-RULES-003・004・005・006      |
| nta_search_qa              | 4          | SPEC-NTA-SEARCH-RULES-009・010                |
| nta_search_tax_answer      | 3          | SPEC-NTA-SEARCH-RULES-003・004・005・006      |
| nta_search_tax_answer      | 4          | SPEC-NTA-SEARCH-RULES-009・010                |
| nta_search_tsutatsu        | 5          | SPEC-NTA-SEARCH-RULES-009・016                |
| nta_search_tsutatsu        | 6          | SPEC-NTA-SEARCH-RULES-005・006                |
| nta_search_tsutatsu        | 7          | SPEC-NTA-SEARCH-RULES-007・008                |
| nta_search_tsutatsu        | 11         | SPEC-NTA-SEARCH-RULES-001                     |

テストで使う語は日本語にする。英字の 2 文字の語と 3 文字以上の語を混ぜると、SPEC-NTA-SEARCH-RULES-004 の絞り込みで当たらない（手元で `"DX 投資促進税制"` を渡すと、本文に `DX` がある文書でも 0 件になった。search_rules の未決 8。→ houki-nta-mcp #81）。

## 約束にしなかったこと

- 3 文字未満の略称（例: `消法`）を正式名だけで探すこと。そのとき `search_notes` に部分一致で探した旨の文が入り、実際の探し方と合わない（search_rules の未決 9）。探し方と注記のどちらを正とするかは人が決める（→ houki-nta-mcp #80）ので、nta_search_tsutatsu 5 のこの部分は ID を振らずにその Issue に移す

## 取り込みのときに消す「未決」

| spec.md                    | 消す未決の番号 |
| -------------------------- | -------------- |
| search_rules               | 6、10、13      |
| nta_search_bunshokaitou    | 4              |
| nta_search_jimu_unei       | 3、4           |
| nta_search_kaisei_tsutatsu | 5、6           |
| nta_search_qa              | 3、4           |
| nta_search_tax_answer      | 3、4           |
| nta_search_tsutatsu        | 5、6、7、11    |

search_rules の 6（文書系で 3 文字以上の語と 2 文字の語が混ざるときの絞り込みのテスト）と 13（文書系 5 ツールの応答での短い語・通称・関連度）は、上の表のテストで満たされるので消す。

## 変わらない振る舞い

- 既存の仕様 ID の本文。nta_search_tsutatsu の SPEC-NTA-SEARCH-TSUTATSU-006〜008 と search_rules の 003・006・010 が重なっていることもこの差分では整理しない
- `src/` の実行されるコード

## 対象外

- search_rules の未決 7（DB に入れるときの揃え方の、種別ごとの証拠）。今回の A の一覧に入っていない
- search_rules の未決 8・9（→ houki-nta-mcp #81・#80）

## 取り込みのとき（Publisher）

- ADDED の見出しを `specs/current/search_rules/spec.md` の「できること」の末尾に足す
- 上の表の「未決」の項目を消す。残った項目の番号は変えない
- search_rules の「処理の流れ」の図で、「keyword 全体が辞書の略称そのものか」「辞書の通称か」の分岐に 016 を足す
- 変わった各 `spec.md` の承認日の行に「差分 `20260927-search-keyword-rules` は YYYY-MM-DD（PR #N）」を足す

## 人が判断すること

1. **承認日。** proposal.md に承認日と PR 番号を書く。
2. **016 の「判例・裁決の項目は広げない」の確かめ方。** 今の略称辞書（houki-abbreviations 0.4.1）には houki-nta と houki-egov 以外の管轄の項目が 1 件も無い。この部分の受入テストは辞書を差し替えて書くことになる。辞書の差し替えを認めないなら、016 から「管轄で限る」を外し「正式名と同じ語は広げない」だけにする。
3. **番号の前提。** search_rules の 015 は `20260927-search-hit-responses`、017 は `20260927-search-zero-hits` が使う前提で 016 にした。

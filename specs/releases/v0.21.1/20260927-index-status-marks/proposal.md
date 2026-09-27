# 変更: 索引から消えた文書の印に、取得系 4 ツールの仕様 ID を振り、検索系 4 ツールのテストを足す

- 対象: `specs/current/` の `nta_get_bunshokaitou`・`nta_get_kaisei_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer` の `spec.md`（「できること」への追加）。検索系 4 ツールは ID を足さない
- 実装の変更: 要（受入テストを足す。`src/` は変えない）
- 承認日: 2026-09-27 （PR #91）
- 状態: 取り込み済み。受入テストは v0.21.1、`specs/current/` への取り込みは 2026-09-28（JST、実装 PR の最終コミット）
- 起こした日: 2026-09-27（JST）
- 起こした役: Spec Steward
- 関連: houki-nta-mcp #30（索引から消えた文書の印）、#50（初版起こし）、#74（判断が要る未決を Issue に移した仕様 PR）、houki-hub `docs/notes/issues-2026-09-26-nta-undecided/README.md`（A の一覧）

## なぜ変えるか

国税庁の索引から消えた文書に印を付ける振る舞い（#30）は、取得系 5 ツール・検索系 5 ツールのすべてで出荷済みである。しかし仕様 ID とツールの応答としての受入テストがあるのは `nta_get_jimu_unei`（SPEC-NTA-GET-JIMU-UNEI-004）と `nta_search_jimu_unei`（SPEC-NTA-SEARCH-JIMU-UNEI-004・SPEC-NTA-SEARCH-RULES-011）だけで、残りの 8 ツールは初版起こしで「未決」（テストが無いだけ）に残った。利用者は過去の課税期間を調べるときにこの印で現行の文書と区別するので、変わったら CI が気付くようにする。

## 変わる振る舞い

無い。v0.21.0 の振る舞いを仕様 ID 付きで書き起こすだけ。本文の形は、v0.21.0 のソースから作った手元のビルドで DB に 1 件ずつ入れて呼び、応答を確かめた。

## 足す仕様 ID（ADDED、4 件）

| ツール                  | 未決の番号 → 仕様 ID                 |
| ----------------------- | ------------------------------------ |
| nta_get_bunshokaitou    | 4 → SPEC-NTA-GET-BUNSHOKAITOU-004    |
| nta_get_kaisei_tsutatsu | 3 → SPEC-NTA-GET-KAISEI-TSUTATSU-004 |
| nta_get_qa              | 4 → SPEC-NTA-GET-QA-010              |
| nta_get_tax_answer      | 6 → SPEC-NTA-GET-TAX-ANSWER-009      |

取得系は、共通の spec.md（`common_errors` / `search_rules`）のどちらの範囲にも入らない。先に ID のある SPEC-NTA-GET-JIMU-UNEI-004 と同じく、ツールごとに ID を振った（「人が判断すること」の 2）。

## 既存の仕様 ID で受ける項目（ID は足さず、ツールの応答としてのテストを足す）

| ツール                     | 未決の番号 | 受ける仕様 ID             |
| -------------------------- | ---------- | ------------------------- |
| nta_search_bunshokaitou    | 5          | SPEC-NTA-SEARCH-RULES-011 |
| nta_search_kaisei_tsutatsu | 7          | SPEC-NTA-SEARCH-RULES-011 |
| nta_search_qa              | 5          | SPEC-NTA-SEARCH-RULES-011 |
| nta_search_tax_answer      | 5          | SPEC-NTA-SEARCH-RULES-011 |

SPEC-NTA-SEARCH-RULES-011 の本文は、文書系 5 ツールのすべてに当てはまる形で書かれている。受入テストは、ツールごとに「索引にある文書と消えた文書の両方が返る」「消えた文書だけに `index_status` と `orphaned_at` が付く」「`search_notes` に件数の文が入る」を確かめ、テスト名に SPEC-NTA-SEARCH-RULES-011 を入れる。

## 取り込みのときに消す「未決」

| spec.md                    | 消す未決の番号 |
| -------------------------- | -------------- |
| nta_get_bunshokaitou       | 4              |
| nta_get_kaisei_tsutatsu    | 3              |
| nta_get_qa                 | 4              |
| nta_get_tax_answer         | 6              |
| nta_search_bunshokaitou    | 5              |
| nta_search_kaisei_tsutatsu | 7              |
| nta_search_qa              | 5              |
| nta_search_tax_answer      | 5              |

## 変わらない振る舞い

- 既存の仕様 ID の本文
- `src/` の実行されるコード

## 対象外

- `nta_inspect_pdf_meta` に印が付かないこと（→ houki-nta-mcp #71）
- 印を付ける判定（bulk download が索引と DB を突き合わせる処理）。この差分は応答に出る形だけを扱う

## 取り込みのとき（Publisher）

- ADDED の見出しを、各 `specs/current/<dir>/spec.md` の「できること」の末尾に足す
- 上の表の「未決」の項目を消す。残った項目の番号は変えない（houki-hub の振り分けの表が番号で参照しているため）
- 各 `spec.md` の「処理の流れ」の図で、索引の印のノードに新しい ID の末尾 3 桁を足す（`nta_get_jimu_unei` の図と同じ形）
- `specs/current/<dir>/spec.md` の承認日の行に「差分 `20260927-index-status-marks` は YYYY-MM-DD（PR #N）」を足す。検索系 4 ツールの spec.md も「未決」を消すので同じ行を足す

## 人が判断すること

1. **承認日。** proposal.md に承認日と PR 番号を書く。
2. **取得系の共通の置き場。** 取得系 5 ツールに共通する振る舞い（この印、markdown と json の応答の形）を書く共通の spec.md は今無い。この差分では SPEC-NTA-GET-JIMU-UNEI-004 にならってツールごとに ID を振った。取得系の共通の spec.md（ディレクトリ名は決めていない）を作ってそこに寄せるなら、この差分を作り直す。
3. **番号の前提。** `spec-ids next` は `specs/current/` しか見ないので、同じ日に出す他の差分と番号が重ならないように手で振った（`nta_get_bunshokaitou`・`nta_get_kaisei_tsutatsu` の 005 以降と `nta_get_qa` の 011 以降・`nta_get_tax_answer` の 010 は `20260927-get-responses` と `20260927-fetch-paths` が使う）。

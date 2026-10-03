# 変更: 0.22.0 の取り込みで直し漏れた specs/current の文を、取り込んだ本文に合わせる（#123）

- 対象: `specs/current/common_errors/spec.md`（「未決」4）、12 ツールの `specs/current/<tool>/spec.md` の「処理の流れ」の図（`nta_search_tsutatsu`・`nta_get_tsutatsu`・`nta_search_qa`・`nta_search_tax_answer`・`nta_search_kaisei_tsutatsu`・`nta_get_kaisei_tsutatsu`・`nta_search_jimu_unei`・`nta_get_jimu_unei`・`nta_search_bunshokaitou`・`nta_get_bunshokaitou`・`nta_inspect_pdf_meta`・`resolve_abbreviation`）、`nta_get_bunshokaitou` の「入力」の表、`nta_inspect_pdf_meta` の SPEC-NTA-INSPECT-PDF-META-020 の本文（Issue の外。下の「人が判断すること」2）
- 実装の変更: 不要
- 承認日: 2026-10-03（PR #132）
- 状態: 草案（`specs/current/` へはこの仕様 PR の中で反映する）
- 起こした日: 2026-10-03（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #123（specs/current の文が 0.22.0 の取り込みに追いついていない箇所）
- 決定の出典: houki-hub `docs/notes/2026-10-03-stage5-spec-instructions.md` の指示 J、#123 の「決めること」
- 前提: main `9ae81aa`（0.23.0 の取り込み済み）から切る。同じ版（0.24.0）の差分 `20261003-search-rules`（#80・#81・#72）と `20261003-source-paths`（#120・#128・#131）は、この差分で直した `specs/current/` の文を MODIFIED に写すので、この差分の上に積む。マージも この差分 → search-rules → source-paths の順

## なぜ変えるか

0.22.0 の実装 PR の最後のコミット（`3b2a0f9`）で差分 T1・T2・T3 を `specs/current/` に取り込んだとき、各 proposal.md の「取り込みのとき（Publisher）」に書かれていなかった 3 か所が、取り込んだ本文と食い違ったまま残った。どれも文書の直しで、振る舞いは変えない。仕様 ID は足さず、変えない。

## 直す箇所

| #   | 場所                                                 | 今の文                                                                                                                                | 直した後の文                                                                                                                                                                            | 根拠の仕様 ID                                                                                                     |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `common_errors` の「未決」4                          | 「inputSchema に無い引数が 2 つ以上あるときは、`path` にそれらの名前がすべて「, 」区切りで入り…問題ごとに引数を分けるかは人が決める」 | 題だけを残し `→ SPEC-NTA-COMMON-ERRORS-010・SPEC-NTA-COMMON-ERRORS-011` にする（ほかの解決済みの未決と同じ書き方。番号は振り直さない）                                                  | SPEC-NTA-COMMON-ERRORS-010（違反 1 件ごとに要素を分ける。#79）・011（`message` は「inputSchema に無い引数です」） |
| 2   | 12 ツールの「処理の流れ」の図                        | 空白だけの値と識別子の形を確かめる判定が図に無い。`nta_search_tsutatsu` の図は「keyword が空文字列か空白だけか」                      | 呼び出しの直後に、ローカル DB・国税庁サイト・略称辞書を引く前の判定を 1 つ置く（下の表）。`nta_search_tsutatsu` は「keyword が空白だけか（空文字は inputSchema の検査で止まる）」にする | 各ツールの空白の ID と、形の ID（SPEC-NTA-COMMON-ERRORS-014・015）                                                |
| 3   | `nta_get_bunshokaitou` の「入力」の表の `docId` の行 | 「本庁の事例は `税目/番号`」「国税局の事例は `局/税目/番号`」                                                                         | 「`税目/フォルダー名`」「`局/税目/フォルダー名`」と、例に `nagoya/hojin/nag_140625`、「フォルダー名の数字の桁数は確かめない」を足す                                                     | SPEC-NTA-GET-BUNSHOKAITOU-010（PR #121 で訂正）                                                                   |

### 2 の図に描いた判定

#123 の決めること 2 は「全ツールに 1 つの判定として描く」で書いた。空白だけの判定と形の判定は、実装でもこの順に続けて行い、どちらも同じ形の `INVALID_ARGUMENT` を返すので、図で分けても読み手が得る情報は増えない。判定の中に、その判定を書いた仕様 ID を並べた。

| ツール                       | 図に足した判定                                                                                                | 判定の位置                           | 書いた仕様 ID |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------- |
| `nta_search_tsutatsu`        | keyword が空白だけか（既存の判定の文を直した）                                                                | inputSchema の検査の後               | 002           |
| `nta_search_qa`              | keyword が空白だけか                                                                                          | `domain` の判定の前                  | 009           |
| `nta_search_tax_answer`      | keyword が空白だけか                                                                                          | DB を引く前                          | 005           |
| `nta_search_kaisei_tsutatsu` | keyword が空白だけか                                                                                          | DB を引く前                          | 006           |
| `nta_search_jimu_unei`       | keyword が空白だけか                                                                                          | DB を引く前                          | 008           |
| `nta_search_bunshokaitou`    | keyword が空白だけか                                                                                          | `taxonomy` の別表記の判定の前        | 008           |
| `nta_get_tsutatsu`           | name が空白だけか。続く略称辞書の判定に「全角を半角に揃えた name」と 018 を足した                             | 略称辞書を引く前                     | 017・018      |
| `nta_get_kaisei_tsutatsu`    | docId が空白だけでなく、全角を半角に揃えて受け付ける形か                                                      | DB を引く前                          | 009・010・011 |
| `nta_get_jimu_unei`          | 同上                                                                                                          | DB を引く前                          | 009・010・011 |
| `nta_get_bunshokaitou`       | 同上                                                                                                          | DB を引く前                          | 009・010・011 |
| `nta_inspect_pdf_meta`       | docId が空白だけか。続く DB の判定に「全角を半角に揃えた docId」と 020 を足した（このツールは形を確かめない） | DB を引く前                          | 019・020      |
| `resolve_abbreviation`       | abbr が空白だけか。続く辞書の判定に「全角を半角に揃えた abbr」と 008 を足した                                 | inputSchema の検査の後、辞書を引く前 | 007・008      |

判定の位置は、2026-10-03 JST に main `9ae81aa` の `src/tools/handlers.ts` の各ハンドラーの先頭（`isBlank` と `guardDocId`）で確かめた。`nta_get_qa`・`nta_get_tax_answer` の図は 0.22.0 の取り込みで直してあるので触らない。

## 変わる振る舞い

無い。

## 変わらない振る舞い

- 仕様 ID と「できること」の本文（下の「人が判断すること」2 の SPEC-NTA-INSPECT-PDF-META-020 を除く。020 も、文を実際の動きに合わせるだけで振る舞いは変えない）
- `spec-ids check` の結果

## 対象外

- `nta_get_qa`・`nta_get_tax_answer` の図（0.22.0 の取り込みで直してある）
- #80・#81・#72・#120・#128・#131 の判断（同じ版の別の差分）

## 人が判断すること

1. **図の描き方（#123 の決めること 2）。** 空白の判定と形の判定を 1 つの判定として描いた（勧める案）。ツールごとに 2 つの判定に分けて描く案もあるが、どちらも同じ形の `INVALID_ARGUMENT` を返すので、図の行が増えるだけになる。
2. **Issue の外で見つけた、同じ種類の食い違い 1 件を入れたこと。** SPEC-NTA-INSPECT-PDF-META-020 の本文が「SPEC-NTA-INSPECT-PDF-META-001（DB に無い文書は取りに行かない） の形の検査に進む」「国税庁サイトの URL を組み立てる」と書いているが、このツールは `docId` の形を確かめず（`handleNtaInspectPdfMeta` は空白の判定の後、揃えた値でそのまま DB を引く）、国税庁サイトの URL も `docId` から組み立てない（添付 PDF の URL は DB の値。保存先のパスは DB の `docId`）。T3 の差分で 3 つの取得ツールの 011 の文を写したときの書き誤りと読める。本文を実際の動きに合わせた。入れないなら、この 1 行を外して Issue にする。
3. **承認日。** この proposal.md に承認日と PR 番号を書く。あわせて、変わった 13 本の `specs/current/<dir>/spec.md` の承認日の行の末尾に「差分 `20261003-specs-current-catchup` は YYYY-MM-DD（PR #N）」を書き足す（AGENTS.md「承認日は、人がマージの前にそのブランチで書く」。pr-scope は行の先頭の日付だけを見るので、書き足さなくても止まらないが、どの差分で文が変わったかを残すため）。13 本は次のコマンドで書き足せる。

```sh
for d in common_errors nta_search_tsutatsu nta_get_tsutatsu nta_search_qa nta_search_tax_answer \
  nta_search_kaisei_tsutatsu nta_get_kaisei_tsutatsu nta_search_jimu_unei nta_get_jimu_unei \
  nta_search_bunshokaitou nta_get_bunshokaitou nta_inspect_pdf_meta resolve_abbreviation; do
  sed -i '' -E '/^- 承認日: /s/$/。差分 `20261003-specs-current-catchup` は YYYY-MM-DD（PR #N）/' "specs/current/$d/spec.md"
done
```

## 取り込みのとき（Publisher）

- `specs/current/` へはこの仕様 PR の中で反映済み。0.24.0 の実装 PR の最終コミットで、この差分のフォルダーを `specs/releases/v0.24.0/20261003-specs-current-catchup/` へ移し、「状態」を「取り込み済み（`specs/current/` へは仕様 PR #N の中で反映。v0.24.0 の実装 PR の最終コミットで `specs/releases/v0.24.0/` へ移した）」にする

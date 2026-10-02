# 変更: CLI・DB の初版の「未決」のうち判断が要る 12 件を Issue に移す（#75 の続き）

- 対象: `specs/current/db_schema/spec.md`、`specs/current/cli_entry/spec.md`、`specs/current/cli_bulk_download/spec.md`、`specs/current/cli_refresh/spec.md`、`specs/current/cli_health_check/spec.md`（`## 未決` の節）
- 実装の変更: 不要
- 承認日: 2026-09-30（PR #114）
- 状態: 草案。この仕様 PR の中で `specs/current/` に反映する。次の実装 PR の最終コミットで `specs/releases/<tag>/` へ移す
- 起こした日: 2026-09-30（JST）
- 起こした役: Spec Steward
- 関連する Issue: houki-nta-mcp #75（CLI・DB の初版起こし、PR #103）、#106〜#112（移した先）、#74（14 ツールの未決を Issue に移した仕様 PR。同じ形）

## なぜ変えるか

#75 の初版起こしで、CLI・DB の 5 単位の「未決」に 31 件が残った。このうち 13 件（cli_entry 2 と cli_refresh 4 は同じ内容なので、判断としては 12 件）は、意図か不具合かを人が決める必要があり、利用者にとって問題になる箇所でもある。初版起こしは現状を把握するためのもので、ここで見つかった問題は Issue で扱う。判断 1 つにつき Issue 1 件、計 7 件にまとめて起票した（振り分けは houki-hub `docs/notes/issues-2026-09-30-nta-cli-db/`）。

## 変わる振る舞い

無い。`spec.md` の「未決」の書き方だけを変える。

## 何を変えるか

- 判断が要る 13 件は、項目の題（太字の部分）と Issue の番号（`→ houki-nta-mcp #N`）だけを残し、本文を消す。本文は Issue に移してある
- 項目の番号は変えない（houki-hub の振り分けの表が番号で参照しているため）
- 「未決」の冒頭の段落（判断が要る項目は Issue に移す、テストが無いだけの項目は受入テストを書いてから ID を振る）は #103 で書いてあるので変えない

| Issue     | 種別                                                                                                                 | 移した未決                                         | 同じ問題の houki-egov-mcp の Issue           |
| --------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| #106 | CLI が引数の誤り（知らないフラグ・数でない日数・未対応の通達名）を知らせず、`--version` の文が houki-egov-mcp と違う | cli_entry 1・2、cli_refresh 4、cli_bulk_download 3 | #61（SPEC-EGOV-CLI-ENTRY-003・004 に揃える） |
| #107 | 版が合わない DB を消して作り直す。全データを消す機能の入口と `HOUKI_NTA_REFRESH=1` の説明                            | db_schema 2・4                                     | #60（egov 0.19.0 と同じ規則にする）          |
| #108 | 使い方の `--refresh` の説明・環境変数の欄・「N 日以上」が実際と合わない                                              | cli_refresh 2・6、cli_entry 5                      | #56（nta #70 と同じ種類）                    |
| #109 | `--refresh-stale --apply` は差分更新で、`--refresh` が効かない                                                       | cli_refresh 3                                      | —                                            |
| #110 | 税目を絞った投入では索引から消えた文書の印を付け直さない                                                             | cli_bulk_download 4                                | —                                            |
| #111 | `--check-baseline-drift` の対象外 4 件が常に `ok`                                                                    | cli_health_check 4                                 | —                                            |
| #112 | `document.doc_type` / `taxonomy` に列の制約が無い                                                                    | db_schema 6                                        | —                                            |

## 変わらない振る舞い

- 仕様 ID と「できること」「できないこと」「処理の流れ」
- テストが無いだけの 18 件の本文（受入テストを書いてから ID を振る）。cli_health_check 3（警告のしきい値）は「しきい値の値を仕様にするかは人が決める」で終わるが、しきい値は今の値で動いていて、値を仕様に書くかは受入テストを書くときに決めればよいので、そのまま残す
- `spec-ids check` の結果

## 対象外

- Issue の中身の判断と、それに伴う仕様の変更（Issue ごと、または計画書の段階ごとに仕様 PR と実装 PR を出す）

## 人が判断すること

1. **Issue の番号。** houki-hub `scripts/create-issues-2026-09-30-nta-cli-db.sh` で起票してから、`scripts/apply-issue-numbers-2026-09-30-nta-cli-db.sh` で `#106`〜`#112` を実際の番号に置き換え、`git commit -a --amend --no-edit` する。
2. **承認日。** proposal.md に承認日と PR 番号を書く。`specs/current/` の 5 本の初版の承認日（2026-09-29、PR #103）はそのまま残る。

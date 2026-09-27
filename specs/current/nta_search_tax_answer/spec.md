# 機能: nta_search_tax_answer（タックスアンサーをキーワードで検索する）

- 機能 ID: NTA
- 版: current
- 承認日: 2026-09-26（初版と差分 `20260926-processing-flow`。PR #63）。差分 `20260926-undecided-to-issues` は 2026-09-26（PR #74）。差分 `20260927-search-hit-responses` は 2026-09-27（PR #85）。差分 `20260927-search-keyword-rules` は 2026-09-27（PR #86）。差分 `20260927-search-zero-hits` は 2026-09-27（PR #90）。差分 `20260927-index-status-marks` は 2026-09-27（PR #91）
- 起こした元: v0.21.0 の `src/tools/handlers.ts`（`handleNtaSearchTaxAnswer`）、`src/tools/definitions.ts`、`src/services/db-search.ts`、`src/services/freshness.ts`、`src/services/index-status.ts`、`src/tools/handlers.test.ts`、`src/tools/doc-search-zero-hit.test.ts`
- 関連する Issue: houki-nta-mcp #18（短い語の扱い）、#21（通称の展開）、#23（0 件の理由を分ける）、#30（索引から消えた文書の印）

この文書は「このツールは何をするか」を書きます。どう実装しているか（関数名・テーブル名）は書きません。

## アクター

- MCP クライアント（Claude などの LLM、または CLI から呼ぶ人）。`keyword` を渡して、ローカル DB に入っている国税庁のタックスアンサー（一般納税者向けの解説、約 750 件）のうちキーワードに合うものの一覧（番号・題名・出典 URL・抜粋）を受け取る。本文は `nta_get_tax_answer` で番号を指定して取る

## 入力

| 引数      | 必須 | 内容                                                                                                                                                                                                           |
| --------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keyword` | 必須 | 検索キーワード。例: `"ふるさと納税"`、`"医療費控除"`。空白で区切ると複数の語になる。3 文字以上の語を推奨する（2 文字の語は本文の部分一致で補い、その旨を `search_notes` に書く。1 文字の語は検索条件から外す） |
| `limit`   | 任意 | 返す件数。既定 10、最大 50                                                                                                                                                                                     |
| `hasPdf`  | 任意 | 添付 PDF の有無で絞る。`true` は PDF 付きだけ、`false` は PDF 無しだけ、省くと絞らない                                                                                                                         |

検索の対象は、`--bulk-download-tax-answer` でローカル DB に入れたタックスアンサーである。このツールは国税庁サイトには取りに行かない。

## 処理の流れ

呼び出しを受けてから応答を返すまでに、何をどの順で確かめるかを示します。図の中の番号は「できること」の仕様 ID の末尾 3 桁です。

```mermaid
flowchart TD
  A["呼び出し（keyword・limit・hasPdf）"] --> B{"ローカル DB にタックスアンサーが 1 件でもあるか"}
  B -- 無い --> E1["DOC_NOT_FOUND と投入コマンドの案内を返す（001）"]
  B -- ある --> C{"keyword と hasPdf の条件に合う文書があるか（003）"}
  C -- ある --> R["results・keyword・freshness・legal_status を返す（015）"]
  C -- 無い --> H{"hasPdf の条件に合う文書があるか（003）"}
  H -- 無い --> E2["results: [] と hasPdf を外す案内を返す（003）"]
  H -- "ある（hasPdf を省いたときを含む）" --> D["results: []・keyword・件数付きの hint・freshness・legal_status を返す。エラーにしない（002）"]
```

## できること

### SPEC-NTA-SEARCH-TAX-ANSWER-001 DB にタックスアンサーが 1 件も無いときは「該当なし」ではなくエラーを返す

ローカル DB にタックスアンサーが 1 件も無い（まだ投入していない、または他の種別の文書だけが入っている）ときは、エラー `DOC_NOT_FOUND` を返す。キーワードに合う文書が無い「該当なし」とは違うことを、応答の形（`results` を持たないエラー）と `error` の文（「該当なし」という結果ではないこと）で示す。

- `tool` は `nta_search_tax_answer`
- `hint` に、MCP サーバーが開いている DB ファイルのパス、投入コマンド `houki-nta-mcp --bulk-download-tax-answer`、投入したはずのときに確かめる環境変数（`HOUKI_NTA_DB_PATH` / `XDG_CACHE_HOME`）を書く
- `next_actions` の先頭は `action: "cli_bulk_download"` で、`example.command` は `houki-nta-mcp --bulk-download-tax-answer`

例: 質疑応答事例だけを入れた DB で `keyword: "医療費控除"` を検索すると、`code: "DOC_NOT_FOUND"` と、その DB のパスを含む `hint` が返る。

### SPEC-NTA-SEARCH-TAX-ANSWER-002 タックスアンサーはあるがキーワードに合わないときは、成功として空の一覧と件数を返す

DB にタックスアンサーはあるが、キーワード（と `hasPdf` の条件）に合う文書が無いときは、エラーにせず次を返す。

| フィールド     | 内容                                                                                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `results`      | 空の配列 `[]`                                                                                                                                                                                                               |
| `keyword`      | 渡した `keyword`                                                                                                                                                                                                            |
| `hint`         | 「該当なし」と、探した範囲の文書の件数（`hasPdf` を指定したときは条件も）。例: `該当なし。DB のタックスアンサー 1 件に「医療費控除」に合う文書はありません。別のキーワードで試してください`                                 |
| `freshness`    | DB に入れた日時の範囲。`oldest_fetched_at` / `newest_fetched_at` / `staleness`（`fresh` / `stale` / `outdated`）/ `days_since_oldest`。`outdated` のときは `--bulk-download-tax-answer` で最新化するよう `warning` を付ける |
| `search_notes` | 2 文字以下の語や通称の展開があったときだけ、その扱いを書いた文字列の配列                                                                                                                                                    |
| `legal_status` | `binds_citizens: false` / `binds_courts: false` / `binds_tax_office: false` と、参考解説資料である旨の注                                                                                                                    |

### SPEC-NTA-SEARCH-TAX-ANSWER-003 `hasPdf` で絞り、合う文書が無いときは `hasPdf` を外すよう案内する

`hasPdf: true` を渡すと添付 PDF のある記事だけを、`hasPdf: false` を渡すと添付 PDF の無い記事だけを探す。

DB にタックスアンサーはあるが、`hasPdf` の条件に合う記事が 1 件も無いときは、エラーにせず次を返す。

- `results`: `[]`
- `keyword`: 渡した `keyword`
- `hint`: `DB のタックスアンサー <件数> 件に、PDF 付きの文書はありません。hasPdf を外して検索してください`。`hasPdf: false` なら「PDF 無しの文書はありません」。件数は DB のタックスアンサー全体の件数
- `freshness`: DB のタックスアンサー全体の取得時点（形は SPEC-NTA-SEARCH-RULES-017）
- `legal_status`

例: DB のタックスアンサー 2 件がどちらも PDF を持たないとき、`{ keyword: "源泉徴収", hasPdf: true }` の `hint` は `DB のタックスアンサー 2 件に、PDF 付きの文書はありません。hasPdf を外して検索してください` になる。

0 件の理由は SPEC-NTA-SEARCH-TAX-ANSWER-001 → 003 → 002 の順に決める。

## できないこと

- 国税庁サイトからタックスアンサーを探すこと（探すのはローカル DB だけ。DB に入れるのは `--bulk-download-tax-answer`）
- タックスアンサーの本文を返すこと（`results` は番号・題名・出典 URL・抜粋まで。本文は `nta_get_tax_answer`）
- 税目（税目フォルダ）で絞ること（`nta_search_qa` の `topic` や `nta_search_kaisei_tsutatsu` の `taxonomy` のような引数は無い）
- 結果が 0 件のときに、検索範囲を国税庁サイトや他の種別の文書に広げること
- 回答が今の法令でも成り立つかを判定すること

## 未決

初版起こしで見つけた、意図か不具合かを人が決める項目です。決まったら「できること」に ID を振るか、`specs/changes/` の差分にします。

意図か不具合かの判断が要る項目は houki-nta-mcp の Issue に移し、ここには題と Issue の番号だけを残します。今の振る舞いのままでよくテストが無いだけの項目は、受入テストを書いてから「できること」に ID を振ります。

6. **`limit` の範囲外の値を黙って丸める。** → houki-nta-mcp #68
7. **空のキーワード。** → houki-nta-mcp #69
8. **`nta_get_tax_answer` へ進む案内が無い。** → houki-nta-mcp #70

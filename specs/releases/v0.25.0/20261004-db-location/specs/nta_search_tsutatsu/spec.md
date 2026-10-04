# 差分: nta_search_tsutatsu（20261004-db-location）

`specs/current/nta_search_tsutatsu/spec.md` に対する差分です。

- `MODIFIED` は、見出しの行（題）も含めて、current の同じ ID の見出しと本文をこの差分の見出しと本文に置き換える
- 冒頭の「関連する Issue」の末尾に `、#138（DB の場所の見え方。0.25.0）` を足す

## MODIFIED

### SPEC-NTA-SEARCH-TSUTATSU-003 DB に条項が 1 件も無いときは、開こうとした DB のパスと、基本通達 4 種の bulk download を案内する

ローカル DB に基本通達の条項が 1 件も入っていないときは、エラー `TSUTATSU_NOT_FOUND`（`error` は「ローカル DB に検索対象がありません」）を返す。`next_actions` に `action: "cli_bulk_download"`（`example.command` は `--bulk-download-all` を付けた案内のコマンド。SPEC-NTA-DB-SCHEMA-027）を入れる。

`hint` は DB の状態で決める（SPEC-NTA-DB-SCHEMA-029）。DB のファイルが無い・版の記録が無い・版が合わないときは 029 の表の文。DB は使えるが条項が 1 件も無いときは次の文にする。`<パス>` は開こうとした DB のパス（SPEC-NTA-DB-SCHEMA-028 の形）、`<--bulk-download-all のコマンド>` と `<--bulk-download のコマンド>` は案内のコマンド（027。後者は `--bulk-download --tsutatsu=<正式名>`）。

```
ローカル DB（<パス>）に基本通達の条項が入っていません。`<--bulk-download-all のコマンド>` を実行して、基本通達 4 種を投入してください。1 つの通達だけを先に入れるときは `<--bulk-download のコマンド>` でも投入できます
```

このツールは基本通達 4 種をまとめて検索し、ツールの説明文と `freshness.warning`（SPEC-NTA-SEARCH-RULES-017）は `--bulk-download-all` を案内している。DB が空のときの案内も同じフラグにする。

例: 環境変数を付けずに起動した MCP サーバー（ホームディレクトリが `/Users/bonji`）で、条項の無い版 12 の DB に `{ keyword: "役員" }` を渡すと、`code: "TSUTATSU_NOT_FOUND"`、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）に基本通達の条項が入っていません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-all` を実行して、基本通達 4 種を投入してください。1 つの通達だけを先に入れるときは `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download --tsutatsu=<正式名>` でも投入できます``、`next_actions[0].example.command` は `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-all`（v0.24.x では `hint` が ``初回は `houki-nta-mcp --bulk-download-all` を実行して…`` で DB のパスを含まず、`example.command` は `houki-nta-mcp --bulk-download-all`。v0.22.0 では `--bulk-download` で、既定では消費税法基本通達 1 つだけが入っていた）。DB のファイルが無いときは `hint` が ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-all` で基本通達を投入してください``。

### SPEC-NTA-SEARCH-TSUTATSU-004 キーワードに合う条項があれば count と hits を返す

キーワードに合う条項があるときは、次のフィールドを持つ応答を返す。

| フィールド | 内容 |
| --- | --- |
| `keyword` | 渡されたキーワード（前後の空白を除いたもの） |
| `count` | `hits` の件数 |
| `hits` | 条項の配列。要素は `tsutatsu`（正式名。例 `"法人税基本通達"`）・`abbr`（略称。例 `"法基通"`）・`clauseNumber`（例 `"9-2-1"`）・`title`・`snippet`（一致した語を `<b>…</b>` で囲んだ前後の抜粋）・`sourceUrl`・`score`（0.0〜1.5 の関連度）・`scoreReasons`（関連度の理由の文の配列） |
| `freshness` | DB に入れた日時の範囲と鮮度（`oldest_fetched_at` / `newest_fetched_at` / `staleness` / `days_since_oldest`。古いときは `warning`）と、引いた DB のパス `db_path`。基本通達 4 種をまとめて判定する。判定できる節が無いときも付け、取得日時の 4 つを `null` にする（SPEC-NTA-SEARCH-RULES-017・022） |
| `legal_status` | `binds_citizens: false` / `binds_courts: false` / `binds_tax_office: true` と注（通達は行政内部文書で、納税者・裁判所を直接拘束しない） |
| `base_laws_by_tsutatsu` / `next_actions` | SPEC-NTA-SEARCH-TSUTATSU-009 |
| `search_notes` | SPEC-NTA-SEARCH-TSUTATSU-006・008。注記が無ければ付かない |

複数の語を空白で区切って渡したときは、全部の語を含む条項だけを返す。

例: `{ keyword: "役員" }` で DB に「役員の範囲」の条項 9-2-1 があれば、`count` は 1、`hits[0].clauseNumber` は `"9-2-1"`、`hits[0].snippet` は `<b>役員</b>` を含み、環境変数を付けずに起動していれば `freshness.db_path` は `"~/.cache/houki-nta-mcp/cache.db"`（ホームディレクトリの下のとき。v0.24.x では `db_path` が無く、判定できる節が無いときは `freshness` のキーも無かった）。

# 差分: db_schema（20261012-tsutatsu-db-not-found-guide）

`specs/current/db_schema/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の節（見出しから次の `###` または `##` の手前まで）を、見出しの行（題）も含めて丸ごと置き換える
- 冒頭の「関連する Issue」の末尾に `、#164（nta_get_tsutatsu の DB の経路の ARTICLE_NOT_FOUND の案内のコマンドを 027 の形にする。0.27.1）` を足す
- ほかの節は変えない

## MODIFIED

### SPEC-NTA-DB-SCHEMA-027 案内のコマンドは `npx -y @shuji-bonji/houki-nta-mcp@latest <フラグ>` で、DB の場所を決めた設定を同じ形で付ける

MCP の応答と CLI の出力で利用者に実行を勧めるコマンドは、次の形にする。

```
[<前に付ける変数>=<シェルに書くパス> ]npx -y @shuji-bonji/houki-nta-mcp@latest <フラグ>[ --db-path=<シェルに書くパス>]
```

前と後ろに付けるものは、DB の場所の設定（SPEC-NTA-DB-SCHEMA-026）で決める。

| DB の場所の設定 | 前に付けるもの | 後ろに付けるもの |
| --- | --- | --- |
| `既定` | 何も付けない | 何も付けない |
| `--db-path` | 何も付けない | ` --db-path=<DB の絶対パスをシェルに書くパス>` |
| `HOUKI_NTA_DB_PATH` | `HOUKI_NTA_DB_PATH=<DB の絶対パスをシェルに書くパス>` | 何も付けない |
| `XDG_CACHE_HOME` | `XDG_CACHE_HOME=<XDG_CACHE_HOME の値を絶対パスにしたものをシェルに書くパス>` | 何も付けない |

`<フラグ>` には、そのフラグに続ける値も含む（例: `--bulk-download --tsutatsu="消費税法基本通達"`、`--bulk-download-qa --qa-topic=shohi`）。`--db-path` は MCP サーバーでは当てはまらないので、MCP の応答のコマンドの後ろに付くことはない。

シェルに書くパスは、bash・zsh・sh でそのまま動き、MCP の応答に利用者名を出さない形にする。

1. ホームディレクトリの下（SPEC-NTA-DB-SCHEMA-028 の 2〜5 と同じ判定）なら `"$HOME/<残り>"`。`<残り>` に `"`・`$`・`` ` ``・`\`・`!` のどれかを含むときは `"$HOME"'/<残り>'` にし、`<残り>` の `'` は `'\''` にする
2. ホームディレクトリの下でないなら `'<絶対パス>'`。`'` は `'\''` にする

当てはまる箇所:

| 出る場所 | 箇所 | 仕様 ID |
| --- | --- | --- |
| MCP の応答 | `next_actions[]` のうち `action: "cli_bulk_download"` の `example.command` | SPEC-NTA-DB-SCHEMA-029、SPEC-NTA-COMMON-ERRORS-017、SPEC-NTA-GET-TSUTATSU-005、SPEC-NTA-GET-TSUTATSU-010 |
| MCP の応答 | 「DB に 1 件も無い」ときの `hint` と、版の合わない DB の `hint` の中のコマンド | SPEC-NTA-DB-SCHEMA-029、021 の注 2 |
| MCP の応答 | DB を開けないときの `hint` の中の `--status` のコマンド | SPEC-NTA-DB-SCHEMA-029 |
| MCP の応答 | 税目を絞って追加する案内のコマンド | SPEC-NTA-SEARCH-QA-005、SPEC-NTA-SEARCH-BUNSHOKAITOU-002 |
| MCP の応答 | 「DB を投入した後に公開された文書は、`<コマンド>` をもう一度実行すると取り込めます」 | SPEC-NTA-GET-KAISEI-TSUTATSU-002、SPEC-NTA-GET-JIMU-UNEI-002、SPEC-NTA-GET-BUNSHOKAITOU-003 |
| MCP の応答 | 取得時点を読めないときの `hint` | SPEC-NTA-COMMON-ERRORS-017 |
| MCP の応答 | `nta_get_tsutatsu` の `hint` の `--bulk-download --tsutatsu="<正式名>"` を付けたコマンド（基本通達 4 種で、候補ページに条項が無いとき（SPEC-NTA-GET-TSUTATSU-010）と、bulk download 済みの通達に条項が無いとき（SPEC-NTA-GET-TSUTATSU-005）。ライブ取得に対応していない通達（SPEC-NTA-GET-TSUTATSU-007）と、基本通達 4 種以外の通達の条項が DB に残っているとき（005 の (b)）にはコマンドを案内しない） | SPEC-NTA-GET-TSUTATSU-005、SPEC-NTA-GET-TSUTATSU-010 |
| MCP の応答 | `freshness.warning` の中のコマンド | SPEC-NTA-SEARCH-RULES-017 |
| CLI の出力 | SPEC-NTA-DB-SCHEMA-021 の CLI のエラーの文の中のコマンド、`--status` の `(DB がまだありません — …)` の行 | SPEC-NTA-DB-SCHEMA-021、SPEC-NTA-CLI-STATUS-004 |

CLI の出力でも同じ形にする（CLI を `HOUKI_NTA_DB_PATH=… npx …` のように 1 回だけ変数を付けて実行した人や、`--db-path` を付けて実行した人が、案内のコマンドをそのまま実行して同じ DB を開けるようにするため）。

次の箇所はこの形にしない: `--help` の使い方（SPEC-NTA-CLI-ENTRY-002）、SPEC-NTA-DB-SCHEMA-029 の「その種別が 1 件も無い」ときの文の「投入したシェルで `npx -y @shuji-bonji/houki-nta-mcp@latest --status` を実行し」（MCP サーバーの設定ではなく、投入したシェルの設定で開く DB を確かめるためのコマンドなので、変数も `--db-path` も付けない。029 の DB を開けないときの文の `--status` は、MCP サーバーが開こうとした DB を確かめるためのものなので、この形にする）、`--quickstart` が終わった後の「次に試すこと」の行（SPEC-NTA-CLI-BULK-DOWNLOAD-007）、tools/list のツールの説明（フラグだけを書いている）、フラグだけを書いた文（SPEC-NTA-INSPECT-PDF-META-001 の DB はあるがその文書が無いときの `hint`、SPEC-NTA-DB-SCHEMA-021 の CLI のエラーの文の `か --bulk-download-all で作ってください` の `--bulk-download-all`）。

例（ホームディレクトリが `/Users/bonji`）:

| 起動・実行したときの設定 | `--bulk-download-qa` の案内のコマンド |
| --- | --- |
| 環境変数なし | `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` |
| `HOUKI_NTA_DB_PATH=/Users/bonji/.cache/houki-nta-mcp/cache.dev.db` | `HOUKI_NTA_DB_PATH="$HOME/.cache/houki-nta-mcp/cache.dev.db" npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` |
| `HOUKI_NTA_DB_PATH=/tmp/x/cache.db` | `HOUKI_NTA_DB_PATH='/tmp/x/cache.db' npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` |
| `XDG_CACHE_HOME=/Users/bonji/Library/Caches` | `XDG_CACHE_HOME="$HOME/Library/Caches" npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` |
| CLI に `--db-path=/Users/bonji/dev$1/cache.db`（`'…'` で囲んで渡す） | `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa --db-path="$HOME"'/dev$1/cache.db'` |

v0.27.0 までは、`nta_get_tsutatsu` の DB の経路の `ARTICLE_NOT_FOUND`（SPEC-NTA-GET-TSUTATSU-005）の `hint`（`` `--bulk-download` で再取得してください``）も「フラグだけを書いた文」としてこの形の外に置いていた。#164 で 005 の `hint` と `next_actions` を SPEC-NTA-GET-TSUTATSU-010 とそろえ、上の表に入れた（0.27.1）。

v0.24.x のコマンドは、どの場合も `houki-nta-mcp --bulk-download-qa`（グローバルにインストールしていないと `command not found`、`npx houki-nta-mcp` は npm に無い名前で 404。houki-egov-mcp #108 の 2 と同じ）。

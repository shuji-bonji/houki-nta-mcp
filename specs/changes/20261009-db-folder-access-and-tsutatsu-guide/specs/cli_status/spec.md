# 差分: cli_status（20261009-db-folder-access-and-tsutatsu-guide）

`specs/current/cli_status/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の節（見出しから次の `###` または `##` の手前まで）を、見出しの行（題）も含めて丸ごと置き換える
- 冒頭の「関連する Issue」の末尾に `、#154（置き場所のフォルダーに入る権限が無いとき。0.27.0）` を足す
- 「処理の流れ」の図、「入力」、「できないこと」、「未決」は変えない

## MODIFIED

### SPEC-NTA-CLI-STATUS-004 DB が無いときは作らずに、そのことを出して exit 0

DB のファイルが無いとき（置き場所のフォルダーも無いときを含む）と、ファイルはあるが版の記録が無いときは、1〜3 行目と、あれば SPEC-NTA-CLI-STATUS-002 の `[WARN]` の行の後に、次の 1 行を標準出力に出し、件数を出さずに終了コード 0 で終わる。`<コマンド>` は `--quickstart` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027。`--db-path` を付けて実行したときは後ろに `--db-path=…` が付く）。

| DB の状態 | 行 |
| --- | --- |
| ファイルが無い | `  (DB がまだありません — <コマンド> などの投入のフラグで作ります)` |
| ファイルはあるが版の記録が無い | `  (DB のファイルはありますが、まだ何も投入されていません — <コマンド> などの投入のフラグで、このファイルに投入します)` |

置き場所のフォルダー（またはパスの途中のフォルダー）に入る権限が無く、DB のファイルがあるかを確かめられないときは、ファイルが無いときに当たらず、SPEC-NTA-CLI-STATUS-007 の開けないときにする（SPEC-NTA-DB-SCHEMA-021。v0.26.x では、この ID の `  (DB がまだありません — …)` を出して終了コード 0 だった。#154）。

DB のファイル・フォルダー・テーブルを作らない（SPEC-NTA-CLI-STATUS-008）。

例: `HOUKI_NTA_DB_PATH=<空のフォルダー>/a/cache.db`（`<空のフォルダー>` はホームディレクトリの外）で実行すると、標準出力は `[status] …`・`  DB: <空のフォルダー>/a/cache.db`・`  DB の場所の設定: HOUKI_NTA_DB_PATH（…）`・`  (DB がまだありません — HOUKI_NTA_DB_PATH='<空のフォルダー>/a/cache.db' npx -y @shuji-bonji/houki-nta-mcp@latest --quickstart などの投入のフラグで作ります)` の 4 行で終了コード 0、終わった後も `<空のフォルダー>/a` は無い。

### SPEC-NTA-CLI-STATUS-007 DB を開けないときは exit 1

DB のパスがフォルダー、SQLite でないファイル、パスの途中が普通のファイル、DB のファイルを読む権限が無い、置き場所のフォルダー（またはパスの途中のフォルダー）に入る権限が無いなどで開けないとき（SPEC-NTA-DB-SCHEMA-021 の開けない行）は、1〜3 行目と、あれば `[WARN]` の行を標準出力に出した後、標準エラー出力に `[ERROR] DB を開けません: <エラーの文>` を出し、件数を出さずに終了コード 1 で終わる（SPEC-NTA-DB-SCHEMA-021 の開けない行と同じ文）。

例: `--db-path` に SQLite でない中身のファイルを指定すると `[ERROR] DB を開けません: file is not a database` を出して終了コード 1。`/tmp/locked` が `chmod 000` のフォルダーのとき、`--db-path=/tmp/locked/cache.db` を指定すると、`/tmp/locked` の中に `cache.db` があってもなくても `[ERROR] DB を開けません: EACCES: パスの途中のフォルダーに入る権限がありません (/tmp/locked)` を出して終了コード 1（v0.26.x では `  (DB がまだありません — …)` を出して終了コード 0）。同じフォルダーの別の `cache*.db` は探せないので、SPEC-NTA-CLI-STATUS-002 の `[WARN]` の行は出ない。

# 差分: cli_entry（20261004-db-location）

`specs/current/cli_entry/spec.md` に対する差分です。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- `MODIFIED` は、見出しの行（題）も含めて、current の同じ ID の見出しと本文をこの差分の見出しと本文に置き換える
- 冒頭の「関連する Issue」の末尾に `、#138（--status と起動時のログの DB の場所。0.25.0）` を足す
- 「アクター」の 1 つ目の `ローカル DB を作る・最新化する` を `ローカル DB を作る・最新化する・場所と中身を確かめる` にする
- 「入力」の表の上の文の「処理を選ぶフラグ（`--help`・`--version`・`--quickstart`・`--bulk-download*`・`--refresh-stale=<日数>`・`--health-check`・`--check-baseline-drift`）」に `--status` を足す（`--refresh-stale=<日数>` の後）
- 「入力」の表の `--db-path=<path>` の行の内容の先頭の「投入と `--refresh-stale` だけで使う。」を「投入と `--refresh-stale` と `--status` だけで使う。」にする。表の `--refresh` / `--refresh-stale=<日数>` / `--apply` の行の前に、`--status` の行（`任意`、`DB の場所と、それを決めた設定、種別ごとの件数を出す。DB を作らず、移行もしない（cli_status）`）を足す
- 「処理の流れ」の図の `S["MCP サーバーとして標準入出力で待ち受ける（001）"]` の後に `S --> S2["起動時のログに DB の絶対パスと、DB の場所の設定を出す（009）"]` を足す。`O["その処理をして終わる（cli_bulk_download / cli_refresh / cli_health_check）"]` を `O["その処理をして終わる（cli_bulk_download / cli_refresh / cli_health_check / cli_status）"]` にする
- 「できないこと」の「MCP サーバーに CLI のフラグで DB の場所を渡すこと」の行の後に、`MCP サーバーの起動時に DB があるか・版が合うかを確かめてログに出すこと（起動時のログは場所と設定だけ。SPEC-NTA-CLI-ENTRY-009）` を足す
- 「未決」の 4（MCP サーバーの終わり方）の「起動すると標準エラー出力に `[server] <パッケージ名> v<版> started …` を JSON のログとして出す。」を「起動すると標準エラー出力に、`msg` が `<パッケージ名> v<版> started …` の JSON のログを出す（その次の行は SPEC-NTA-CLI-ENTRY-009）。」にする

## ADDED

### SPEC-NTA-CLI-ENTRY-009 MCP サーバーは起動時のログに、DB の絶対パスと DB の場所の設定を出す

引数なしで MCP サーバーとして起動すると、`started` の JSON のログの行（`scope` が `server`、`msg` が `<パッケージ名> v<版> started …`）の次に、標準エラー出力へ次の JSON の 1 行を出す。

| キー | 値 |
| --- | --- |
| `level` | `info` |
| `scope` | `server` |
| `msg` | `DB: <DB の絶対パス>（DB の場所の設定: <設定の名前>）` |
| `meta` | `{ db_path: "<DB の絶対パス>", setting: "<設定の名前>" }` |

`<DB の絶対パス>` と `<設定の名前>` は SPEC-NTA-DB-SCHEMA-026 のとおり（MCP サーバーでは `--db-path` は当てはまらないので、`HOUKI_NTA_DB_PATH`・`XDG_CACHE_HOME`・`既定` のどれか）。ホームディレクトリを `~` に置き換えない（SPEC-NTA-DB-SCHEMA-028）。この行のために DB を開かず、ファイルがあるかも確かめない（ツールは呼び出しごとに DB を開くので、起動した後に CLI で作った DB も使える。起動時の有無を出すと古い情報になる）。MCP の応答（tools/list とツールの応答）は変わらない。

例: 環境変数を付けずに、ホームディレクトリが `/Users/bonji` の環境で起動すると、`started` の行の次に `{"ts":"…","level":"info","scope":"server","msg":"DB: /Users/bonji/.cache/houki-nta-mcp/cache.db（DB の場所の設定: 既定）","meta":{"db_path":"/Users/bonji/.cache/houki-nta-mcp/cache.db","setting":"既定"}}`。`HOUKI_NTA_DB_PATH=/Users/bonji/.cache/houki-nta-mcp/cache.dev.db` を付けて起動すると `msg` は `DB: /Users/bonji/.cache/houki-nta-mcp/cache.dev.db（DB の場所の設定: HOUKI_NTA_DB_PATH）`（v0.24.x では `started` の 1 行だけで、どのファイルを開くかはログから分からなかった。houki-nta-mcp #138）。

## MODIFIED

### SPEC-NTA-CLI-ENTRY-002 `--help` と `-h` は使い方を標準出力に出して終わり、MCP サーバーを起動しない

`--help` または `-h` があるときは、使い方を標準出力に出し、ほかの処理をせずに終わる。使い方には次が載る。

- 先頭にパッケージ名と版（`@shuji-bonji/houki-nta-mcp v<版>`）
- 「まず試す」の節に `--quickstart`。この節は `--bulk-download-everything` の説明より前にある
- 種別を足すフラグと、税目フラグに使える値の一覧。`--qa-topic の値: shotoku, gensen, …`、`--bunsho-taxonomy の値: shotoku, gensen, joto-sanrin, …`（国税局の別表記も添える）、`--tax-answer-taxonomy の値: …`
- 保守のフラグ（`--status`・`--refresh-stale`・`--apply`・`--health-check`・`--check-baseline-drift`・`--strict`）、オプション（`--tsutatsu`・`--db-path`・`--refresh`）、環境変数 `HOUKI_NTA_DB_PATH`・`XDG_CACHE_HOME`
- `--status` の行は、DB の場所とそれを決めた設定、種別ごとの件数を出し、DB を作らないことを書く

使い方のコマンドは `houki-nta-mcp <フラグ>` の形のまま（案内のコマンドの形 SPEC-NTA-DB-SCHEMA-027 にはしない）。

例: `houki-nta-mcp --help` の標準出力に `--status` の行がある（v0.24.x には `--status` が無かった）。

### SPEC-NTA-CLI-ENTRY-004 `--db-path=<path>` で、投入と `--refresh-stale` と `--status` が使う DB ファイルを指定できる

`--db-path=<path>` を投入のフラグ（`--quickstart`・`--bulk-download*`）か `--refresh-stale=<日数>` か `--status` と一緒に付けると、その処理は環境変数によらずそのパスの DB を使う。DB の場所の設定は `--db-path` になる（SPEC-NTA-DB-SCHEMA-026）。`:memory:` を渡すとファイルを作らない一時的な DB になる。例: `--bulk-download --tsutatsu=所得税基本通達 --db-path=/tmp/cache.db` は、`/tmp/cache.db` に所得税基本通達を投入する。`--status --db-path=/tmp/cache.db` は、`/tmp/cache.db` の場所と件数を出す（SPEC-NTA-CLI-STATUS-001）。

`--db-path=<path>` だけを渡したとき、または DB を使わない処理（`--health-check`・`--check-baseline-drift`・`--help`・`--version`）と一緒に渡したときは、SPEC-NTA-CLI-ENTRY-007 のエラーにする。MCP サーバーの DB の場所は `--db-path` では変わらない（v0.23.x までは `--db-path=<path>` だけを渡すと MCP サーバーが起動し、そのパスは使わなかった。#106）。`--db-path=`（値が空）は SPEC-NTA-CLI-ENTRY-006 の値の無いフラグのエラーにする。

### SPEC-NTA-CLI-ENTRY-007 処理を選ぶフラグは 1 つだけで、その処理が受け付けないフラグはエラーにして exit 2

形と値が正しい（SPEC-NTA-CLI-ENTRY-006・008）引数について、次を確かめる。当たれば、そのフラグの処理を何もせず（DB を開かず、国税庁サイトに接続せず）、標準エラー出力にエラーを出し、続けて使い方を標準出力に出して、終了コード 2 で終わる。

| 場面 | 標準エラー出力 |
| --- | --- |
| 処理を選ぶフラグが 2 つ以上ある | `ERROR: 余分な引数: <前から 2 つ目の処理を選ぶフラグ>` |
| 処理を選ぶフラグが受け付けないフラグがある（下の表）。同じフラグを 2 回渡したときの 2 回目を含む | `ERROR: 余分な引数: <前から最初のそのフラグ>` |
| 処理を選ぶフラグが無く、ほかのフラグだけがある（`--db-path=<path>` だけ、`--strict` だけなど） | `ERROR: 処理を選ぶフラグがありません（<前から最初のフラグ> だけでは何もしません）` |

処理を選ぶフラグと、一緒に使えるフラグは次のとおり。

| 処理を選ぶフラグ | 一緒に使えるフラグ |
| --- | --- |
| `--help` / `-h`、`--version` / `-v` | なし |
| `--quickstart`、`--bulk-download` | `--tsutatsu`・`--refresh`・`--db-path` |
| `--bulk-download-all`、`--bulk-download-kaisei`、`--bulk-download-jimu-unei` | `--refresh`・`--db-path` |
| `--bulk-download-bunshokaitou` | `--bunsho-taxonomy`・`--refresh`・`--db-path` |
| `--bulk-download-tax-answer` | `--tax-answer-taxonomy`・`--refresh`・`--db-path` |
| `--bulk-download-qa` | `--qa-topic`・`--refresh`・`--db-path` |
| `--bulk-download-everything` | `--bunsho-taxonomy`・`--tax-answer-taxonomy`・`--qa-topic`・`--refresh`・`--db-path` |
| `--refresh-stale=<日数>` | `--apply`・`--db-path`。`--refresh` は `--apply` があるときだけ（SPEC-NTA-CLI-REFRESH-007） |
| `--status` | `--db-path` |
| `--health-check`、`--check-baseline-drift` | `--strict` |

例:

| 実行 | 標準エラー出力 | 終了コード |
| --- | --- | --- |
| `houki-nta-mcp --bulk-download-qa --health-check` | `ERROR: 余分な引数: --health-check` | 2 |
| `houki-nta-mcp --bulk-download-all --tsutatsu=所得税基本通達` | `ERROR: 余分な引数: --tsutatsu=所得税基本通達` | 2 |
| `houki-nta-mcp --refresh-stale=30 --refresh` | `ERROR: 余分な引数: --refresh` | 2 |
| `houki-nta-mcp --apply` | `ERROR: 処理を選ぶフラグがありません（--apply だけでは何もしません）` | 2 |
| `houki-nta-mcp --db-path=/tmp/x.db` | `ERROR: 処理を選ぶフラグがありません（--db-path=/tmp/x.db だけでは何もしません）` | 2 |
| `houki-nta-mcp --status --refresh` | `ERROR: 余分な引数: --refresh` | 2 |
| `houki-nta-mcp --status --bulk-download-qa` | `ERROR: 余分な引数: --bulk-download-qa` | 2 |

v0.23.x では、処理を選ぶフラグが 2 つ以上あると決まった順で最初の 1 つだけを行い（上の 1 行目は投入だけを行った）、受け付けないフラグは黙って使わず、処理を選ぶフラグが無ければ MCP サーバーとして起動した（#106）。houki-egov-mcp の SPEC-EGOV-CLI-ENTRY-009 と同じ文である。v0.24.x には `--status` が無く、`houki-nta-mcp --status` は `ERROR: 未知のフラグ: --status` で終了コード 2 だった。

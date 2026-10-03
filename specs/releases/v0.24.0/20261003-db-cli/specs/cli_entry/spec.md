# 差分: cli_entry（20261003-db-cli）

`specs/current/cli_entry/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える（見出しの行の題も置き換える）
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 冒頭の「関連する Issue」の末尾に `、#106（引数の検査と --version の文。0.24.0）` を足す
- 「入力」の表の上の文「フラグはすべて `--名前` または `--名前=値` の形で、値は `=` で続ける（`--db-path /path` のように空白で分けた形は受け付けない）。フラグの並び順は問わない。」の後に「フラグは、処理を選ぶフラグ（`--help`・`--version`・`--quickstart`・`--bulk-download*`・`--refresh-stale=<日数>`・`--health-check`・`--check-baseline-drift`）を 1 つと、その処理と一緒に使えるフラグ（SPEC-NTA-CLI-ENTRY-007 の表）だけを受け付ける。それ以外の引数は SPEC-NTA-CLI-ENTRY-006・007 のエラーにする。」を足す
- 「入力」の表の `--version` / `-v` の行の内容を「`<パッケージ名> v<版>` を標準出力に出して終わる」にする。`--db-path=<path>` の行の内容の先頭に「投入と `--refresh-stale` だけで使う。」を足す
- 「処理の流れ」の図を次に置き換える

```mermaid
flowchart TD
  A["houki-nta-mcp を実行"] --> Z{"引数があるか"}
  Z -- 無い --> S["MCP サーバーとして標準入出力で待ち受ける（001）"]
  Z -- ある --> B{"すべての引数の形が正しいか（006）"}
  B -- "- で始まらない引数・知らないフラグ・値の無いフラグ" --> E1["エラーと使い方を出して exit 2（006）"]
  B -- 正しい --> V{"フラグの値が正しいか（008）"}
  V -- "税目・通達名・日数に誤り" --> E2["値のエラーを出して exit 2（008。SPEC-NTA-CLI-BULK-DOWNLOAD-010・011、SPEC-NTA-CLI-REFRESH-006）"]
  V -- 正しい --> C{"処理を選ぶフラグが 1 つで、ほかのフラグをその処理が受け付けるか（007）"}
  C -- "処理のフラグが無い・2 つ以上・受け付けないフラグがある" --> E3["エラーと使い方を出して exit 2（007）"]
  C -- "--help / -h" --> H["使い方を標準出力に出して終わる（002）"]
  C -- "--version / -v" --> VV["<パッケージ名> v<版> を出して終わる（003）"]
  C -- "そのほかの処理のフラグ" --> O["その処理をして終わる（cli_bulk_download / cli_refresh / cli_health_check）"]
```

- 「できないこと」の「処理を選ぶフラグを 2 つ以上同時に実行すること（上の順で最初の 1 つだけを行う。`--bulk-download-qa --health-check` は投入だけを行う）」を「処理を選ぶフラグを 2 つ以上同時に実行すること（SPEC-NTA-CLI-ENTRY-007 のエラーにする）」にする。「MCP サーバーに CLI のフラグで DB の場所を渡すこと（MCP サーバーの DB の場所は環境変数 `HOUKI_NTA_DB_PATH` / `XDG_CACHE_HOME` だけで決まる。`--db-path=<path>` だけを渡すと SPEC-NTA-CLI-ENTRY-007 のエラー）」を足す
- 「未決」の 1・2（→ #106）の行を消す。3（処理を選ぶフラグを複数渡したときの優先順）は、優先順が無くなる（SPEC-NTA-CLI-ENTRY-007）ので消す

## MODIFIED

### SPEC-NTA-CLI-ENTRY-003 `--version` と `-v` は `<パッケージ名> v<版>` の 1 行を出して終わる

`--version` または `-v` だけを渡したときは、`<パッケージ名> v<版>` の 1 行（例: `@shuji-bonji/houki-nta-mcp v0.24.0`）を標準出力に出し、ほかの処理をせずに終了コード 0 で終わる。houki-egov-mcp の SPEC-EGOV-CLI-ENTRY-003 と同じ形である（v0.23.x までは版の数字だけ、例: `0.23.0`。#106）。ほかの引数と一緒に渡したときは SPEC-NTA-CLI-ENTRY-007 のエラーにする。

### SPEC-NTA-CLI-ENTRY-004 `--db-path=<path>` で、投入と `--refresh-stale` が使う DB ファイルを指定できる

`--db-path=<path>` を投入のフラグ（`--quickstart`・`--bulk-download*`）か `--refresh-stale=<日数>` と一緒に付けると、その処理は環境変数によらずそのパスの DB を使う。`:memory:` を渡すとファイルを作らない一時的な DB になる。例: `--bulk-download --tsutatsu=所得税基本通達 --db-path=/tmp/cache.db` は、`/tmp/cache.db` に所得税基本通達を投入する。

`--db-path=<path>` だけを渡したとき、または DB を使わない処理（`--health-check`・`--check-baseline-drift`・`--help`・`--version`）と一緒に渡したときは、SPEC-NTA-CLI-ENTRY-007 のエラーにする。MCP サーバーの DB の場所は `--db-path` では変わらない（v0.23.x までは `--db-path=<path>` だけを渡すと MCP サーバーが起動し、そのパスは使わなかった。#106）。`--db-path=`（値が空）は SPEC-NTA-CLI-ENTRY-006 の値の無いフラグのエラーにする。

### SPEC-NTA-CLI-ENTRY-005 `--help` はほかの引数と一緒に渡すとエラーにし、値の誤りがあれば値のエラーを先に出す

`--help` / `-h` は、それだけを渡したときに使い方を出して終了コード 0 で終わる（SPEC-NTA-CLI-ENTRY-002）。ほかの引数と一緒に渡したときは、使い方を出さずに次のエラーにする。

- ほかの引数の形が誤っていれば SPEC-NTA-CLI-ENTRY-006 のエラー（終了コード 2）
- 値に誤りがあれば SPEC-NTA-CLI-ENTRY-008 の値のエラー（終了コード 2）。例: `--help --qa-topic=zzz` は `[houki-nta-mcp] --qa-topic="zzz" は使えません。使える値: …` を出して終了コード 2
- 値が正しければ SPEC-NTA-CLI-ENTRY-007 の余分な引数のエラー（終了コード 2）。例: `--help --version` は `ERROR: 余分な引数: --version`

値のエラーは、使える値の一覧を文に含むので、使い方を見なくても正しい値を確かめられる（v0.23.x までは `--help --qa-topic=zzz` は値の誤りを報告せずに使い方を出し、終了コード 0 だった。#106）。

## ADDED

### SPEC-NTA-CLI-ENTRY-006 形の誤った引数は、何もせずにエラーと使い方を出して exit 2

引数を前から順に見て、次のどれかに当たる最初の引数があれば、そのことを標準エラー出力に出し、続けて使い方（SPEC-NTA-CLI-ENTRY-002 と同じ文。下の値の無いフラグを除く）を標準出力に出して、終了コード 2 で終わる。DB を開かず、国税庁サイトに接続せず、MCP サーバーも起動しない。

| 引数 | 標準エラー出力 |
| --- | --- |
| `-` で始まらない（`status`・`/path` など） | `ERROR: 未知の引数: <引数>` |
| `-` で始まり、入力の表のどのフラグでもない（打ち間違い、`-x`、値を取らないフラグに `=` を付けたもの。例: `--bulk-downlod`、`--refresh=1`） | `ERROR: 未知のフラグ: <フラグ>`（`=` 以降も含めて出す） |
| 値を取るフラグ（`--db-path`・`--tsutatsu`・`--bunsho-taxonomy`・`--tax-answer-taxonomy`・`--qa-topic`・`--refresh-stale`）に `=` が無い、または `=` の後が空 | `ERROR: <フラグ> は値を必要とします（<フラグ>=<値> の形で指定してください）` |

例:

| 実行 | 標準エラー出力 | 終了コード |
| --- | --- | --- |
| `houki-nta-mcp --bulk-downlod` | `ERROR: 未知のフラグ: --bulk-downlod` | 2 |
| `houki-nta-mcp --db-path /tmp/x.db --bulk-download` | `ERROR: --db-path は値を必要とします（--db-path=<値> の形で指定してください）` | 2 |
| `houki-nta-mcp status` | `ERROR: 未知の引数: status` | 2 |
| `houki-nta-mcp --refresh-stale` | `ERROR: --refresh-stale は値を必要とします（--refresh-stale=<値> の形で指定してください）` | 2 |

値を取るフラグに値が無いときだけは、使い方を出さない（houki-egov-mcp の SPEC-EGOV-CLI-BULK-DOWNLOAD-001 で日付が無いときと同じ）。

v0.23.x では、上の引数を読み飛ばし、処理を選ぶフラグが残らなければ MCP サーバーとして起動して標準入力を待ち続けた（#106）。houki-egov-mcp の SPEC-EGOV-CLI-ENTRY-004・008 と同じ文である。

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
| `--health-check`、`--check-baseline-drift` | `--strict` |

例:

| 実行 | 標準エラー出力 | 終了コード |
| --- | --- | --- |
| `houki-nta-mcp --bulk-download-qa --health-check` | `ERROR: 余分な引数: --health-check` | 2 |
| `houki-nta-mcp --bulk-download-all --tsutatsu=所得税基本通達` | `ERROR: 余分な引数: --tsutatsu=所得税基本通達` | 2 |
| `houki-nta-mcp --refresh-stale=30 --refresh` | `ERROR: 余分な引数: --refresh` | 2 |
| `houki-nta-mcp --apply` | `ERROR: 処理を選ぶフラグがありません（--apply だけでは何もしません）` | 2 |
| `houki-nta-mcp --db-path=/tmp/x.db` | `ERROR: 処理を選ぶフラグがありません（--db-path=/tmp/x.db だけでは何もしません）` | 2 |

v0.23.x では、処理を選ぶフラグが 2 つ以上あると決まった順で最初の 1 つだけを行い（上の 1 行目は投入だけを行った）、受け付けないフラグは黙って使わず、処理を選ぶフラグが無ければ MCP サーバーとして起動した（#106）。houki-egov-mcp の SPEC-EGOV-CLI-ENTRY-009 と同じ文である。

### SPEC-NTA-CLI-ENTRY-008 引数の検査は「形 → 値 → 組み合わせ」の順に行い、値の誤りはすべてを並べて exit 2

引数は、形（SPEC-NTA-CLI-ENTRY-006）、値（下の表）、組み合わせ（SPEC-NTA-CLI-ENTRY-007）の順に確かめる。形の誤りがあれば値と組み合わせは確かめない。値の誤りがあれば組み合わせは確かめない。

値の誤りは、誤った値 1 つにつき 1 行を標準エラー出力にすべて出し（使い方は出さない）、終了コード 2 で終わる。DB を開かず、国税庁サイトに接続せず、MCP サーバーも起動しない。

| フラグ | 正しい値 | 文 |
| --- | --- | --- |
| `--bunsho-taxonomy`・`--tax-answer-taxonomy`・`--qa-topic` | 各フラグの一覧の値（SPEC-NTA-CLI-BULK-DOWNLOAD-008） | SPEC-NTA-CLI-BULK-DOWNLOAD-010 |
| `--tsutatsu` | 基本通達 4 種の正式名 | SPEC-NTA-CLI-BULK-DOWNLOAD-011 |
| `--refresh-stale` | 0 以上の整数（数字だけ） | SPEC-NTA-CLI-REFRESH-006 |

引数の誤りの終了コードは 2、処理の失敗（DB を開けない、DB の版が合わない。SPEC-NTA-DB-SCHEMA-021）は 1 に分ける。houki-egov-mcp の 0.19.0 と同じ分け方である。

例: `houki-nta-mcp --bulk-download-everything --qa-topic=zzz --tax-answer-taxonomy=yyy` は、`--qa-topic="zzz"` と `--tax-answer-taxonomy="yyy"` の 2 行をこの引数の順に出して終了コード 2。`houki-nta-mcp --bulk-downlod --qa-topic=zzz` は形の誤りが先なので `ERROR: 未知のフラグ: --bulk-downlod` だけを出す。

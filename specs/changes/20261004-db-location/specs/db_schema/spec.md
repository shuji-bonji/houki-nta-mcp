# 差分: db_schema（20261004-db-location）

`specs/current/db_schema/spec.md` に対する差分です。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- `MODIFIED` は、見出しの行（題）も含めて、current の同じ ID の見出しと本文をこの差分の見出しと本文に置き換える
- 冒頭の「関連する Issue」の末尾に `、#138（DB の場所の見え方。0.25.0）、#137（保存したタックスアンサーの索引を読めないとき。0.25.0）` を足す
- 「入力」の表に、CLI `--status` の行（`任意`、`DB を作らず、移行もしない。読むだけ（SPEC-NTA-DB-SCHEMA-021、cli_status の spec.md）`）を、CLI `--refresh-stale=<日数>` の行の後に足す
- 「処理の流れ」の図の `C2["作らない。入口ごとの扱い（021）"]` は変えない。`F["既存の行を保ったまま 1 段ずつ移行し、12 にする（006〜014・019・022）"]` の箱の文を `既存の行を保ったまま 1 段ずつ移行し、12 にする（006〜014・019・022）。--status は移行しない（021）` にする
- 「できないこと」に次の 1 行を足す: `既定のファイル名（cache.db）に DB の版を入れること（houki-hub DECISIONS.md 2026-10-04 の T6 の (f)。版 3〜11 は行を保って移行するので、ファイル名を変えると利用者がファイルをコピーすることになる。開発で版を上げるときは HOUKI_NTA_DB_PATH か --db-path で別のファイルを使う）`
- 「未決」の 1（DB の置き場所と環境変数）の末尾に `場所を決めた設定の名前と絶対パスは SPEC-NTA-DB-SCHEMA-026 で決めた。置き場所のフォルダーを作ることと、空文字の扱いのテストは、引き続き無い。` を足す

## ADDED

### SPEC-NTA-DB-SCHEMA-026 DB の場所を決めた設定を 4 つの名前で表し、表示と案内には DB の絶対パスを使う

DB の場所を決めた設定を、次の 4 つの名前で表す。CLI の `--status`（SPEC-NTA-CLI-STATUS-001）、MCP サーバーの起動時のログ（SPEC-NTA-CLI-ENTRY-009）、ツールの `hint`（SPEC-NTA-DB-SCHEMA-029、021 の注 2）、`freshness.db_path`（SPEC-NTA-SEARCH-RULES-022）、案内のコマンド（SPEC-NTA-DB-SCHEMA-027）は、同じ名前と同じ判定を使う。

| 設定の名前 | 当てはまるとき |
| --- | --- |
| `--db-path` | CLI の処理に `--db-path=<path>` を付けた（SPEC-NTA-CLI-ENTRY-004）。MCP サーバーは `--db-path` を受け取らないので、MCP サーバーでは当てはまらない |
| `HOUKI_NTA_DB_PATH` | `--db-path` が無く、環境変数 `HOUKI_NTA_DB_PATH` に空でない値がある |
| `XDG_CACHE_HOME` | 上の 2 つが無く（`HOUKI_NTA_DB_PATH` が空文字のときを含む）、`XDG_CACHE_HOME` に空でない値がある。DB の場所は `$XDG_CACHE_HOME/houki-nta-mcp/cache.db` |
| `既定` | どれも無いか空文字。DB の場所は `~/.cache/houki-nta-mcp/cache.db` |

「DB の絶対パス」は、DB の場所を絶対パスにしたもの。`--db-path`・`HOUKI_NTA_DB_PATH`・`XDG_CACHE_HOME` が相対パスのときは、その処理（CLI の実行、または MCP サーバー）を始めたときの作業フォルダーから絶対パスにする（SQLite がそのファイルを開くのと同じ場所）。`:memory:`（SPEC-NTA-CLI-ENTRY-004）は絶対パスにせず `:memory:` のままにする。

MCP サーバーの起動時のログ、`freshness.db_path` と `hint` の中のパス（ホームディレクトリの部分は `~`。SPEC-NTA-DB-SCHEMA-028）、案内のコマンドに付けるパスは、この絶対パスを元にする。CLI の `DB: ` の行（`[bulk-download-qa] DB: …`・`[refresh-stale] DB: …`・`--status` の 2 行目など）と、CLI のエラーの文の `<DB の場所>`（SPEC-NTA-DB-SCHEMA-021）は今までどおり、`--db-path` や `HOUKI_NTA_DB_PATH` の値をそのまま出す。

例: `HOUKI_NTA_DB_PATH=dev/cache.db` を付けて `/Users/bonji/work` で MCP サーバーを起動すると、設定の名前は `HOUKI_NTA_DB_PATH`、DB の絶対パスは `/Users/bonji/work/dev/cache.db`。同じ値で `--status` を実行すると 2 行目は `  DB: dev/cache.db`、3 行目は `  DB の場所の設定: HOUKI_NTA_DB_PATH（…）`。`--db-path=/tmp/x.db` と `HOUKI_NTA_DB_PATH=/tmp/y.db` を両方付けて `--bulk-download-qa` を実行すると、設定の名前は `--db-path`、DB の絶対パスは `/tmp/x.db`（`--db-path` が先。SPEC-NTA-CLI-ENTRY-004）。`HOUKI_NTA_DB_PATH` が空文字で `XDG_CACHE_HOME=/data/cache` なら、設定の名前は `XDG_CACHE_HOME`、DB の絶対パスは `/data/cache/houki-nta-mcp/cache.db`。

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
| MCP の応答 | `next_actions[]` のうち `action: "cli_bulk_download"` の `example.command` | SPEC-NTA-DB-SCHEMA-029、SPEC-NTA-COMMON-ERRORS-017、SPEC-NTA-GET-TSUTATSU-007・010 |
| MCP の応答 | 「DB に 1 件も無い」ときの `hint` と、版の合わない DB の `hint` の中のコマンド | SPEC-NTA-DB-SCHEMA-029、021 の注 2 |
| MCP の応答 | 税目を絞って追加する案内のコマンド | SPEC-NTA-SEARCH-QA-005、SPEC-NTA-SEARCH-BUNSHOKAITOU-002 |
| MCP の応答 | 「DB を投入した後に公開された文書は、`<コマンド>` をもう一度実行すると取り込めます」 | SPEC-NTA-GET-KAISEI-TSUTATSU-002、SPEC-NTA-GET-JIMU-UNEI-002、SPEC-NTA-GET-BUNSHOKAITOU-003 |
| MCP の応答 | 取得時点を読めないときの `hint` | SPEC-NTA-COMMON-ERRORS-017 |
| MCP の応答 | `nta_get_tsutatsu` の `hint` の `houki-nta-mcp --bulk-download --tsutatsu="<正式名>"`（DB にもライブ取得にも無い通達、候補ページに条項が無いとき） | SPEC-NTA-GET-TSUTATSU-007・010 |
| MCP の応答 | `freshness.warning` の中のコマンド | SPEC-NTA-SEARCH-RULES-017 |
| CLI の出力 | SPEC-NTA-DB-SCHEMA-021 の CLI のエラーの文の中のコマンド、`--status` の `(DB がまだありません — …)` の行 | SPEC-NTA-DB-SCHEMA-021、SPEC-NTA-CLI-STATUS-004 |

CLI の出力でも同じ形にする（CLI を `HOUKI_NTA_DB_PATH=… npx …` のように 1 回だけ変数を付けて実行した人や、`--db-path` を付けて実行した人が、案内のコマンドをそのまま実行して同じ DB を開けるようにするため）。

次の箇所はこの形にしない: `--help` の使い方（SPEC-NTA-CLI-ENTRY-002）、SPEC-NTA-DB-SCHEMA-029 の「投入したシェルで `npx -y @shuji-bonji/houki-nta-mcp@latest --status` を実行し」（MCP サーバーの設定ではなく、投入したシェルの設定で開く DB を確かめるためのコマンドなので、変数も `--db-path` も付けない）、`--quickstart` が終わった後の「次に試すこと」の行（SPEC-NTA-CLI-BULK-DOWNLOAD-007）、tools/list のツールの説明（フラグだけを書いている）、フラグだけを書いた文（`nta_get_tsutatsu` の `ARTICLE_NOT_FOUND` の `` `--bulk-download` で再取得してください``、SPEC-NTA-INSPECT-PDF-META-001 の DB はあるがその文書が無いときの `hint`、SPEC-NTA-DB-SCHEMA-021 の CLI のエラーの文の `か --bulk-download-all で作ってください` の `--bulk-download-all`）。

例（ホームディレクトリが `/Users/bonji`）:

| 起動・実行したときの設定 | `--bulk-download-qa` の案内のコマンド |
| --- | --- |
| 環境変数なし | `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` |
| `HOUKI_NTA_DB_PATH=/Users/bonji/.cache/houki-nta-mcp/cache.dev.db` | `HOUKI_NTA_DB_PATH="$HOME/.cache/houki-nta-mcp/cache.dev.db" npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` |
| `HOUKI_NTA_DB_PATH=/tmp/x/cache.db` | `HOUKI_NTA_DB_PATH='/tmp/x/cache.db' npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` |
| `XDG_CACHE_HOME=/Users/bonji/Library/Caches` | `XDG_CACHE_HOME="$HOME/Library/Caches" npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` |
| CLI に `--db-path=/Users/bonji/dev$1/cache.db`（`'…'` で囲んで渡す） | `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa --db-path="$HOME"'/dev$1/cache.db'` |

v0.24.x のコマンドは、どの場合も `houki-nta-mcp --bulk-download-qa`（グローバルにインストールしていないと `command not found`、`npx houki-nta-mcp` は npm に無い名前で 404。houki-egov-mcp #108 の 2 と同じ）。

### SPEC-NTA-DB-SCHEMA-028 MCP の応答に出す DB のパスは、ホームディレクトリの部分を `~` に置き換える

MCP の応答に入れるローカル DB のパス（`freshness.db_path`（SPEC-NTA-SEARCH-RULES-022）と、`hint` の中の `<パス>`（SPEC-NTA-DB-SCHEMA-029、021 の注 2））は、次の規則で書く。案内のコマンドの中のパスはこの規則ではなく SPEC-NTA-DB-SCHEMA-027 に従う。

1. 元にするのは DB の絶対パス（SPEC-NTA-DB-SCHEMA-026）
2. MCP サーバーのホームディレクトリ（Node.js の `os.homedir()` の値。macOS と Linux では環境変数 `HOME`）と同じ文字列なら `~` にする。ホームディレクトリの後ろに `/` が続くときは、その前の部分を `~` に置き換える
3. 区切りの位置で比べる。ホームディレクトリが `/Users/bonji` のとき、`/Users/bonji2/cache.db` は置き換えない
4. ホームディレクトリが空文字か `/` のときは置き換えない
5. 文字列のまま比べる。大文字と小文字は区別し、シンボリックリンクはたどらない

CLI の出力（`DB: ` の行と CLI のエラーの文）と MCP サーバーの起動時のログ（SPEC-NTA-CLI-ENTRY-009）は、この規則を使わない（利用者の端末にしか出ないため）。

例: ホームディレクトリが `/Users/bonji` のとき、`/Users/bonji/.cache/houki-nta-mcp/cache.db` は `~/.cache/houki-nta-mcp/cache.db`、`/tmp/x/cache.db` と `/Users/bonji2/cache.db` はそのまま。

### SPEC-NTA-DB-SCHEMA-029 読むだけのツールの「DB に 1 件も無い」ときの `hint` は、DB の状態ごとに先頭の文を決め、開こうとしたパスを入れる

読むだけのツール（SPEC-NTA-DB-SCHEMA-021 の入口の分け方）が「DB に 1 件も無い」ときの応答（021 の注 1）を返すとき、`hint` は DB の状態ごとに次の表の文にする。`code`・`error`・`next_actions` の `action` は変えない。`<パス>` は開こうとした DB のパス（SPEC-NTA-DB-SCHEMA-028 の形）、`<コマンド>` は下の表のフラグを付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027。`HOUKI_NTA_DB_PATH` などで DB の場所を決めて起動したときは、その変数を前に付けた形）、`<種別>` は下の表の名前。

| DB の状態 | `hint` |
| --- | --- |
| ファイルが無い（DB の場所の設定が `既定` か `XDG_CACHE_HOME`） | ``ローカル DB（<パス>）がありません。`<コマンド>` で<種別>を投入してください`` |
| ファイルが無い（DB の場所の設定が `HOUKI_NTA_DB_PATH`） | ``HOUKI_NTA_DB_PATH が指すファイル（<パス>）がありません。HOUKI_NTA_DB_PATH を投入した DB のファイルに直すか、`<コマンド>` でこのパスに<種別>を投入してください`` |
| ファイルはあるが版の記録が無い（0 バイトのファイル、`schema_meta` の無い SQLite のファイル） | ``ローカル DB（<パス>）にはまだ何も投入されていません。`<コマンド>` で<種別>を投入してください`` |
| 版が古い・新しい・読めない | SPEC-NTA-DB-SCHEMA-021 の注 2 の文 |
| DB は使えるが、その種別が 1 件も無い（他の種別だけがある DB を含む） | 文書系の 8 ツール（`nta_search_tsutatsu`・`nta_inspect_pdf_meta` を除く）は ``ローカル DB（<パス>）に<種別>（doc_type="<doc_type>"）が入っていません。`<コマンド>` で投入してください。投入したはずの場合は、投入したシェルで `npx -y @shuji-bonji/houki-nta-mcp@latest --status` を実行し、表示される DB がこの DB と同じか確かめてください（MCP クライアントから起動したサーバーは、シェルの環境変数 HOUKI_NTA_DB_PATH・XDG_CACHE_HOME を受け継がないことがあります）``。`nta_search_tsutatsu` は SPEC-NTA-SEARCH-TSUTATSU-003、`nta_inspect_pdf_meta` は SPEC-NTA-INSPECT-PDF-META-001 の文 |

| ツール | `<種別>` | フラグ | 「DB に 1 件も無い」ときの応答 |
| --- | --- | --- | --- |
| `nta_search_tsutatsu` | 基本通達 | `--bulk-download-all` | SPEC-NTA-SEARCH-TSUTATSU-003 |
| `nta_search_qa` | 質疑応答事例 | `--bulk-download-qa` | SPEC-NTA-SEARCH-QA-001 |
| `nta_search_tax_answer` | タックスアンサー | `--bulk-download-tax-answer` | SPEC-NTA-SEARCH-TAX-ANSWER-001 |
| `nta_search_kaisei_tsutatsu`・`nta_get_kaisei_tsutatsu` | 改正通達 | `--bulk-download-kaisei` | SPEC-NTA-SEARCH-KAISEI-TSUTATSU-001、SPEC-NTA-GET-KAISEI-TSUTATSU-001 |
| `nta_search_jimu_unei`・`nta_get_jimu_unei` | 事務運営指針 | `--bulk-download-jimu-unei` | SPEC-NTA-SEARCH-JIMU-UNEI-001、SPEC-NTA-GET-JIMU-UNEI-001 |
| `nta_search_bunshokaitou`・`nta_get_bunshokaitou` | 文書回答事例 | `--bulk-download-bunshokaitou` | SPEC-NTA-SEARCH-BUNSHOKAITOU-001、SPEC-NTA-GET-BUNSHOKAITOU-002 |
| `nta_inspect_pdf_meta` | `docType` の種別（`kaisei` は改正通達、`jimu-unei` は事務運営指針、`bunshokaitou` は文書回答事例、`tax-answer` はタックスアンサー、`qa-jirei` は質疑応答事例） | `docType` の投入のフラグ（`qa-jirei` は `--bulk-download-qa`、ほかは `--bulk-download-<docType>`） | SPEC-NTA-INSPECT-PDF-META-001 |

`next_actions` の `cli_bulk_download` の `example.command` は、どの状態でも上の `<コマンド>`。版が新しい・読めない DB では、今までどおり `cli_bulk_download` を入れない（021）。

DB を開けない（SQLite でないファイル、フォルダー、パスの途中が普通のファイル、権限が無い）ときは、この差分では変えない（今までどおり SPEC-NTA-COMMON-ERRORS-006 の `INTERNAL_ERROR`）。

例（ホームディレクトリが `/Users/bonji`）:

- 環境変数を付けずに起動し、`~/.cache/houki-nta-mcp/cache.db` が無いときに `nta_search_qa { keyword: "社内会議" }` を呼ぶと、`code: "DOC_NOT_FOUND"`、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` で質疑応答事例を投入してください``、`next_actions[0].example.command` は `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa`（v0.24.x では `hint` が `MCP サーバーが開いている DB（/Users/bonji/.cache/houki-nta-mcp/cache.db）に質疑応答事例（doc_type="qa-jirei"）が入っていません。…` で、ファイルがあるかどうかを区別せず、コマンドは `houki-nta-mcp --bulk-download-qa`）
- `HOUKI_NTA_DB_PATH=/Users/bonji/.cache/houki-nta-mcp/cache.v12.db` で起動し、そのファイルが無いときに `nta_get_jimu_unei { docId: "shotoku/000101" }` を呼ぶと、`hint` は ``HOUKI_NTA_DB_PATH が指すファイル（~/.cache/houki-nta-mcp/cache.v12.db）がありません。HOUKI_NTA_DB_PATH を投入した DB のファイルに直すか、`HOUKI_NTA_DB_PATH="$HOME/.cache/houki-nta-mcp/cache.v12.db" npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-jimu-unei` でこのパスに事務運営指針を投入してください``
- 0 バイトの `cache.db` で `nta_search_tsutatsu { keyword: "役員" }` を呼ぶと、`code: "TSUTATSU_NOT_FOUND"`、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）にはまだ何も投入されていません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-all` で基本通達を投入してください``
- 環境変数を付けずに起動し、タックスアンサーだけを入れた版 12 の DB で `nta_search_qa { keyword: "社内会議" }` を呼ぶと、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）に質疑応答事例（doc_type="qa-jirei"）が入っていません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` で投入してください。投入したはずの場合は、投入したシェルで `npx -y @shuji-bonji/houki-nta-mcp@latest --status` を実行し、…`` で始まる（v0.24.x では ``MCP サーバーが開いている DB（/Users/bonji/.cache/houki-nta-mcp/cache.db）に質疑応答事例（doc_type="qa-jirei"）が入っていません。`houki-nta-mcp --bulk-download-qa` で投入してください。…``）
- 質疑応答事例が 1 件も無い DB（版 12）で `nta_inspect_pdf_meta { docType: "qa-jirei", docId: "shohi/02/19" }` を呼ぶと、DB はあるので SPEC-NTA-INSPECT-PDF-META-001 の文。ファイルが無いときは ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` で質疑応答事例を投入してください``

## MODIFIED

### SPEC-NTA-DB-SCHEMA-021 DB の状態と入口ごとの扱い

DB を開く入口は、DB の状態によって次のように扱う。「版」は `schema_meta` の `schema_version` の値で、v0.25.0 の版は 12。入口は次の 6 つに分ける。

- 投入: CLI の `--quickstart`・`--bulk-download`・`--bulk-download-all`・`--bulk-download-kaisei`・`--bulk-download-jimu-unei`・`--bulk-download-bunshokaitou`・`--bulk-download-tax-answer`・`--bulk-download-qa`・`--bulk-download-everything`
- 取り直し: CLI の `--refresh-stale=<日数> --apply`
- 一覧: CLI の `--refresh-stale=<日数>`（`--apply` なし）
- 確かめる: CLI の `--status`（cli_status の spec.md）
- 読むだけのツール: `nta_search_tsutatsu`・`nta_search_kaisei_tsutatsu`・`nta_search_jimu_unei`・`nta_search_bunshokaitou`・`nta_search_tax_answer`・`nta_search_qa`・`nta_get_kaisei_tsutatsu`・`nta_get_jimu_unei`・`nta_get_bunshokaitou`・`nta_inspect_pdf_meta`
- 書き戻すツール: `nta_get_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer`（国税庁サイトから取った条項・事例・記事と、目次・タックスアンサーの索引を DB に書く）

`--health-check`・`--check-baseline-drift`・`--help`・`--version` と `resolve_abbreviation` は DB を開かない。

| DB の状態 | 投入 | 取り直し | 一覧 | 確かめる | 読むだけのツール | 書き戻すツール |
| --- | --- | --- | --- | --- | --- | --- |
| ファイルが無い（置き場所のフォルダーも無いときを含む） | フォルダーとファイルを作り、テーブルを作って版 12 を記録し、取り込む（001） | 作らない。DB が無いエラーで終了コード 1 | 作らない。DB が無いことを標準エラー出力に出し、標準出力に `[]` を出して終了コード 0 | 作らない。DB が無いことを出して終了コード 0（SPEC-NTA-CLI-STATUS-004） | 作らない。各ツールの「DB に 1 件も無い」ときの応答（注 1）を返し、`hint` は SPEC-NTA-DB-SCHEMA-029 のファイルが無いときの文 | 国税庁サイトから取る。取れたら、フォルダーとファイルを作り、テーブルを作って版 12 を記録し、書き戻す |
| ファイルはあるが版の記録が無い（0 バイトのファイル、`schema_meta` の無い SQLite のファイル） | テーブルを作り、版 12 を記録して取り込む | 書き込まない。ファイルが無いときと同じ | 書き込まない。ファイルが無いときと同じ | 書き込まない。ファイルが無いときと同じ | 書き込まない。注 1 の応答で、`hint` は SPEC-NTA-DB-SCHEMA-029 の版の記録が無いときの文 | 国税庁サイトから取って返す。DB には書かない |
| 版が同じ（12） | 取り込む | 取り直す | 列挙する | 件数を出す（SPEC-NTA-CLI-STATUS-003） | 引く | 引き、無ければ取って書き戻す |
| 版が古く、移行できる（3〜11） | 行を保ったまま 12 に移行してから取り込む（006〜014・019・022） | 移行してから取り直す | 移行してから列挙する | 移行しない。書き込まない。版と、次に開く入口が移行することを出して終了コード 0（SPEC-NTA-CLI-STATUS-005） | 移行してから引く | 移行してから引き、書き戻す |
| 版が古く、移行できない（1・2） | 国税庁サイトを取りに行く前に、標準エラー出力に `  DB の版 (<DB の版>) は移行できないため、作り直します（取り込んだ中身は消えます）` を出し、全テーブルを消して版 12 で作り直してから取り込む | 書き込まない。古い版のエラーで終了コード 1 | 書き込まない。古い版のエラーで終了コード 1 | 書き込まない。古い版のエラーで終了コード 1（SPEC-NTA-CLI-STATUS-006） | 書き込まない。注 1 の応答の `hint` を注 2 の古い版の文にする | 国税庁サイトから取って返す。DB には書かない |
| 版が新しい（13 以上の整数） | 国税庁サイトを取りに行く前に止める。新しい版のエラーで終了コード 1 | 書き込まない。新しい版のエラーで終了コード 1 | 書き込まない。新しい版のエラーで終了コード 1 | 書き込まない。新しい版のエラーで終了コード 1（SPEC-NTA-CLI-STATUS-006） | 書き込まない。注 1 の応答の `hint` を注 2 の新しい版の文にし、`next_actions` に投入の案内を入れない | 国税庁サイトから取って返す。DB には書かない |
| 版を読めない（10 進の整数の文字列でない値。`abc`・空文字・`12abc` など） | 国税庁サイトを取りに行く前に止める。読めない版のエラーで終了コード 1 | 書き込まない。読めない版のエラーで終了コード 1 | 書き込まない。読めない版のエラーで終了コード 1 | 書き込まない。読めない版のエラーで終了コード 1（SPEC-NTA-CLI-STATUS-006） | 書き込まない。注 1 の応答の `hint` を注 2 の読めない版の文にし、`next_actions` に投入の案内を入れない | 国税庁サイトから取って返す。DB には書かない |
| 開けない（SQLite でないファイル、フォルダー、パスの途中が普通のファイル、権限が無い） | 国税庁サイトを取りに行く前に止める。`[ERROR] DB を開けません: <エラーの文>` で終了コード 1 | 同じ文で終了コード 1 | 同じ文で終了コード 1 | 同じ文で終了コード 1（SPEC-NTA-CLI-STATUS-007） | この差分では変えない | この差分では変えない |

「DB には書かない」「書き込まない」は、ファイル・フォルダー・テーブル・`schema_meta` を作らず、行も書かないことをいう（SQLite が `-wal` / `-shm` のファイルを置くことはある）。国税庁サイトから取った応答の中身は、DB に書いたときと同じである。

「確かめる」入口だけは、版 3〜11 の DB も移行しない。`--status` は DB の場所と中身を確かめるための入口で、確かめただけで DB を書き換えないためである。移行は、次にほかの入口（投入・取り直し・一覧・読むだけのツール・書き戻すツール）が開いたときに行う（houki-hub DECISIONS.md 2026-10-04 の houki-nta-mcp 0.24.0 の (2) は、この入口を除いて当てはまる）。

注 1（読むだけのツールの「DB に 1 件も無い」ときの応答）: `nta_search_tsutatsu` は SPEC-NTA-SEARCH-TSUTATSU-003 の `TSUTATSU_NOT_FOUND`、ほかの検索ツールはその種別の文書が 1 件も無いときの `DOC_NOT_FOUND`、`nta_get_kaisei_tsutatsu`・`nta_get_jimu_unei`・`nta_get_bunshokaitou` は SPEC-NTA-GET-KAISEI-TSUTATSU-001・SPEC-NTA-GET-JIMU-UNEI-001・SPEC-NTA-GET-BUNSHOKAITOU-002、`nta_inspect_pdf_meta` は SPEC-NTA-INSPECT-PDF-META-001。`code` は変えない。

注 2（読むだけのツールの `hint` の文。`<パス>` は MCP サーバーが開いた DB のパス（SPEC-NTA-DB-SCHEMA-028 の形）、`<--quickstart のコマンド>` は `--quickstart` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027））:

| 場面 | `hint` |
| --- | --- |
| 古い版（1・2） | ``ローカル DB（<パス>）の版 (<DB の版>) は古く移行できないため、使っていません。`<--quickstart のコマンド>` などの投入のフラグを実行すると作り直します（取り込んだ中身は消えます）`` |
| 新しい版 | `ローカル DB（<パス>）の版 (<DB の版>) がこの houki-nta-mcp の版 (12) より新しいため、使っていません（DB は変更しません）。houki-nta-mcp を新しい版に更新してください` |
| 読めない版 | ``ローカル DB（<パス>）の版を読めないため (schema_version: <値>)、使っていません（DB は変更しません）。DB ファイルを消してから `<--quickstart のコマンド>` などの投入のフラグを実行してください`` |

CLI のエラーの文は、標準エラー出力に次のとおり出す（`<DB の場所>` は各フラグが出す `DB: ` の行と同じ。`<--quickstart のコマンド>` は SPEC-NTA-DB-SCHEMA-027 の形で、`--db-path` を付けて実行したときは後ろに `--db-path=…` が付く）。

| 場面 | 文 |
| --- | --- |
| DB が無い（取り直し） | `[ERROR] DB がまだありません (<DB の場所>)。<--quickstart のコマンド> か --bulk-download-all で作ってください` |
| DB が無い（一覧） | `[refresh-stale] DB がまだありません (<DB の場所>)。<--quickstart のコマンド> か --bulk-download-all で作ってください` |
| 古い版（1・2） | `[ERROR] DB の版 (<DB の版>) は古く移行できないため使えません。<--quickstart のコマンド> などの投入のフラグを実行すると作り直します（取り込んだ中身は消えます）` |
| 新しい版 | `[ERROR] DB の版 (<DB の版>) がこの houki-nta-mcp の版 (12) より新しいため、DB を変更しません。houki-nta-mcp を新しい版に更新するか、--db-path（MCP サーバーでは HOUKI_NTA_DB_PATH）で別のファイルを指定してください` |
| 読めない版 | `[ERROR] DB の版を読めないため (schema_version: <値>)、DB を変更しません。DB ファイル (<DB の場所>) を消してから <--quickstart のコマンド> などの投入のフラグを実行してください` |

例:

- `schema_version` を `13` に書き換えた DB で `--bulk-download-jimu-unei` を実行すると、国税庁サイトを取りに行かずに新しい版の文を出して終了コード 1 で終わり、`schema_version` は `13` のまま、`document` の行も残る（v0.23.x では全テーブルを消して作り直していた）
- 同じ DB を開いた MCP サーバー（環境変数なし、ホームディレクトリが `/Users/bonji`）で `nta_search_jimu_unei { keyword: "書面添付" }` を呼ぶと、`code: "DOC_NOT_FOUND"` で `hint` は `ローカル DB（~/.cache/houki-nta-mcp/cache.db）の版 (13) がこの houki-nta-mcp の版 (12) より新しいため、…`、DB は変わらない（v0.24.x では `MCP サーバーが開いている DB（/Users/bonji/.cache/houki-nta-mcp/cache.db）の版 (13) が…`）
- DB ファイルの無い場所で `nta_search_qa { keyword: "社内会議" }` を呼んでも、`--refresh-stale=30` を実行しても、`--status` を実行しても、ファイルとフォルダーはできない（v0.23.x までは空の DB ができた）
- DB ファイルの無い場所で `nta_get_tax_answer { no: "6101" }` を呼ぶと、国税庁サイトから記事を返し、DB のファイルができて `document` に `tax-answer`・`6101` の行が入る
- `schema_version` を `abc` に書き換えた DB で `--refresh-stale=30` を実行すると、`[refresh-stale] DB: …` の行の後に読めない版の文を出して終了コード 1（v0.23.x では `UNIQUE constraint failed: schema_meta.key` の例外）
- 環境変数を付けずに、`schema_version` が `2` の DB で `--refresh-stale=30 --apply` を実行すると、`[ERROR] DB の版 (2) は古く移行できないため使えません。npx -y @shuji-bonji/houki-nta-mcp@latest --quickstart などの投入のフラグを実行すると作り直します（取り込んだ中身は消えます）` を出して終了コード 1（v0.24.x では `houki-nta-mcp --quickstart`）。`--db-path=/tmp/old.db` を付けて実行したときのコマンドは `npx -y @shuji-bonji/houki-nta-mcp@latest --quickstart --db-path='/tmp/old.db'`
- `schema_version` が `11` の DB で `--status` を実行すると、`schema_version` は `11` のまま、行も変わらない。その後に `nta_search_qa` を呼ぶと、今までどおり 12 に移行してから引く

### SPEC-NTA-DB-SCHEMA-025 タックスアンサーの索引は tax_answer_index に 1 記事 1 行で保存し、取り直したら置き換える

国税庁のタックスアンサーの索引（`https://www.nta.go.jp/taxes/shiraberu/taxanswer/code/`）を取って読み取れたときは、次の 2 つのテーブルに保存する。

| テーブル | 列 | 内容 |
| --- | --- | --- |
| `tax_answer_index` | `no`（主キー）・`url`・`taxonomy`・`title`（どれも NULL にしない） | 索引の 1 記事につき 1 行。`no` は 4 桁の番号、`url` は記事の URL、`taxonomy` は URL の `taxanswer/` の次の要素（例: `saigai`）、`title` は索引の題名 |
| `tax_answer_index_page` | `url`（主キー）・`fetched_at`（NULL にしない）・`last_modified`・`etag` | 索引のページを取った記録。`last_modified`・`etag` は応答のヘッダーの値（無ければ NULL） |

- 索引を 200 で取って読み取れたときは、`tax_answer_index` の行をすべて、取った索引の行で置き換え、`tax_answer_index_page` の行を書き換える。1 つのトランザクションで行い、途中で失敗したら前の行を残す
- 条件付きの取り直しで 304 が返ったときは、`tax_answer_index_page.fetched_at` だけを書き換え、`tax_answer_index` は変えない
- 索引を読み取れなかったとき（SPEC-NTA-COMMON-ERRORS-009 の索引の解析の失敗）は、どちらのテーブルも変えない
- 書き込むのは `nta_get_tax_answer`（SPEC-NTA-GET-TAX-ANSWER-016）と `--bulk-download-tax-answer`（SPEC-NTA-CLI-BULK-DOWNLOAD-013）
- 保存した索引を「まだ保存していない」とみなすのは、`tax_answer_index_page` に索引の URL の行が無いときだけである。表の列が足りないなど、2 つのテーブルを読む SQL が失敗したときと、`nta_get_tax_answer` の書き込み（置き換え・`fetched_at` の書き換え）が失敗したときは、`nta_get_tax_answer` は応答を失敗にせず、MCP サーバーのログに残す（SPEC-NTA-GET-TAX-ANSWER-018）。`--bulk-download-tax-answer` の書き込みの失敗の扱いは、この差分では変えない

例: 索引の記事が 755 件のときに保存すると、`tax_answer_index` は 755 行で、`8` で始まる番号の行の `taxonomy` は `saigai`。その後に 756 件の索引を保存すると 756 行になり、索引から消えた番号の行は残らない。`tax_answer_index` を `url` の列の無い表に作り替えた DB では、置き換えは始まる前に失敗し、`tax_answer_index_page` の行は前の値のまま残る（SPEC-NTA-GET-TAX-ANSWER-018 の例）。

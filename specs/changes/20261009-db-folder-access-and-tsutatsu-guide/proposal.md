---
approved: 2026-10-09
pr: 160
implementation: required
targets: [cli_status, common_errors, db_schema, nta_get_tsutatsu, search_rules]
---

# 変更: 置き場所のフォルダーに入る権限が無いときを「開けない DB」にそろえる（nta #154）、ライブ取得に対応していない通達に実行できない投入のコマンドを案内しない（nta #155）

- 対象: `db_schema` / `cli_status` / `common_errors` / `nta_get_tsutatsu` / `search_rules` の `specs/current/<dir>/spec.md`
- 実装の変更の補足: 下の「実装の変更」
- 状態: 草案
- 起こした日: 2026-10-09（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #154（置き場所のフォルダーに入る権限が無いと、DB の状態を「ファイルが無い」と判定し、入口ごとに扱いが食い違う）、#155（`nta_get_tsutatsu` の SPEC-NTA-GET-TSUTATSU-007 が案内する `--bulk-download --tsutatsu="<正式名>"` は、実行すると引数の誤りで止まる）
- あわせて直す仕様の文: `search_rules` の `docId` の説明（差分 `20261009-inspect-pdf-meta-qa-jirei`（#156、PR #157）の「この差分の外で見つけたこと」4）
- 出発点: houki-hub `docs/notes/2026-10-04-stage6-instructions.md` の指示 Q27 の「出発点」（#154 は `EACCES` を見て「開けない」にする、#155 は案 A）。この差分の「人が判断すること」に並べ直し、仕様 PR で承認を受ける
- 差分の書き方: ID の無い節（`## 処理の流れ`・`## できないこと`）は、差分の spec.md に節として見出しの単位で書いた（houki-hub の計画書 `docs/notes/2026-10-04-plan-stage6-and-followups.md` の Q24'、spec-ids の D1 の案 A）
- 前提: main の `9ed0832`（spec-ids 0.3.0 の package-lock.json。版 0.26.0）から切った。2026-10-09 JST に `git ls-remote https://github.com/shuji-bonji/houki-nta-mcp refs/heads/main` で origin の main と同じ `9ed0832161e7…` であることを確かめた。`specs/changes/` には `20261009-inspect-pdf-meta-qa-jirei/` だけがあった（この差分では触らない）
- 版: 0.27.0（minor。置き場所のフォルダーに入る権限が無いときに、`--status` と `--refresh-stale=<日数>` の終了コードが 0 から 1 に変わり、読むだけのツールの `hint`・`retryable`・`detail`・`next_actions` が変わる）。DB のスキーマの版は 12 のまま

## なぜ変えるか

#154: 0.26.0（#144）で、DB を開けないとき（SQLite でないファイル・フォルダー・パスの途中が普通のファイル・DB のファイルを読む権限が無い）は、入口ごとの扱いをそろえた（SPEC-NTA-DB-SCHEMA-021 の開けない行、029、030）。置き場所のフォルダー（またはパスの途中のフォルダー）に入る権限が無いときだけが、この規則の外に残っている。このとき DB の状態は「ファイルが無い」と判定されるので、読むだけのツールは「ファイルがありません。投入してください」と案内し、`--status` は「DB がまだありません」で終了コード 0 を返す。ところが、案内どおりに投入のフラグを実行すると `[ERROR] DB を開けません: unable to open database file` で終了コード 1 になる。利用者は案内に従っても直せず、`--status` でも原因が分からない。0.26.0 の差分は、この場面を「人が判断すること」10 と「この差分の外で見つけたこと」1 に残した。

#155: `nta_get_tsutatsu` は、ライブ取得に対応していない通達（例: `電帳法取通`）で `TSUTATSU_NOT_FOUND` を返し、`hint` と `next_actions[].example.command` で `--bulk-download --tsutatsu="<正式名>"` を案内する（SPEC-NTA-GET-TSUTATSU-007）。ところが `--tsutatsu` は基本通達 4 種の正式名しか受け付けない（SPEC-NTA-CLI-BULK-DOWNLOAD-011）。案内のコマンドをそのまま実行すると、引数の誤りで終了コード 2 になり、何も投入されない。0.26.0 の差分の「この差分の外で見つけたこと」2。

`search_rules` の `docId`: 検索結果の `docId` を「`nta_inspect_pdf_meta` にそのまま渡せる値。例: 質疑応答事例は `shohi/02/19`」と書いている。`nta_inspect_pdf_meta` の `docType` は 4 つ（`kaisei`・`jimu-unei`・`bunshokaitou`・`tax-answer`）で、質疑応答事例は渡せない（差分 `20261009-inspect-pdf-meta-qa-jirei` で、`nta_inspect_pdf_meta` と `db_schema` の文は直した）。

## 今の動き（v0.26.0）

2026-10-09 JST に、Cowork の VM（Linux aarch64、Node 22.23.2、better-sqlite3 12.11.1、root でない利用者）で、main `9ed0832` の `src` と `tests` を作業用のフォルダーに写し、`npm ci --ignore-scripts` と better-sqlite3 の `npm run install` の後に、作業用のテスト（リポジトリには入れていない）で確かめた。`runCliIfRequested` とハンドラーを同じプロセスで呼んだもので、`node dist/index.js` を別のプロセスとして起動したものではない。

### #154: 置き場所のフォルダーに入る権限が無いとき

次の 4 つの場面を作った。どれも DB のパスの情報を読む（`statSync`）と `EACCES: permission denied, stat '<DB のパス>'` になり、`existsSync` は `false` を返し、`probeDbState`（`src/db/index.ts`）は `{ kind: "missing" }` を返した。

| 場面                                                                                      | DB のパス                              |
| ----------------------------------------------------------------------------------------- | -------------------------------------- |
| A. `chmod 000` のフォルダーの中に SQLite の `cache.db` がある                             | `<一時フォルダー>/locked/cache.db`     |
| B. `chmod 000` のフォルダーの中に何も無い                                                 | `<一時フォルダー>/locked2/cache.db`    |
| C. `chmod 000` のフォルダーの下の、あるフォルダーの中（パスの途中のフォルダーに入れない） | `<一時フォルダー>/locked/sub/cache.db` |
| D. 読めるが入れないフォルダー（`chmod 444`）の中に 0 バイトの `cache.db` がある           | `<一時フォルダー>/ronly/cache.db`      |

`HOUKI_NTA_DB_PATH` で 4 つのそれぞれを指したときの入口ごとの動き（4 つとも同じだったものは 1 行にまとめた）:

| 入口                                                        | 動き                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--status`                                                  | 1〜3 行目の後に `  (DB がまだありません — HOUKI_NTA_DB_PATH='<DB のパス>' npx -y @shuji-bonji/houki-nta-mcp@latest --quickstart などの投入のフラグで作ります)`。終了コード 0                                                                                                                                                                                                    |
| `--refresh-stale=30`（一覧）                                | 標準エラー出力に `[refresh-stale] DB がまだありません (<DB のパス>)。…`、標準出力に `[]`。終了コード 0                                                                                                                                                                                                                                                                          |
| `--refresh-stale=30 --apply`（取り直し）                    | 標準エラー出力に `[ERROR] DB がまだありません (<DB のパス>)。…`。終了コード 1                                                                                                                                                                                                                                                                                                   |
| `--bulk-download-qa`（投入）                                | A・B・D は `[ERROR] DB を開けません: unable to open database file`、C は `[ERROR] DB を開けません: EACCES: permission denied, mkdir '<一時フォルダー>/locked/sub'`。どれも終了コード 1                                                                                                                                                                                          |
| `nta_search_qa { keyword: "社内会議" }`（読むだけのツール） | `code: "DOC_NOT_FOUND"`、`hint` は ``HOUKI_NTA_DB_PATH が指すファイル（<DB のパス>）がありません。HOUKI_NTA_DB_PATH を投入した DB のファイルに直すか、`HOUKI_NTA_DB_PATH='<DB のパス>' npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` でこのパスに質疑応答事例を投入してください``、`next_actions` は `cli_bulk_download` の 1 件、`retryable` と `detail` は無い |

- A と B は、どの入口でも区別できなかった（中にファイルがあるかを確かめられないため）
- 書き戻す 3 ツールは、`openWriteBackDb` が「ファイルが無い」の枝に進み、国税庁サイトから取った後の `persist` で DB のファイルを書こうとし、書けない例外を `catch` で捨てる（`src/db/index.ts`）。SPEC-NTA-DB-SCHEMA-030 の `warn` は出ない。これはコードから読んだもので、実行していない

### #155: ライブ取得に対応していない通達の 007

- 環境変数 `HOUKI_NTA_DB_PATH` で無いファイルを指して `getTsutatsu({ name: "電帳法取通", clause: "4-1" })` を呼ぶと、`code: "TSUTATSU_NOT_FOUND"`、`error` は `"電子計算機を使用して作成する国税関係帳簿書類の保存方法等の特例に関する法律の取扱通達" は DB にも未投入で、ライブ取得用 URL も未登録です`、`hint` は ``先に `HOUKI_NTA_DB_PATH='<DB のパス>' npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download --tsutatsu="電子計算機を使用して作成する国税関係帳簿書類の保存方法等の特例に関する法律の取扱通達"` を実行して DB に投入してください。``、`next_actions` は `cli_bulk_download` の 1 件（`example.command` は `hint` と同じコマンド）、`supported_for_live` は基本通達 4 種、`resolved` は略称辞書のエントリ
- 案内のコマンドの `--bulk-download --tsutatsu=電子計算機を使用して作成する国税関係帳簿書類の保存方法等の特例に関する法律の取扱通達` を `runCliIfRequested` に渡すと、`[houki-nta-mcp] --tsutatsu="電子計算機を…取扱通達" は使えません。使える値: 消費税法基本通達, 所得税基本通達, 法人税基本通達, 相続税法基本通達` で終了コード 2（`--tsutatsu=電子帳簿保存法取扱通達` も同じ）
- 007 の枝（`src/tools/handlers.ts` の `getTsutatsu` の `if (!rootUrl)`）に来るのは、`TSUTATSU_URL_ROOTS`（`src/constants.ts`）に無い通達、つまり基本通達 4 種以外だけである。基本通達 4 種は 006 の経路へ進む。したがって、今の 007 の `cli_bulk_download` の案内は、どの場合も実行できないコマンドを指している
- DB を開けないとき（0.26.0 の SPEC-NTA-DB-SCHEMA-030）は、007 の枝で SPEC-NTA-DB-SCHEMA-029 の開けないときの応答（`hint` は `ローカル DB（<パス>）を開けません。…`、`retryable: false`、`detail.cause`、`next_actions` なし）を返す（コードから読んだ）

## 変えた後の動き

1. **置き場所のフォルダー（またはパスの途中のフォルダー）に入る権限が無いときは「開けない」と判定する（#154。DB-SCHEMA-021）。** DB のパスの情報を読んで `EACCES` になったら、DB のファイルがあるかどうかによらず「開けない」にする。開けない理由の文は `EACCES: パスの途中のフォルダーに入る権限がありません (<そのフォルダーのパス>)`。`<そのフォルダーのパス>` は、DB のパスを上にたどって、あることを確かめられた最も深いフォルダー（入る権限が無いのはこのフォルダー）
2. **入口の扱いは 0.26.0 の開けない行のとおりになる（DB-SCHEMA-021・029・030、CLI-STATUS-004・007、COMMON-ERRORS-006）。**
   - 読むだけのツール: 029 の開けないときの応答（`DOC_NOT_FOUND` / `TSUTATSU_NOT_FOUND`、`hint` は `ローカル DB（<パス>）を開けません。…`、`retryable: false`、`detail.cause` は上の文（ホームディレクトリの部分は `~`）、`cli_bulk_download` なし）
   - 書き戻す 3 ツール: 030 のとおり DB を使わずに国税庁サイトから取って返し、`warn` の行を出す
   - `--status`: `[ERROR] DB を開けません: <上の文>` で終了コード 1（CLI-STATUS-007。004 の「DB が無い」から外れる）
   - `--refresh-stale=<日数>`（一覧）・`--refresh-stale=<日数> --apply`（取り直し）・投入のフラグ: `[ERROR] DB を開けません: <上の文>` で終了コード 1
3. **ライブ取得に対応していない通達は、今は取り込めないことを返す（#155。GET-TSUTATSU-007）。** `code`（`TSUTATSU_NOT_FOUND`）・`error`・`supported_for_live`・`resolved` は変えない。`hint` を `この通達（<正式名>）は、今は取り込めません。国税庁サイトから取れるのも、投入のフラグ（--bulk-download の --tsutatsu）で DB に入れられるのも、基本通達 4 種（消費税法基本通達・所得税基本通達・法人税基本通達・相続税法基本通達）だけです` にし、`next_actions` を付けない
4. **007 は DB の状態によらず同じ応答にする（GET-TSUTATSU-007、DB-SCHEMA-030）。** DB を開けないときも、029 の開けないときの応答にしない。DB を開けないことは 030 の `warn` の行で残る
5. **基本通達 4 種の案内は変えない。** 候補ページに条項が無いとき（GET-TSUTATSU-010）の `--bulk-download --tsutatsu="<正式名>"` の案内と `cli_bulk_download` はそのまま。DB-SCHEMA-027 の「当てはまる箇所」の表から 007 を外す
6. **`search_rules` の `docId` の説明を直す（SEARCH-RULES-015）。** `nta_inspect_pdf_meta` の `docId` に渡せるのは、`docType` が 4 種別の文書だけと書く。振る舞いは変わらない

## 変わる仕様 ID

| 種類     | 仕様 ID                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADDED    | なし                                                                                                                                                  |
| MODIFIED | SPEC-NTA-DB-SCHEMA-021・027・029・030、SPEC-NTA-CLI-STATUS-004・007、SPEC-NTA-COMMON-ERRORS-006、SPEC-NTA-GET-TSUTATSU-007、SPEC-NTA-SEARCH-RULES-015 |
| REMOVED  | なし                                                                                                                                                  |

ADDED 0、MODIFIED 9、REMOVED 0。ID の無い節の直しは、`db_schema` の `## 処理の流れ`（図の枝の名前）と、`nta_get_tsutatsu` の `## できないこと`（基本通達 4 種以外を投入できないこと）の 2 つ。どちらも差分の spec.md に節として書いた。新しい ID は取っていない。

front matter の `targets` は、差分の `specs/<dir>/spec.md` を置いた 5 つ（`cli_status`・`common_errors`・`db_schema`・`nta_get_tsutatsu`・`search_rules`）。ID の無い節だけを直す機能は無い。

Issue の「決めること」との対応:

| Issue の決めること                                                                                | この差分の答え                                                                                           | 仕様 ID                                                    |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| #154: `statSync` の `EACCES` を見て「開けない」にするか                                           | する。開けない理由の文は `EACCES: パスの途中のフォルダーに入る権限がありません (<そのフォルダーのパス>)` | DB-SCHEMA-021・029、CLI-STATUS-004・007、COMMON-ERRORS-006 |
| #154: `--status` の終了コード                                                                     | 1（CLI-STATUS-007）                                                                                      | CLI-STATUS-004・007                                        |
| #155: (A) 案内を外して「今は取り込めない」と書く / (B) `--tsutatsu` の対象を増やす / (C) そのほか | A                                                                                                        | GET-TSUTATSU-007、DB-SCHEMA-027・030                       |

## 変わらない振る舞い

- 応答のフィールドを消す・名前を変える変更は無い（T4）。007 で `next_actions` が付かなくなるのは、案内の 1 件を外して残りが無いため（SPEC-NTA-DB-SCHEMA-029 の開けない DB で `cli_bulk_download` を外すのと同じ扱い）
- 0.26.0 の「開けない」（SQLite でないファイル・フォルダー・パスの途中が普通のファイル・DB のファイルを読む権限が無い）の判定と、その開けない理由の文
- 置き場所のフォルダーに入れるとき（パスの情報を読める）の判定。フォルダーに入れて、ファイルが無いときは今までどおり「ファイルが無い」。フォルダーに書く権限だけが無いとき（`chmod 555` など）も「ファイルが無い」のまま（下の「この差分の外で見つけたこと」2）
- パスの情報を読んで `EACCES` 以外の例外（`ELOOP`・`ENAMETOOLONG` など）になるときの判定（今までどおり「ファイルが無い」として扱う。人が判断すること 3）
- 029 の開けないときの `hint` の文（`…読む権限があるか…を確かめてください…`。人が判断すること 5）
- `--status` の `[WARN]` の行（SPEC-NTA-CLI-STATUS-002）。入る権限の無いフォルダーは読めないので、今までどおり何も出さない
- SPEC-NTA-GET-TSUTATSU-005（DB に通達はあるが条項が無いとき）・006・010 と、基本通達 4 種の投入の案内
- `--tsutatsu` が受け付ける値（SPEC-NTA-CLI-BULK-DOWNLOAD-011）
- `nta_inspect_pdf_meta` の `inputSchema` と、`search_rules` の `docId` の値
- tools/list のツールの説明

## 互換性（0.27.0 の CHANGELOG の「互換性」の節に書くもの）

| 場面                                                                     | 0.26.x                                                                                                                                                 | 0.27.0                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 置き場所のフォルダーに入る権限が無いときの `--status`                    | `  (DB がまだありません — …)`、終了コード 0                                                                                                            | `[ERROR] DB を開けません: EACCES: パスの途中のフォルダーに入る権限がありません (<フォルダー>)`、終了コード 1                                                                         |
| 同じ場面の `--refresh-stale=<日数>`（一覧）                              | `[refresh-stale] DB がまだありません (…)` と `[]`、終了コード 0                                                                                        | 同じ `[ERROR]` の文、終了コード 1                                                                                                                                                    |
| 同じ場面の `--refresh-stale=<日数> --apply`                              | `[ERROR] DB がまだありません (…)`、終了コード 1                                                                                                        | 同じ `[ERROR]` の文、終了コード 1                                                                                                                                                    |
| 同じ場面の投入のフラグ                                                   | `[ERROR] DB を開けません: unable to open database file`（パスの途中のフォルダーに入れないときは `EACCES: permission denied, mkdir '…'`）、終了コード 1 | 同じ `[ERROR]` の文、終了コード 1。国税庁サイトに取りに行く前に止まるのは同じ                                                                                                        |
| 同じ場面の読むだけのツール                                               | `hint` はファイルが無いときの文、`next_actions` は `cli_bulk_download`                                                                                 | `hint` は `ローカル DB（<パス>）を開けません。…`、`retryable: false`、`detail.cause` は `EACCES: …`、`next_actions` は付かない（ほかの action があれば残る）。`code`・`error` は同じ |
| 同じ場面の書き戻す 3 ツール                                              | 国税庁サイトから取って返し、DB に書こうとして書けない（ログは出ない）                                                                                  | 国税庁サイトから取って返し、DB に書かない。ログに `warn` の行                                                                                                                        |
| `nta_get_tsutatsu` でライブ取得に対応していない通達（`電帳法取通` など） | `hint` は `先に \`<コマンド>\` を実行して DB に投入してください。`、`next_actions`は`cli_bulk_download`（実行すると終了コード 2）                      | `hint` は `この通達（<正式名>）は、今は取り込めません。…`、`next_actions` は付かない                                                                                                 |
| 同じ通達で DB を開けないとき                                             | 029 の開けないときの応答（`retryable: false`、`detail.cause`）                                                                                         | 上と同じ応答（`retryable`・`detail` は付かない）。ログに `warn` の行                                                                                                                 |

CHANGELOG の「互換性」の節に書く文の案:

```markdown
### 互換性

- ローカル DB の置き場所のフォルダー（またはパスの途中のフォルダー）に入る権限が無いとき、DB を「開けない」と判定するようになりました（#154）。0.26.x では「ファイルが無い」と判定していました。`--status` と `--refresh-stale=<日数>` は `[ERROR] DB を開けません: EACCES: パスの途中のフォルダーに入る権限がありません (<フォルダー>)` を出して終了コード 1 で終わります（0.26.x では「DB がまだありません」で終了コード 0）。読むだけのツールは `hint` が `ローカル DB（<パス>）を開けません。` で始まり、`retryable: false` と `detail.cause` が付き、投入の案内（`cli_bulk_download`）は付きません。書き戻す 3 ツールは国税庁サイトから取って返し、MCP サーバーのログに `warn` の行を出します
- `nta_get_tsutatsu` で、ライブ取得に対応していない通達（`電帳法取通` など、基本通達 4 種以外）を求めたとき、`hint` は「今は取り込めない」ことを書き、`next_actions` の `cli_bulk_download` を外しました（#155）。0.26.x の案内のコマンド（`--bulk-download --tsutatsu="<正式名>"`）は、`--tsutatsu` が基本通達 4 種しか受け付けないため、実行すると終了コード 2 で止まっていました。ローカル DB を開けないときも同じ応答です
```

houki-research-skill で関係する箇所（2026-10-09 JST に `skills/houki-research-skill`（main `4c549d8`、v0.19.1）を `grep -rn "開けません\|開けない\|TSUTATSU_NOT_FOUND\|--tsutatsu" --include=*.md`（CHANGELOG を除く）で探した）:

| ファイル・行                                                                                                           | 書いていること                                                                                                     | 0.27.0 で古くなるか                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/houki-research/docs/ERROR-HANDLING.md` 93 行目（`hint` の先頭の表の `ローカル DB（<パス>）を開けません` の行） | 開けない場面の列挙（SQLite でないファイル、フォルダー、パスの途中が普通のファイル、DB のファイルを読む権限が無い） | 古くなる。「置き場所のフォルダーに入る権限が無い（v0.27.0 以上）」を足す                                                                                                                    |
| 同 140 行目（`--status` の開けないとき）                                                                               | `[ERROR] DB を開けません: <文>` と終了コード 1                                                                     | 文は古くならない。v0.26.x 以前では、置き場所のフォルダーに入る権限が無いと「DB がまだありません」で終了コード 0 になることを足すかは Skill の追随で決める                                   |
| 同 69〜75 行目（`next_actions` が `cli_bulk_download` の `DOC_NOT_FOUND` / `TSUTATSU_NOT_FOUND`）                      | ローカル DB に無いときは投入を案内する                                                                             | `nta_get_tsutatsu` の 007 は 0.27.0 から `cli_bulk_download` を持たないので、この節に当たらなくなる。古くはならない                                                                         |
| `skills/houki-research/SKILL.md` 260・261 行目（エラーの見分け方の表）                                                 | `cli_bulk_download` 付きと `ローカル DB（<パス>）を開けません` の 2 行                                             | `TSUTATSU_NOT_FOUND` で `hint` が `この通達（…）は、今は取り込めません` で始まる行（基本通達 4 種以外は houki-nta-mcp では取れない。通達なしで部分回答する）を足すかは Skill の追随で決める |
| `skills/houki-research/docs/ERROR-CODES.md` 78 行目（`TSUTATSU_NOT_FOUND`）                                            | ローカル DB に無く国税庁サイトから取る先も無い                                                                     | 古くならない                                                                                                                                                                                |

## 呼び出し例への影響

houki-hub の `scripts/reference-examples/houki-nta/ja/`（2026-10-09 JST、houki-hub main `faa30e1`）に、`電帳法取通`・開けない DB・`EACCES` の例は無い（`grep -rln "電帳法取通\|開けません\|EACCES" scripts/reference-examples/houki-nta/ja/` で 0 件）。影響なし。tools/list の `description` も変えないので、`site/docs/reference/mcp/houki-nta.md` の作り直しは要らない。

## 実装 PR で直す文書

動きを変えない文書で、仕様 ID を作らないもの。

| #   | 場所                                                                                                                                                                                 | 直すこと                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | README「取得ツールが DB をどう使うか」の開けない DB の段落（159 行目付近）と、「検索が 0 件のとき」の `hint` の先頭の表の `ローカル DB（<パス>）を開けません。` の行（240 行目付近） | 開けない場面の列挙に「置き場所のフォルダー（またはパスの途中のフォルダー）に入る権限が無い」を足す                                                          |
| 2   | README の `--status` の説明（474 行目付近の「終了コードは、DB が無いときも 0 です（版が合わない・開けないときは 1）」）                                                              | 置き場所のフォルダーに入る権限が無いときは「開けない」で 1 になることを足す                                                                                 |
| 3   | README「エラー応答 (houki-hub family contract)」の開けない DB の文（716 行目付近）                                                                                                   | 列挙があれば 1 と同じく足す                                                                                                                                 |
| 4   | `docs/DATABASE.md` の「DB を開けないとき」の段落（26〜30 行目）                                                                                                                      | 列挙に足し、`[ERROR] DB を開けません: EACCES: パスの途中のフォルダーに入る権限がありません (<フォルダー>)` の例を足す                                       |
| 5   | README の `nta_get_tsutatsu` の説明（「対応通達（4 種）」の節、190 行目付近）                                                                                                        | 4 種以外の通達（`電帳法取通` など）は国税庁サイトから取れず、投入もできないこと（`TSUTATSU_NOT_FOUND` の `hint` で知らせる）を 1 文足す                     |
| 6   | CHANGELOG 0.27.0                                                                                                                                                                     | 上の「互換性」の文。`Changed` に #154・#155、`Fixed` は無し（どちらも案内と判定の変更）。`Closes #154`・`Closes #155`・`Closes #156` は実装 PR の本文に書く |
| 7   | houki-research-skill（別の PR）                                                                                                                                                      | 上の「互換性」の Skill の表                                                                                                                                 |
| 8   | houki-hub `site/docs/guide/local-database.md`・`site/docs/mcp/houki-nta.md`（別の PR）                                                                                               | 開けない場面の列挙があれば足す。hub の追随で決める                                                                                                          |

## 実装の変更

- `src/db/index.ts` の `probeDbState`: `existsSync(path)` が `false` のとき、DB のパスの情報を読み（`statSync`）、`EACCES` なら `{ kind: "unopenable", message: "EACCES: パスの途中のフォルダーに入る権限がありません (<フォルダー>)" }` を返す。`<フォルダー>` は `resolve(path)` の親から上にたどって、`existsSync` が `true` を返す最初のフォルダー（`blockedByFile` と同じたどり方。`existsSync` は入れないフォルダーの下では `false` を返すので、最初に `true` を返すのが入る権限の無いフォルダー）。`EACCES` でないときは今までどおり（`blockedByFile` の判定の後に `missing`）。`DbState` の `unopenable` のコメントに「置き場所のフォルダーに入る権限が無い」を足す
- `openWriteBackDb`・`openReadDb`・`openIngestDb`・`openExistingDb`、`--status`: 変えない（`unopenable` の枝が 0.26.0 のとおりに働く）。`openIngestDb` の `missing` の `mkdirSync` の `EACCES` は、`probeDbState` が先に `unopenable` を返すので通らなくなる
- `src/tools/handlers.ts` の `getTsutatsu` の 007 の枝（`if (!rootUrl)`）: `access.state.kind === 'unopenable'` の分かれを外し、DB の状態によらず `TSUTATSU_NOT_FOUND`、`error` は今のまま、`hint` は SPEC-NTA-GET-TSUTATSU-007 の文、`supported_for_live`・`resolved`・`tool` を付け、`next_actions` を付けない。`hint` の 4 種の名前は `Object.keys(TSUTATSU_URL_ROOTS)` を `・` でつないだもの（`supported_for_live` と同じ並び）。`warnUnopenableWriteBack` は今までどおり 007 の前に呼ぶ（030 の `warn`）。`bulkCommand` はこの枝では使わなくなる
- 受入テスト（Test Designer）:
  - DB-SCHEMA-021・029、CLI-STATUS-004・007、COMMON-ERRORS-006: 「今の動き」の A〜D の 4 つ（`chmod 000` のフォルダーの中に DB がある・無い、パスの途中のフォルダーに入れない、`chmod 444` のフォルダー）を `HOUKI_NTA_DB_PATH` で指し、`--status`・`--refresh-stale=30`・`--refresh-stale=30 --apply`・`--bulk-download-qa` が `[ERROR] DB を開けません: EACCES: パスの途中のフォルダーに入る権限がありません (<フォルダー>)` と終了コード 1 を返すこと（`<フォルダー>` は A・B・C で `locked`／`locked2`／`locked`、D で `ronly`）、読むだけのツール（`spec-20261006-db-failure-paths.test.ts` の 10 ツールの表と同じ作り）が 029 の開けないときの応答と `detail.cause`（ホームディレクトリの下に置いて `~` になること）を返すこと、`--status` の後もフォルダーの中身が変わらないこと。後片付けでフォルダーの権限を戻す。root で走るときは `chmod` が効かないので飛ばす（`process.getuid?.() === 0`。既存のテストと同じ）
  - DB-SCHEMA-030: A の場面で `getTaxAnswer`（または `getQa`）に差し替えた `fetchImpl` を渡し、`source: "live"`、`warn` の 1 行（`meta.cause` が `EACCES: …`）、フォルダーの中身が変わらないこと
  - GET-TSUTATSU-007・DB-SCHEMA-030: `電帳法取通` で、ファイルが無い DB・SQLite でないファイル・A の場面のどれでも、`hint` が `この通達（電子計算機を…取扱通達）は、今は取り込めません。` で始まり、`next_actions`・`retryable`・`detail` が無いこと。開けない 2 つでは `warn` の 1 行が出ること
  - DB-SCHEMA-027・SEARCH-RULES-015: 文だけの変更。新しいテストは要らない
- 既存のテストで期待値を直すもの（2026-10-09 JST に `grep -rn "電帳法取通\|ライブ取得用 URL" src tests --include=*.ts` で探した。Test Designer が確かめる）: `src/tools/handlers.test.ts` の「SPEC-NTA-GET-TSUTATSU-007 houki-nta 管轄だが DB 未投入 + ライブ未対応の通達（電帳法取通）はエラー + hint」、`src/tools/spec-20261006-db-failure-paths.test.ts` の「SPEC-NTA-DB-SCHEMA-030 例: 同じサーバーで nta_get_tsutatsu { name: "電帳法取通", … } は TSUTATSU_NOT_FOUND・retryable…」と「SPEC-NTA-GET-TSUTATSU-007 例: DB を開けるとき、… next_actions[0]…」の 3 つ。`src/tools/spec-20260927-fetch-paths.test.ts` の SPEC-NTA-GET-TSUTATSU-005（DB に `電帳法取通` の条項を入れたもの）は 005 の経路なので変わらない。入る権限の無いフォルダーで「ファイルが無い」を期待するテストは見つからなかった（`grep -rn "chmod" src --include=*.test.ts` で、フォルダーに `chmod` するものは無い）
- 差分 `20261009-inspect-pdf-meta-qa-jirei`（#156）から渡されたもの:
  1. この実装 PR の最終コミットで、`specs/changes/20261009-inspect-pdf-meta-qa-jirei/` も `specs/releases/v0.27.0/` へ移す（下の「取り込みのとき」）。実装 PR の本文に `Closes #156` を書く
  2. 受入テストの 3 か所が `nta_inspect_pdf_meta` のハンドラーを `docType: 'qa-jirei'` で直接呼んでいる（`src/tools/spec-20261004-db-location.test.ts` の「SPEC-NTA-DB-SCHEMA-029 nta_inspect_pdf_meta: 質疑応答事例が 1 件も無い版 12 の DB では…」と `inspectTypes` の `qa-jirei` の行、同じファイルの「SPEC-NTA-INSPECT-PDF-META-001 版 12 の DB に質疑応答事例 shohi/02/19 が無いときは --bulk-download-qa…」、`src/tools/spec-20261006-db-failure-paths.test.ts` の開けない DB の表の `SPEC-NTA-INSPECT-PDF-META-001` の行）。Test Designer が、4 つの `docType`（仕様の例にそろえるなら `tax-answer` の `6101`）に置き換えるか外す（人が判断すること 12）
  3. `src/constants.ts` の `LEGAL_STATUS_BY_DOCTYPE` の `qa-jirei` の項（使っている所が `nta_inspect_pdf_meta` の応答の `legal_status` だけ）と、`handleNtaInspectPdfMetaInner` の `DOC_NOT_FOUND` の箇所のコメント（「qa-jirei のフラグは --bulk-download-qa」）を消すか（人が判断すること 13）

## publish の前の確認

計画書の契約の確認（変えたツールの例を流す）に加えて、shuji の Mac で次を確かめる。公開版の DB（`~/.cache/houki-nta-mcp/cache.db`）には触らない。どのコマンドも `HOUKI_NTA_DB_PATH` か `--db-path` を付けて、`/tmp/nta-027/` の下だけを指す。

1. 受入テストが `npm test` で通り、`npm run check` が通る。作業コピーで `npm run build` する
2. 始める前に `shasum ~/.cache/houki-nta-mcp/cache.db` と `ls -l ~/.cache/houki-nta-mcp/` を控える（最後の 7 で比べる）
3. 入る権限の無いフォルダーを作る

   ```bash
   mkdir -p /tmp/nta-027/locked /tmp/nta-027/locked2 && cd /tmp/nta-027
   sqlite3 locked/cache.db 'CREATE TABLE t(x);'
   chmod 000 locked locked2
   ```

4. `locked/cache.db` と `locked2/cache.db` のそれぞれで、`HOUKI_NTA_DB_PATH=<パス> node <作業コピー>/dist/index.js --status; echo "exit=$?"`、`--refresh-stale=30`、`--bulk-download-qa` を実行し、`[ERROR] DB を開けません: EACCES: パスの途中のフォルダーに入る権限がありません (/tmp/nta-027/locked)`（`locked2` は `…/locked2`）と `exit=1` を確かめる。macOS の `/tmp` は `/private/tmp` へのリンクなので、括弧の中が `/tmp/…` か `/private/tmp/…` かを控える
5. 同じ 2 つで、0.26.0 の proposal.md の「publish の前の確認」5 の `call.sh` と同じ作りで、`nta_search_qa`（`{"keyword":"社内会議"}`）・`nta_inspect_pdf_meta`（`{"docType":"tax-answer","docId":"6101"}`）を呼び、`code`、`hint` の先頭 `ローカル DB（/tmp/nta-027/…）を開けません。`、`retryable: false`、`detail.cause`、`next_actions` が無いことを確かめる。`nta_get_tax_answer`（`{"no":"6101","format":"json"}`）で `source: "live"` と標準エラー出力の `"level":"warn"` の行を確かめる
6. #155: `nta_get_tsutatsu`（`{"name":"電帳法取通","clause":"4-1"}`）を、`HOUKI_NTA_DB_PATH=/tmp/nta-027/none.db`（無いファイル）と `/tmp/nta-027/locked/cache.db` の 2 つで呼び、`hint` が `この通達（電子計算機を使用して作成する国税関係帳簿書類の保存方法等の特例に関する法律の取扱通達）は、今は取り込めません。` で始まり、`next_actions`・`retryable`・`detail` が無いことを確かめる。`/tmp/nta-027/none.db` ができていないことも確かめる
7. `shasum ~/.cache/houki-nta-mcp/cache.db` と `ls -l ~/.cache/houki-nta-mcp/` が 2 と同じことを確かめ、`chmod 755 /tmp/nta-027/locked /tmp/nta-027/locked2 && rm -rf /tmp/nta-027` で片付ける
8. 結果を実装 PR の本文に書く

## 取り込みのとき（Publisher）

- MODIFIED の見出しを、見出しの行（題）も含めて、各 `specs/current/<dir>/spec.md` の同じ ID の節と置き換える。差分の spec.md に節として書いた `## 処理の流れ`（db_schema）と `## できないこと`（nta_get_tsutatsu）は、current の同じ見出しの節と置き換える。各差分の spec.md の冒頭に書いた「関連する Issue」への追記も行う
- current の spec.md の front matter と本文には、この差分の承認を書き足さない（spec-ids 0.3.0 の運用。AGENTS.md の「承認の記録」）。この差分の承認は、この proposal.md が `specs/releases/v0.27.0/` に移ることで `npx spec-ids history <dir>` に出る
- この差分のフォルダーを `specs/releases/v0.27.0/20261009-db-folder-access-and-tsutatsu-guide/` へ移し（`git mv`）、この proposal.md の「状態」を「取り込み済み（v0.27.0）」にする
- 同じコミットで、差分 `20261009-inspect-pdf-meta-qa-jirei`（#156、`implementation: none`。`specs/current/` へは仕様 PR #157 の中で反映済み）のフォルダーも `specs/releases/v0.27.0/20261009-inspect-pdf-meta-qa-jirei/` へ移し、その proposal.md の「状態」を「取り込み済み（`specs/current/` へは仕様 PR #157 の中で反映。v0.27.0 の実装 PR の最終コミットで `specs/releases/v0.27.0/` へ移した）」にする（その proposal.md の「取り込みのとき」のとおり）
- 移した後、`specs/changes/` が空（`.gitkeep` だけ）であること、`npx spec-ids check` と `pr-scope` が通ること、`npx spec-ids history db_schema` などにこの 2 つの差分が v0.27.0 で出ることを確かめる
- CHANGELOG の 0.27.0 に閉じる Issue（#154・#155・#156）を書く

## 人が判断すること

1. **#154 の方針（DB-SCHEMA-021・029、CLI-STATUS-004・007、COMMON-ERRORS-006）。** 案は (A) 置き場所のフォルダー（またはパスの途中のフォルダー）に入る権限が無いときは、DB のパスの情報を読んだときの `EACCES` を見て「開けない」にする。すべての入口が 0.26.0 の開けない行のとおりになる / (B) 今のまま（「ファイルが無い」）。読むだけのツールは投入を案内し、投入のフラグは開けずに止まる / (C) `--status` だけを変える（`EACCES` なら `[ERROR]` と終了コード 1、ほかの入口は今のまま）。A は入口の扱いがそろい、`--status` と読むだけのツールの `hint` が原因（入る権限の無いフォルダー）を示す。B は案内どおりに投入しても直らない。C は `--status` で原因が分かるが、読むだけのツールは投入を案内し続け、`--status` を実行するきっかけが無い。**勧める: A（出発点のとおり）**
2. **ファイルが無いかもしれないのに「開けない」とすること（DB-SCHEMA-021）。** 入る権限の無いフォルダーの中は、ファイルがあるかを確かめられない（「今の動き」の A と B は区別できなかった）。どちらでも、投入のフラグはファイルを作れず、読むだけのツールは DB を読めないので、「開けない」としても利用者がすること（フォルダーの権限か `HOUKI_NTA_DB_PATH` を直す）は変わらない。**勧める: このまま**
3. **`EACCES` だけを見ること。** `EPERM`（macOS のプライバシー保護など）・`ELOOP`・`ENAMETOOLONG` などは、今までどおり「ファイルが無い」として扱う。見た場面が無く、どの入口でどう出るかを確かめていないため。**勧める: `EACCES` だけ（Issue の文のとおり）**
4. **開けない理由の文（DB-SCHEMA-021・029、CLI-STATUS-007）。** 案は (A) `EACCES: パスの途中のフォルダーに入る権限がありません (<そのフォルダーのパス>)`。0.26.0 の `ENOTDIR: パスの途中が普通のファイルです (<普通のファイルのパス>)` と同じ形 / (B) Node.js の例外の文のまま（`EACCES: permission denied, stat '<DB のパス>'`）。A を勧めるのは、(1) 直すべきフォルダーの名前が分かる（B は DB のパスで、どのフォルダーに権限が無いかが分からない）、(2) 0.26.0 の `ENOTDIR` と同じく、houki-nta-mcp が判定した場面には固定の文を使う、(3) OS や Node.js の版で文が変わらない、ため。MCP の応答の `detail.cause` では、0.26.0 のとおりホームディレクトリの部分を `~` にする。**勧める: A**
5. **029 の開けないときの `hint` の文を変えないこと。** 今の文は `パスがフォルダーを指していないか、途中に普通のファイルが無いか、読む権限があるか、SQLite の DB のファイルかを確かめてください`。案は (A) 変えない。理由は `detail.cause` と、`hint` が案内する `--status` の `EACCES: パスの途中のフォルダーに入る権限がありません (…)` で分かる / (B) `読む権限があるか（置き場所のフォルダーに入る権限を含む）` にする。B は `hint` だけで分かるが、0.26.0 の開けない 4 つの場面すべての `hint` が変わり、既存の受入テストの期待値も変わる。**勧める: A**
6. **`--refresh-stale=<日数>`（一覧）の終了コードも 0 から 1 になること（DB-SCHEMA-021）。** 021 の開けない行の一覧の列（「同じ文で終了コード 1」）に従う結果。Issue #154 の本文は `--status` の終了コードだけを挙げているが、一覧も同じく「DB がまだありません」で終了コード 0 だった（「今の動き」）。**勧める: このまま（021 の表のとおり）**
7. **版。** 0.27.0（minor）。`--status` と一覧の終了コード、読むだけのツールの応答、007 の `hint` と `next_actions` が変わる。**勧める: このまま**
8. **#155 の方針（GET-TSUTATSU-007、DB-SCHEMA-027）。** 案は (A) 案内を外し、`hint` で今は取り込めないこと（取り込めるのは基本通達 4 種）を書く / (B) `--tsutatsu` に対応する通達を増やす / (C) そのほか（例: `--tsutatsu` の値の検査を外して、受け付けた通達を `TSUTATSU_URL_ROOTS` に無いまま取りに行く）。B は対応する通達の範囲の検討（#116。計画の外）に当たり、国税庁サイトの個別通達の構造の調査も要る。C は取りに行く先の URL が無いので動かない。**勧める: A（出発点のとおり）。B は #116 で検討する**
9. **007 の `hint` の文。** `この通達（<正式名>）は、今は取り込めません。国税庁サイトから取れるのも、投入のフラグ（--bulk-download の --tsutatsu）で DB に入れられるのも、基本通達 4 種（消費税法基本通達・所得税基本通達・法人税基本通達・相続税法基本通達）だけです`。投入のコマンドの形（SPEC-NTA-DB-SCHEMA-027）を書かないので、DB の場所の設定によらず同じ文になる。`<正式名>` は略称辞書の正式名（`電帳法取通` なら `電子計算機を使用して作成する国税関係帳簿書類の保存方法等の特例に関する法律の取扱通達`）。**勧める: このまま**
10. **007 の `error` を変えないこと。** 今の `error` は `"<正式名>" は DB にも未投入で、ライブ取得用 URL も未登録です`。「DB にも未投入」は投入できるように読めるが、`error` を変えると `error` で見分けている呼び出し側に響く。理由は `hint` で書く。案は (A) 変えない / (B) `"<正式名>" はこの houki-nta-mcp では取り込めない通達です` などに変える。**勧める: A**
11. **007 を DB の状態によらず同じ応答にすること（GET-TSUTATSU-007、DB-SCHEMA-030）。** 案は (A) DB を開けないときも 007 の今は取り込めない応答にする。DB を開けないことは 030 の `warn` の行で残る / (B) 0.26.0 のとおり、DB を開けないときは 029 の開けないときの応答にする。B では、利用者が DB を直してから同じ呼び出しをすると、初めて「この通達は取り込めない」と分かる（DB を直しても、この通達の結果は変わらない）。A では最初の呼び出しで分かり、DB を開けないことはほかのツールの応答と `warn` で分かる。出発点には無かった点で、この差分で足した。**勧める: A**
12. **受入テストの `qa-jirei` の 3 か所（#156 の差分から渡されたもの）。** 案は (A) `tax-answer` の `6101` に置き換える（仕様の例にそろう） / (B) 外す（同じ経路を `tax-answer` で確かめているテストがほかにある） / (C) `inputSchema` の検査を通す呼び出し（`spec-20260927-argument-and-parse-errors.test.ts` の `call`）に寄せる。テストの期待値を変えることになるので、Test Designer が実装 PR の最初のコミットで行い、理由を報告する。**勧める: A**
13. **`LEGAL_STATUS_BY_DOCTYPE` の `qa-jirei` の項と、`handleNtaInspectPdfMetaInner` のコメント（#156 の差分から渡されたもの）。** `qa-jirei` の項は MCP 経由では届かない。案は (A) コメントだけ直し、項は残す（`DocType` の型が 5 つの値を持つので、項を消すと `Record<DocType, …>` の型を変えることになる） / (B) 項もコメントも消す。どちらも振る舞いは変わらない。**勧める: A（項の扱いは Coder が型を見て決め、PR 本文に書く）**
14. **承認日と PR 番号。** この proposal.md の front matter の `approved:`（`YYYY-MM-DD`、JST）と `pr:`（`#` を付けない番号）を、shuji がマージの前にこのブランチで書く

## 確かめた値

| 何を                            | 結果                                                                                                                                                                                                                                     | いつ・どうやって                                                                                                       | 使った仕様 ID                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 起点                            | main `9ed0832`、origin の main `9ed0832161e7…` と同じ。`specs/changes/` は `20261009-inspect-pdf-meta-qa-jirei/` だけ                                                                                                                    | 2026-10-09 JST、`git ls-remote https://github.com/shuji-bonji/houki-nta-mcp refs/heads/main` と `ls specs/changes/`    | —                                  |
| Issue #154・#155 の本文         | 「決めること」は上の「Issue の決めること」の表のとおり                                                                                                                                                                                   | 2026-10-09 JST、VM から `curl https://api.github.com/repos/shuji-bonji/houki-nta-mcp/issues/154`・`/155`               | 変わる仕様 ID                      |
| 入る権限の無いフォルダーの判定  | 「今の動き」の A〜D で、`statSync` は `EACCES: permission denied, stat '<DB のパス>'`、`existsSync` は `false`、`probeDbState` は `missing`                                                                                              | 2026-10-09 JST、Cowork の VM（Linux aarch64、Node 22.23.2、better-sqlite3 12.11.1、root でない利用者）の作業用のテスト | DB-SCHEMA-021                      |
| 今の CLI の 4 つの入口          | 「今の動き」の表のとおり（`--status` は終了コード 0、一覧は `[]` と終了コード 0、取り直しは `DB がまだありません` で 1、投入は `unable to open database file` か `EACCES: permission denied, mkdir '…'` で 1）                           | 同上。`runCliIfRequested` を呼んだ（国税庁サイトへの要求は `fetch` を差し替えて止めた）                                | CLI-STATUS-004・007、DB-SCHEMA-021 |
| 今の読むだけのツール            | 4 つの場面とも `nta_search_qa` はファイルが無いときの `hint` と `cli_bulk_download`                                                                                                                                                      | 同上。`handleNtaSearchQa` を呼んだ                                                                                     | DB-SCHEMA-029                      |
| 今の 007                        | `電帳法取通` の `hint` と `next_actions[0].example.command` は `--bulk-download --tsutatsu="電子計算機を使用して作成する国税関係帳簿書類の保存方法等の特例に関する法律の取扱通達"`。A の場面（入る権限の無いフォルダー）でも同じ         | 同上。`getTsutatsu` を呼んだ                                                                                           | GET-TSUTATSU-007                   |
| 案内のコマンドの結果            | `--bulk-download --tsutatsu=<上の正式名>` と `--tsutatsu=電子帳簿保存法取扱通達` は、どちらも `[houki-nta-mcp] --tsutatsu="…" は使えません。使える値: 消費税法基本通達, 所得税基本通達, 法人税基本通達, 相続税法基本通達` で終了コード 2 | 同上。`runCliIfRequested` を呼んだ                                                                                     | CLI-BULK-DOWNLOAD-011              |
| 007 に来る通達                  | `TSUTATSU_URL_ROOTS` は基本通達 4 種だけ。007 の枝は `!rootUrl`                                                                                                                                                                          | `src/constants.ts` と `src/tools/handlers.ts` を読んだ                                                                 | GET-TSUTATSU-007                   |
| 書き戻すツールの `persist`      | 「ファイルが無い」の枝で、書けない例外を `catch` で捨てる                                                                                                                                                                                | `src/db/index.ts` の `openWriteBackDb` を読んだ                                                                        | DB-SCHEMA-030                      |
| 新しい ID                       | 取っていない（MODIFIED だけ）                                                                                                                                                                                                            | —                                                                                                                      | —                                  |
| houki-research-skill の該当箇所 | 「互換性」の Skill の表                                                                                                                                                                                                                  | 2026-10-09 JST、`skills/houki-research-skill`（main `4c549d8`）で grep（CHANGELOG を除く）                             | 互換性                             |
| houki-hub の呼び出し例          | `電帳法取通`・開けない DB・`EACCES` の例は無い                                                                                                                                                                                           | 2026-10-09 JST、houki-hub main `faa30e1` で grep                                                                       | 呼び出し例への影響                 |

## 確かめていない点

1. macOS（APFS）で、入る権限の無いフォルダーの下の DB のパスの情報を読んだときに `EACCES` になること（VM の Linux では `EACCES`）。publish の前の確認 4 で確かめる
2. 書き戻す 3 ツールが、入る権限の無いフォルダーの下で今は `warn` を出さないこと（コードから読んだ。実行していない）
3. `EPERM` になる場面（macOS のプライバシー保護の下のフォルダーなど）の今の動き（人が判断すること 3）
4. Windows での判定（フォルダーの権限の仕組みが違い、`chmod 000` が効かない）
5. `node dist/index.js` を別のプロセスとして起動したときの動き（同じプロセスで関数を呼んだ結果と、`src/index.ts` を読んだ結果から書いた）
6. 「実装の変更」の「既存のテストで期待値を直すもの」の範囲（grep で見当を付けただけで、テストを 1 つずつ読んではいない）

## この差分の外で見つけたこと

1. **SPEC-NTA-GET-TSUTATSU-005 の `hint`。** 4 通達以外の通達の条項が DB に 1 件でもあるとき（005 の 2 つ目の条件）の `ARTICLE_NOT_FOUND` の `hint` は `別の clause 番号を試すか、\`--bulk-download\` で再取得してください（最新の改正反映用）`（`src/tools/handlers.ts`）で、4 通達以外では実行できない投入を案内している。ただし、今の `--tsutatsu` は 4 通達以外を受け付けないので、この条件の DB を作る経路は 0.24.0 以降には無い（0.23.x 以前の DB に残っていれば当たる。確かめていない）。直すなら別の Issue にする
2. **置き場所のフォルダーに書く権限だけが無いとき。** フォルダーに入れて（パスの情報を読める）書けない（`chmod 555` など）とき、DB のファイルが無ければ判定は「ファイルが無い」のままで、読むだけのツールは投入を案内し、投入のフラグはファイルを作れずに `[ERROR] DB を開けません` で終了コード 1 になる（コードから読んだ。実行していない）。#154 と同じ食い違いが残るが、ファイルが本当に無いことは確かめられるので、`--status` の「DB がまだありません」は正しい。Issue にするかを決める
3. **`search_rules` の `docId` の「取得ツール（`nta_get_*`）にそのまま渡せる値」。** 質疑応答事例の `docId`（`shohi/02/19`）は `nta_get_qa` の `topic`・`category`・`id` に分けて渡し、タックスアンサーの `docId`（`6101`）は `nta_get_tax_answer` の `no` に渡すので、「そのまま渡せる」のは `nta_get_kaisei_tsutatsu`・`nta_get_jimu_unei`・`nta_get_bunshokaitou` の `docId` だけである。この差分では `nta_inspect_pdf_meta` の部分だけを直した（指示の範囲）。直すなら別の差分にする
4. **houki-research-skill の 007 の扱い。** Skill の SKILL.md のエラーの見分け方の表には、`TSUTATSU_NOT_FOUND` で `next_actions` も開けない DB の `hint` も無いとき（0.27.0 の 007）の行が無い。Skill の追随で、「基本通達 4 種以外の通達は houki-nta-mcp では取れない。通達なしで部分回答する」の行を足すかを決める

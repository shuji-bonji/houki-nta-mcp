# 変更: ローカル DB を開けないときの読むだけのツールと書き戻すツールの応答、`--bulk-download-tax-answer` が索引を保存できないときの終わり方（nta #144・#145）

- 対象: `db_schema` / `common_errors` / `cli_bulk_download` / `nta_get_tsutatsu` / `nta_search_tsutatsu` / `nta_search_qa` / `nta_search_tax_answer` / `nta_search_kaisei_tsutatsu` / `nta_search_jimu_unei` / `nta_search_bunshokaitou` / `nta_get_kaisei_tsutatsu` / `nta_get_jimu_unei` / `nta_get_bunshokaitou` / `nta_inspect_pdf_meta` の `specs/current/<dir>/spec.md`
- 実装の変更: 要（下の「実装の変更」）
- 承認日: 2026-10-06（PR #152）
- 状態: 取り込み済み（v0.26.0）
- 起こした日: 2026-10-06（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #144（開けないローカル DB で、読むだけのツールが `INTERNAL_ERROR` を返し、`hint` に DB のパスも直し方も入らない）、#145（`--bulk-download-tax-answer` がタックスアンサーの索引を DB に保存できなかったときの終わり方が決まっていない）
- 出発点: 2026-10-06 JST に shuji が「#144 は案 A（`DOC_NOT_FOUND` に寄せて SPEC-NTA-DB-SCHEMA-029 の表に行を足す）、#145 は案 A（取り込みを続けて `[WARN]` を出す）」で進めると決めた。この差分の「人が判断すること」に並べ直し、仕様 PR で最終の承認を受ける
- 規則の出典: houki-hub `docs/DECISIONS.md` の 2026-10-04 の行「T6 ローカル DB の場所の見え方」の (a)〜(f)、「houki-nta-mcp #137」の行、2026-10-05 の行「`--status` は版 3〜11 の DB を移行しない」。差分 `specs/releases/v0.25.0/20261004-db-location/proposal.md` の「人が判断すること」13・17 と「houki-egov-mcp と文を変えた箇所」の「開けない DB」の行
- 写した元: houki-egov-mcp の `specs/current/search_fulltext/spec.md` の SPEC-EGOV-SEARCH-FULLTEXT-027（開けない DB で `search_law` に切り替える）・044（`note` の開けない行）
- 前提: main の `c029602`（v0.25.1 の取り込み。版 0.25.1）から切った。2026-10-06 JST に `git ls-remote https://github.com/shuji-bonji/houki-nta-mcp refs/heads/main` で origin の main と同じ `c0296023c2cd…` であることを確かめた。`specs/changes/` は `.gitkeep` だけだった
- 版: 0.26.0（minor。開けない DB での `code` が `INTERNAL_ERROR` から変わり、書き戻すツールが例外にせず国税庁サイトから取るようになり、`--bulk-download-tax-answer` の終わり方が変わる）。DB のスキーマの版は 12 のまま

## なぜ変えるか

#144: 0.25.0（#138）で、読むだけのツールの「DB に 1 件も無い」ときの `hint` には、開こうとした DB のパスと直し方が DB の状態ごとに入るようになった（SPEC-NTA-DB-SCHEMA-029、021 の注 2）。DB を開けない（SQLite でないファイル・フォルダー・パスの途中が普通のファイル・権限が無い）ときだけがこの規則の外に残っている。このとき読むだけのツールは SPEC-NTA-COMMON-ERRORS-006 の `INTERNAL_ERROR` を返し、`hint` は「バグの可能性があります。再現手順を添えて GitHub issue でご報告ください」で、DB のパスは応答に出ない。利用者のファイルの状態が原因なのに、不具合の報告を求める応答になっている。houki-egov-mcp は同じ状態で `search_law` に切り替え、`note` に DB のパスを入れている（SPEC-EGOV-SEARCH-FULLTEXT-027・044）。

書き戻す 3 ツール（`nta_get_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer`）も、DB を開けないと国税庁サイトに取りに行かずに `INTERNAL_ERROR` を返す。国税庁サイトから取れるはずの内容も返せない。

#145: 0.25.0（#137）で、`nta_get_tax_answer` は保存した索引を読めない・保存できないときも記事を返し、ログに `warn` を出すようにした（SPEC-NTA-GET-TAX-ANSWER-018）。`--bulk-download-tax-answer` の側は「この差分では変えない」とし（SPEC-NTA-DB-SCHEMA-025）、索引の保存に失敗すると記事を 1 件も取らずに止まる。終わり方（終了コード、`--bulk-download-everything` で次へ進むか）は仕様にもテストにも無い。

## 今の動き（v0.25.1）

2026-10-06 JST に、Cowork の VM（Linux、aarch64、Node 22.23.2）で、main `c029602` の `src` と `tests` を作業用のフォルダーに写し、`npm ci --ignore-scripts` と better-sqlite3 の `npm run install` の後に、作業用のテスト（リポジトリには入れていない）で確かめた。ハンドラーと `runCliIfRequested` を同じプロセスで呼んだもので、`node dist/index.js` を別のプロセスとして起動したものではない。

### #144: 開けない DB

- DB の状態は `probeDbState`（`src/db/index.ts`）が `unopenable` と判定する。判定の文（`message`）は、SQLite でないファイルが `file is not a database`、フォルダーが `disk I/O error`、パスの途中が普通のファイルが `ENOTDIR: パスの途中が普通のファイルです (<普通のファイルの絶対パス>)`、読む権限の無いファイル（`chmod 000`）が `unable to open database file`。`--status` と投入のフラグは、この文を `[ERROR] DB を開けません: <文>` で出して終了コード 1 で終わる（確かめた）
- 読むだけのツールの入口 `openReadDb` と書き戻すツールの入口 `openWriteBackDb` は、`unopenable` のときに `openDb(path)` を呼び、例外になる。例外の文は判定の文と違うことがある。フォルダーと権限の無いファイルとパスの途中が普通のファイル（1 段）は `unable to open database file`、パスの途中が普通のファイル（2 段以上。例: `plain/sub/cache.db`）は `ENOTDIR: not a directory, mkdir '<絶対パス>'`、SQLite でないファイルは `file is not a database`
- 例外は `src/server.ts` の `catch` で `INTERNAL_ERROR`（`error: "内部エラーが発生しました: <例外の文>"`、`hint: "バグの可能性があります。再現手順を添えて GitHub issue でご報告ください"`、`retryable: false`、`detail.cause`、`tool`）になり、`logger.error('server', 'tool <name> threw', …)` を出す（SPEC-NTA-COMMON-ERRORS-006）
- 確かめた 7 ツール（`nta_search_qa`・`nta_search_tsutatsu`・`nta_get_jimu_unei`・`nta_inspect_pdf_meta`・`nta_get_tax_answer`・`nta_get_qa`・`nta_get_tsutatsu`）は、4 つの状態のどれでもハンドラーが例外を投げた。書き戻す 3 ツールは国税庁サイトへの要求を 1 回もしなかった（差し替えた `fetch` の呼ばれた回数が 0）
- 置き場所のフォルダーに入る権限が無いとき（`chmod 000` のフォルダーの下の DB）は、`probeDbState` が `existsSync` で確かめられずに `missing` と判定する。読むだけのツールはファイルが無いときの `hint`（`HOUKI_NTA_DB_PATH が指すファイル（…）がありません。…`）を返し、`--status` は `(DB がまだありません — …)` で終了コード 0、`--bulk-download-qa` は `[ERROR] DB を開けません: unable to open database file` で終了コード 1 だった
- `next_actions` の `action` の型（`src/errors.ts` の `NextAction`）は `action: string`・`reason: string`・`example?: Record<string, unknown>` で、どの名前でも入れられる。CLI のコマンドを案内する `action` は `cli_bulk_download` だけで（`src` のテストを除くファイルを grep。`cli_bulk_download` 4 か所）、`--status` を表す名前は無い。common_errors の「エラー応答のフィールド」の表も `list_tools` / `retry_later` / `cli_bulk_download` / `delegate_to_mcp` を挙げている

### #145: `--bulk-download-tax-answer` が索引を保存できないとき

- `bulkDownloadTaxAnswer`（`src/services/tax-answer-bulk-downloader.ts`）は、索引を取って読み取れると、記事を取りに行く前に `saveTaxAnswerIndex` を呼ぶ。例外は `catch` して `TaxAnswerIndexDbError` なら `err.cause`（SQLite の元の例外）を投げ直す（0.25.0 で「外から見える動きを変えない」ために入れた）
- `--bulk-download-tax-answer` は、投入の前の DB の確かめ（`prepareIngestDb`）を通った後、この例外を受け取らない。作業用のテストで、`tax_answer_index` を `url` の列の無い表に作り替えた版 12 の DB に `--bulk-download-tax-answer --db-path=<DB>` を渡すと、`runCliIfRequested` が `SqliteError: table tax_answer_index has no column named url` で reject した。記事は 1 件も入らず（`document` は 0 行）、標準出力の結果の JSON も出なかった。プロセスとして実行したときは、`src/index.ts` の `main().catch` が `logger.error('server', 'fatal error', …)` を出して `process.exit(1)` するとコードから読める（プロセスとしては実行していない）
- `--bulk-download-everything` は、種別ごとに `try { … } catch` で例外を受け取り、`[bulk-download-everything] (<n>/6) <種別> 失敗: <文>` を出して次の種別へ進む（`src/cli.ts`）。作業用のテストで（ほかの 5 種別の取り込みの関数は差し替えた）、同じ DB に `--bulk-download-everything --db-path=<DB>` を渡すと、`(5/6) タックスアンサー 失敗: table tax_answer_index has no column named url` を出し、質疑応答事例へ進み、`全 6 種別の処理を完了しました` を出した。`process.exitCode` は設定されなかった（終了コード 0）
- `cli_bulk_download` の終了コードの決まりは、「未決」1 に「種別の中で節や文書の取得に失敗しても 0」とあるだけで、ID もテストも無い。`src/cli.ts` で `process.exitCode` を設定するのは、引数の誤り（2）、`--status`、`prepareIngestDb` の失敗（1）、`--refresh-stale` の DB の失敗（1）だけで、記事ごとの失敗（`documentsFailed`）と種別ごとの失敗（`--bulk-download-everything`）では設定しない（`grep -n exitCode src/cli.ts`）

## 変えた後の動き

1. **読むだけのツールは、DB を開けないときに「DB に 1 件も無い」ときの code を返す（#144 の決めること 1。DB-SCHEMA-029・021、COMMON-ERRORS-006 と 10 のツールの ID を MODIFIED）。** `code` は `DOC_NOT_FOUND`（`nta_search_tsutatsu` は `TSUTATSU_NOT_FOUND`）、`error` は各ツールの「DB に 1 件も無い」ときの文のまま
2. **`hint` は `ローカル DB（<パス>）を開けません。` で始まる文にし、確かめることと `--status` のコマンドを書く（決めること 2。DB-SCHEMA-029・027）。** パスはホームを `~` にした形（DB-SCHEMA-028）。`--status` のコマンドは MCP サーバーと同じ DB の場所の設定を付けた案内のコマンド（027）。SQLite の文は `hint` に入れず、`detail.cause` に入れる（ホームは `~`）
3. **`retryable: false` を付ける（決めること 3）。** ほかの DB の状態の応答には今までどおり付けない
4. **`next_actions` に `cli_bulk_download` を入れない（決めること 4）。** `--status` は `next_actions` に入れず、`hint` の文だけで案内する
5. **書き戻す 3 ツールは、DB を開けないときも DB を使わずに国税庁サイトから取って返し、DB に書かないことをログに `warn` で出す（決めること 5。DB-SCHEMA-030、GET-TSUTATSU-007・010）。** 国税庁サイトに取りに行く先の無い通達（GET-TSUTATSU-007）は 1〜4 の応答にする。国税庁サイトとの通信の失敗などは今までの応答のまま（`cli_bulk_download` だけ外す）
6. **CLI は変えない。** 投入のフラグ・`--refresh-stale`・`--status` は今までどおり `[ERROR] DB を開けません: <文>` で終了コード 1
7. **`--bulk-download-tax-answer` は、索引を保存できなくても記事の取り込みを続け、標準エラー出力に `[WARN]` の行を出す（#145 の決めること 1。CLI-BULK-DOWNLOAD-014、DB-SCHEMA-025）。** 終了コードは保存できたときと同じ（ほかに失敗が無ければ 0。決めること 2）。`--bulk-download-everything` ではタックスアンサーの段が失敗にならず、次の種別へ進む（決めること 3。種別ごとの失敗を受け取る作りは変えない）

## 変わる仕様 ID

| 種類 | 仕様 ID |
| --- | --- |
| ADDED | SPEC-NTA-DB-SCHEMA-030、SPEC-NTA-CLI-BULK-DOWNLOAD-014 |
| MODIFIED | SPEC-NTA-DB-SCHEMA-021・025・027・029、SPEC-NTA-COMMON-ERRORS-006、SPEC-NTA-GET-TSUTATSU-007・010、SPEC-NTA-SEARCH-TSUTATSU-003、SPEC-NTA-SEARCH-QA-001、SPEC-NTA-SEARCH-TAX-ANSWER-001、SPEC-NTA-SEARCH-KAISEI-TSUTATSU-001、SPEC-NTA-SEARCH-JIMU-UNEI-001、SPEC-NTA-SEARCH-BUNSHOKAITOU-001、SPEC-NTA-GET-KAISEI-TSUTATSU-001、SPEC-NTA-GET-JIMU-UNEI-001、SPEC-NTA-GET-BUNSHOKAITOU-002、SPEC-NTA-INSPECT-PDF-META-001 |
| REMOVED | なし |

ADDED 2、MODIFIED 17、REMOVED 0。触る dir は 14。ID は 2026-10-06 JST に `npx --no-install spec-ids next <dir>` で取った（`db_schema` 030、`cli_bulk_download` 014）。

Issue の「決めること」との対応:

| Issue の決めること | この差分の答え | 仕様 ID |
| --- | --- | --- |
| #144 の 1（code） | `DOC_NOT_FOUND`（基本通達は `TSUTATSU_NOT_FOUND`）。029 の表に「開けない」の行を足す | DB-SCHEMA-029・021、COMMON-ERRORS-006、10 のツールの ID |
| #144 の 2（hint の文） | ``ローカル DB（<パス>）を開けません。…。`<--status のコマンド>` を実行すると、開けない理由が出ます``。SQLite の文は `detail.cause` | DB-SCHEMA-029・027 |
| #144 の 3（retryable） | `false` | DB-SCHEMA-029 |
| #144 の 4（next_actions） | `cli_bulk_download` を入れない。`--status` も入れない（`hint` の文で案内する） | DB-SCHEMA-029・030、GET-TSUTATSU-007・010 |
| #144 の 5（書き戻す 3 ツール） | 同じ差分で決める。DB を使わずに国税庁サイトから取り、`warn` を出す | DB-SCHEMA-030・021、GET-TSUTATSU-007・010 |
| #145 の 1（続けるか止めるか） | 続ける。標準エラー出力に `[WARN]` の行 | CLI-BULK-DOWNLOAD-014、DB-SCHEMA-025 |
| #145 の 2（終了コード） | 保存できたときと同じ（ほかに失敗が無ければ 0） | CLI-BULK-DOWNLOAD-014 |
| #145 の 3（`--bulk-download-everything`） | タックスアンサーの段は失敗にならず、次の種別へ進む | CLI-BULK-DOWNLOAD-014 |
| #145 の 4（受入テスト） | 書く（下の「実装の変更」の受入テスト） | CLI-BULK-DOWNLOAD-014 |

## 変わらない振る舞い

- 応答のフィールドを消す・名前を変える変更は無い（T4）。開けない DB で足すのは `retryable` と `detail.cause`（今の `INTERNAL_ERROR` にもある 2 つ）。`tool` も今までどおり付く
- CLI の DB の入口（SPEC-NTA-DB-SCHEMA-021 の CLI の 4 列。`[ERROR] DB を開けません: <文>` と終了コード 1）、`--status`（SPEC-NTA-CLI-STATUS-007）
- DB を開けるときの読むだけのツール・書き戻すツールの応答（ファイルが無い・版の記録が無い・版が合わない・その種別が無いときの `hint` を含む）
- DB を開けた後の SQL の失敗（壊れた DB の途中で `database disk image is malformed` になるなど）は、今までどおり SPEC-NTA-COMMON-ERRORS-006 の `INTERNAL_ERROR`。この差分で変えるのは、開く前の判定（`probeDbState`）で `unopenable` になる場面だけ
- 置き場所のフォルダーに入る権限が無く、ファイルがあるかを確かめられないときの判定（今は「ファイルが無い」）。人が判断すること 10
- `nta_get_tax_answer` が保存した索引を読めない・保存できないときの扱い（SPEC-NTA-GET-TAX-ANSWER-018）。DB を開けないときは保存した索引を読みに行かないので、018 の `warn` は出ない（030）
- `--bulk-download-tax-answer` の索引の保存が成功したときの動き（SPEC-NTA-CLI-BULK-DOWNLOAD-013）、索引の取得や解析に失敗したときの動き（今までどおり記事を取らずに止まる）、記事ごとの失敗の数え方
- `--bulk-download-everything` の「種別ごとの失敗を受け取って次へ進む」作りと、その終了コード（失敗した種別があっても 0。人が判断すること 13）
- tools/list のツールの説明

## 互換性（0.26.0 の CHANGELOG の「互換性」の節に書くもの）

| 場面 | 0.25.x | 0.26.0 |
| --- | --- | --- |
| DB を開けないときの読むだけのツール（検索 6 ツール、`nta_get_kaisei_tsutatsu`・`nta_get_jimu_unei`・`nta_get_bunshokaitou`、`nta_inspect_pdf_meta`）の `code` | `INTERNAL_ERROR` | `DOC_NOT_FOUND`（`nta_search_tsutatsu` は `TSUTATSU_NOT_FOUND`） |
| 同じ場面の `error` | `内部エラーが発生しました: <例外の文>` | 各ツールの「DB に 1 件も無い」ときの文（例: `ローカル DB に質疑応答事例が 1 件も無いため、検索できません（「該当なし」という結果ではありません）`） |
| 同じ場面の `hint` | `バグの可能性があります。再現手順を添えて GitHub issue でご報告ください` | ``ローカル DB（<パス>）を開けません。…。`npx -y @shuji-bonji/houki-nta-mcp@latest --status` を実行すると、開けない理由が出ます``（環境変数で起動したときは前に変数が付く） |
| 同じ場面の `detail.cause` | 例外の文（ホームディレクトリを含む絶対パスが入ることがある） | `--status` の `[ERROR] DB を開けません: ` の後と同じ文。ホームディレクトリの部分は `~` |
| 同じ場面の `retryable`・`next_actions` | `retryable: false`、`next_actions` は無い | 同じ（`retryable: false`、`cli_bulk_download` は入らない） |
| DB を開けないときの `nta_get_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer` | 国税庁サイトに取りに行かずに `INTERNAL_ERROR` | DB を使わずに国税庁サイトから取って返す（`source: "live"`）。DB には書かない。MCP サーバーのログに `warn` の行。ライブ取得に対応していない通達は `TSUTATSU_NOT_FOUND` と上の `hint` |
| `--bulk-download-tax-answer` で索引を保存できないとき | 記事を取らずに止まり、`fatal error` のログで終了コード 1（コードから読んだもの） | 記事の取り込みを続け、標準エラー出力に `[WARN] タックスアンサーの索引を DB に保存できませんでした（…）: <文>。記事の取り込みは続けます`。終了コード 0 |
| `--bulk-download-everything` で同じとき | `(5/6) タックスアンサー 失敗: <文>` を出してタックスアンサーを飛ばす | タックスアンサーを取り込み、同じ `[WARN]` の行を出す |

CHANGELOG の「互換性」の節に書く文の案:

```markdown
### 互換性

- ローカル DB を開けないとき（SQLite でないファイル、フォルダー、パスの途中が普通のファイル、DB のファイルを読む権限が無い）、読むだけのツールの `code` が `INTERNAL_ERROR` から `DOC_NOT_FOUND`（`nta_search_tsutatsu` は `TSUTATSU_NOT_FOUND`）に変わります（#144）。`hint` は `ローカル DB（<パス>）を開けません。` で始まり、確かめることと `--status` のコマンドを書きます。開けない理由の文は今までどおり `detail.cause` に入ります（ホームディレクトリの部分は `~`）。`retryable: false` は変わりません。`code` が `INTERNAL_ERROR` かどうかで DB の不具合を見分けていたスクリプトは、`hint` の先頭（`ローカル DB（…）を開けません`）で見分けるように直してください
- 同じとき、`nta_get_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer` は `INTERNAL_ERROR` を返さず、DB を使わずに国税庁サイトから取って返します。取った内容は DB に書かず、MCP サーバーのログに `warn` の行を出します
- `--bulk-download-tax-answer` は、タックスアンサーの索引を DB に保存できないとき、止まらずに記事の取り込みを続け、`[WARN]` の行を出して終了コード 0 で終わります（#145）。0.25.x では記事を 1 件も取らずに終了コード 1 で終わっていました
```

houki-research-skill で関係する箇所（2026-10-06 JST に `skills/houki-research-skill`（main `0889824`、v0.19.0）を `grep -rn "INTERNAL_ERROR\|開けな\|cli_bulk_download" --include=*.md`（CHANGELOG を除く）で探した）:

| ファイル・行 | 書いていること | 0.26.0 で古くなるか |
| --- | --- | --- |
| `skills/houki-research/docs/ERROR-HANDLING.md` 84〜92 行目（houki-nta-mcp の `hint` の先頭の表） | DB の状態ごとの `hint` の先頭と `next_actions` | 古くなる。「`ローカル DB（<パス>）を開けません`」の行（開けない、`next_actions` は無い、`--status` で理由を確かめ、パス・権限・ファイルを直すこと）を足す |
| 同 71 行目 | 「いずれも `next_actions` の `action` が `cli_bulk_download` になっている」 | もともと版が新しい・読めない DB に当たらない文で、開けない DB にも当たらなくなる。「投入で直る場面では」と限る |
| 同 206〜214 行目（`INTERNAL_ERROR` / `UNKNOWN_TOOL`） | `INTERNAL_ERROR` は不具合として報告を勧める。例外は日付を読めないとき | 0.25.x 以前の houki-nta-mcp では、DB を開けないときも `INTERNAL_ERROR`（`detail.cause` が `file is not a database` など）で、不具合ではない。この見分けを 214 行目の例外に足すかは Skill の追随で決める |
| `skills/houki-research/docs/ERROR-CODES.md` 78・79 行目 | `TSUTATSU_NOT_FOUND`・`DOC_NOT_FOUND` の意味 | 「ローカル DB を開けないときも」を足す |
| `README.md` 156 行目 | houki-nta-mcp の版ごとの機能 | 「DB を開けないときの `DOC_NOT_FOUND`、書き戻すツールの国税庁サイトからの取得、`--bulk-download-tax-answer` の `[WARN]` は v0.26.0 以上」を足す |

houki-nta-mcp の開けない DB を `INTERNAL_ERROR` と明記している箇所は Skill に無い（上の grep で、`INTERNAL_ERROR` の行はどれも MCP を分けない一般の説明か、日付を読めないときの例外）。

## 呼び出し例への影響

houki-hub の `scripts/reference-examples/houki-nta/ja/`（2026-10-06 JST、houki-hub main `f37d8d5`）に、開けない DB の例は無い（`grep -rln "INTERNAL_ERROR\|開けな\|file is not a database\|unable to open" scripts/reference-examples/houki-nta/ja/` で 0 件）。影響なし。tools/list の `description` も変えないので、`site/docs/reference/mcp/houki-nta.md` の作り直しは要らない。

## houki-egov-mcp と文を変えた箇所

houki-egov-mcp の SPEC-EGOV-SEARCH-FULLTEXT-027・044 の開けない行（以下「egov」）と比べて、次の箇所を変えた。

| 箇所 | egov | この差分 | 変えた理由 |
| --- | --- | --- | --- |
| 応答の種類 | エラーにせず `source: "api-fallback"` で `search_law`（法令名のタイトル一致）に切り替える | エラー（`DOC_NOT_FOUND` / `TSUTATSU_NOT_FOUND`） | nta の読むだけのツールには、DB の代わりに引ける先が無い（検索ツールと文書系の取得ツールは DB だけを引き、国税庁サイトに取りに行く経路を持たない）。「DB に 1 件も無い」ときの応答（021 の注 1）と同じ形にした |
| 先頭の文 | `ローカル DB (<パス>) を開けなかったため、search_law … にフォールバックしています。`（半角の括弧、切り替えの文に続く） | `ローカル DB（<パス>）を開けません。`（全角の括弧、独立した文） | nta の `hint` は独立した文で、029 のほかの行（`ローカル DB（<パス>）がありません。`）に合わせた |
| 確かめること | フォルダーを指していないか、途中に普通のファイルが無いか、読む権限があるか（`HOUKI_EGOV_DB_PATH` の値を直す） | 同じ 3 つに「SQLite の DB のファイルか」を足し、`HOUKI_NTA_DB_PATH` の値を直す | egov の状態の列は「SQLite でないファイル」を含むのに、続きの文が挙げていない。nta では足した |
| `--status` | 案内しない | `<--status のコマンド>` を実行すると開けない理由が出ることを書く。MCP サーバーと同じ DB の場所の設定を付ける（027） | nta の `--status` は開けない理由（`[ERROR] DB を開けません: <文>`）を出す（SPEC-NTA-CLI-STATUS-007）。029 の「その種別が無い」ときの `--status`（変数なし）とは目的が違う（人が判断すること 6） |
| `next_actions` | `search_law` の 1 件だけ | `cli_bulk_download` を外し、残りが無ければ付けない | nta には切り替える先のツールが無い |
| `retryable` | 付かない（成功の応答） | `false` | エラーの応答なので、再試行で変わらないことを示す |
| 開けない理由の文 | 応答に出さない | `detail.cause`（ホームは `~`） | 0.25.x の `INTERNAL_ERROR` の `detail.cause` を残す（T4）。`--status` の文と同じにして突き合わせられるようにする |
| DB に書く入口 | `search_fulltext` は DB を読むだけで、MCP サーバーは DB に書かない | 書き戻す 3 ツールは DB を使わずに国税庁サイトから取る（DB-SCHEMA-030） | nta の書き戻すツールは国税庁サイトから取れる |
| `--bulk-download-*` の索引の保存 | 当たる場面が無い | #145（CLI-BULK-DOWNLOAD-014） | egov の bulk download には保存する索引が無い |

## 実装 PR で直す文書

動きを変えない文書で、仕様 ID を作らないもの。

| # | 場所 | 直すこと |
| --- | --- | --- |
| 1 | README「検索が 0 件のとき」の `hint` の先頭の表（234 行目付近） | `ローカル DB（<パス>）を開けません。` の行（DB を開けない。パス・権限・ファイルを確かめ、`--status` で理由を見る）を足す |
| 2 | README「エラー応答 (houki-hub family contract)」の表（711 行目付近の「handler が例外を投げた」の行） | ローカル DB を開けないことはこの行に当たらず、読むだけのツールは `DOC_NOT_FOUND` / `TSUTATSU_NOT_FOUND`、書き戻すツールは国税庁サイトから取ることを 1 文足す |
| 3 | README「取得ツールが DB をどう使うか」（146 行目付近） | DB を開けないとき、`nta_get_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer` は DB を使わずに国税庁サイトから取り、書き戻さないこと（ログに `warn`）を足す |
| 4 | README の `--bulk-download-tax-answer` の説明（414 行目付近）か `docs/DATABASE.md` のタックスアンサーの索引の節 | 索引を保存できなくても記事の取り込みを続け、`[WARN]` の行を出すことを足す |
| 5 | `docs/DATABASE.md` の「DB ファイルの場所」（8〜30 行目） | DB を開けないときの読むだけのツール・書き戻すツール・CLI の扱いを 3 行で足す |
| 6 | CHANGELOG 0.26.0 | 上の「互換性」の文。`Changed` に #144、`Fixed` に #145。`Closes #144`・`Closes #145` は実装 PR の本文に書く |
| 7 | houki-research-skill（別の PR） | 上の「互換性」の Skill の表の 5 か所 |
| 8 | houki-hub `site/docs/guide/local-database.md`・`site/docs/mcp/houki-nta.md`（別の PR） | 2026-10-06 JST の grep で「開けな」「INTERNAL_ERROR」は 0 件。DB を開けないときの扱いを足すかは hub の追随で決める |

## 実装の変更

- `src/db/index.ts`: `openReadDb` は、`unopenable` のときも `openDb(path)` を呼ばず、版の合わない DB と同じく空の DB（メモリー）と `state` を返す。`openWriteBackDb` も `unopenable` のときは空の DB（メモリー）と `state` を返し、`persist` は何もしない。`state.message`（`probeDbState` の文）が、`detail.cause` と `warn` の `cause` と `--status` の `[ERROR] DB を開けません: ` の後の文の元になる
- `src/db/location.ts`（または `index.ts`）: 文の中のホームディレクトリの部分を `~` にする関数を足す（`displayDbPath` と同じ判定。ホームディレクトリに `/` が続く部分だけを置き換え、ホームが空文字か `/` なら置き換えない）
- `src/tools/handlers.ts`: `explainDbState` に `unopenable` の枝を足し、`hint` を 029 の開けないときの文、`retryable: false`、`detail: { cause }` にし、`next_actions` から `cli_bulk_download` を外す（残りが無ければ消す）。`<--status のコマンド>` は `guideCommand('--status', location)`。`getTsutatsu`・`getQa`・`getTaxAnswer` は `openWriteBackDb` の `state.kind === 'unopenable'` のときに `logger.warn(<ツール名>, msg, { db_path, cause })` を 1 回出す。`getTsutatsu` の 007 の枝（`!rootUrl`）は、`unopenable` のとき 029 の応答（`TSUTATSU_NOT_FOUND` のまま、`hint`・`retryable`・`detail`、`next_actions` なし、`supported_for_live`・`resolved` は残す）にする。`renderLiveResult` の `not_found`（010）は、`unopenable` のとき `hint` の 2 文目を `` `nta_search_tsutatsu` で条項を検索してください`` にし（`--bulk-download` の文を書かない）、`next_actions` を `nta_search_tsutatsu` の 1 件にする
- `src/services/tax-answer-bulk-downloader.ts`: `saveTaxAnswerIndex` の `TaxAnswerIndexDbError` を投げ直さず、オプションの `onIndexSaveError?: (err: TaxAnswerIndexDbError) => void` を呼んで記事の取り込みへ進む。`TaxAnswerIndexDbError` でない例外は今までどおり投げる。結果の JSON の形は変えない
- `src/cli.ts` の `runBulkDownloadTaxAnswer`: `onIndexSaveError` で、標準エラー出力に ``[WARN] タックスアンサーの索引を DB に保存できませんでした（表: ${err.table}、DB: ${dbPath}）: ${err.cause の文}。記事の取り込みは続けます`` を出す。`dbPath` は同じ関数の `[bulk-download-tax-answer] DB: ` の行と同じ値。`process.exitCode` は設定しない
- 受入テスト（Test Designer）:
  - 029・021・006 と 10 のツールの ID: 4 つの開けない DB（SQLite でないファイル、フォルダー、パスの途中が普通のファイル、`chmod 000` のファイル）を `dbPath` で指し、10 のツールが `code`・`hint` の先頭・`retryable: false`・`detail.cause`・`next_actions` の無さを返すこと。ホームディレクトリの下に置いたパスで `hint` と `detail.cause`（パスの途中が普通のファイル）が `~` になること。DB のファイルの大きさ・中身が変わらないこと。`chmod 000` は root で走る CI では開けてしまうので、`process.getuid?.() === 0` なら飛ばす
  - 030・GET-TSUTATSU-007・010: SQLite でないファイルを `dbPath` で指し、`getTaxAnswer`・`getQa`・`getTsutatsu` に差し替えた `fetchImpl`（`src/tools/spec-20261004-db-location.test.ts` の `siteRecordingIndexHeaders` と同じ作り）を渡して、`source: "live"`・`warn` の 1 行（`captureWarns` と同じ作りで `scope` を各ツール名に）・ファイルが変わらないこと・2 回目も国税庁サイトを引くことを確かめる。`電帳法取通` で 007 の応答、候補ページに条項の無い通達で 010 の `next_actions`
  - CLI-BULK-DOWNLOAD-014: `src/tools/spec-20261004-db-location.test.ts` の `makeBrokenIndexDb` と同じ壊れた表の DB を作り、`vi.stubGlobal('fetch', …)` で索引（`tests/support/tax-answer-index.ts` の `taxAnswerIndexHtml` で No.6101 の 1 件）と記事（`tests/fixtures/www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm`）を返し、`runCliIfRequested(['--bulk-download-tax-answer', '--db-path=<DB>'])` で `[WARN]` の行・`document` の行・`tax_answer_index_page.fetched_at` が前のまま・`process.exitCode` が `undefined`（0）を確かめる。`--bulk-download-everything` はほかの 5 種別の取り込みの関数を `vi.mock` で差し替え（`src/spec-20261004-db-location.test.ts` の `vi.mock('./services/bulk-downloader.js', …)` と同じ作り）、`(5/6) タックスアンサー 失敗:` の行が無いことと、質疑応答事例の関数が呼ばれることを確かめる。記事の間の待ち（1.1 秒）を避けるため、索引は 1 件にする。`HOME` は一時フォルダーにする（件数の記録のファイルを書くため）
- 既存のテストで期待値を直すもの: 2026-10-06 JST に `grep -rn "INTERNAL_ERROR" src --include=*.test.ts` と `grep -rln "TaxAnswerIndexDbError\|no column named url" src tests` で探した範囲では、開けない DB で `INTERNAL_ERROR` を期待するツールのテストと、`--bulk-download-tax-answer` の保存の失敗で止まることを期待するテストは無い

## publish の前の確認

計画書の契約の確認（変えたツールの例を流す）に加えて、shuji の Mac で次を確かめる。公開版の DB（`~/.cache/houki-nta-mcp/cache.db`）には触らない。どのコマンドも `HOUKI_NTA_DB_PATH` か `--db-path` を付けて、`/tmp/nta-026/` の下だけを指す。

1. 受入テスト（ADDED 2・MODIFIED 17）が `npm test` で通り、`npm run check` が通る。作業コピーで `npm run build` する
2. 始める前に `shasum ~/.cache/houki-nta-mcp/cache.db` と `ls -l ~/.cache/houki-nta-mcp/` を控える（最後の 8 で比べる）
3. 4 つの開けない DB を作る

   ```bash
   mkdir -p /tmp/nta-026 && cd /tmp/nta-026
   printf 'これは SQLite のファイルではありません。%.0s' {1..100} > text.db   # SQLite でないファイル
   mkdir -p folder.db                                                   # フォルダー
   printf x > plain                                                      # パスの途中が普通のファイル（plain/cache.db）
   sqlite3 perm.db 'CREATE TABLE t(x);' && chmod 000 perm.db             # 読む権限が無いファイル
   ```

4. 4 つのそれぞれで `HOUKI_NTA_DB_PATH=<パス> node <作業コピー>/dist/index.js --status; echo "exit=$?"` を実行し、`[ERROR] DB を開けません: <文>` と `exit=1` を確かめる。macOS でのフォルダーと権限の無いファイルの文を控える（VM の Linux では `disk I/O error` と `unable to open database file`）
5. 4 つのそれぞれで、MCP サーバーを stdio で起動して読むだけのツールを呼ぶ。次の内容で `/tmp/nta-026/call.sh` を作り、`HOUKI_NTA_DB_PATH=<パス> sh /tmp/nta-026/call.sh nta_search_qa '{"keyword":"社内会議"}'` のように実行する。`nta_search_qa`・`nta_search_tsutatsu`（`{"keyword":"役員"}`）・`nta_get_jimu_unei`（`{"docId":"shotoku/000101"}`）・`nta_inspect_pdf_meta`（`{"docType":"qa-jirei","docId":"shohi/02/19"}`）で、`isError: true`、`code`、`hint` の先頭が `ローカル DB（/tmp/nta-026/…）を開けません。`（macOS の `/tmp` は `/private/tmp` へのリンクなので、`/private/tmp/…` になるかも控える）、`retryable: false`、`detail.cause`、`next_actions` が無いことを確かめる

   ```bash
   # /tmp/nta-026/call.sh <ツール名> <引数の JSON>
   NTA=<作業コピー>/dist/index.js
   { printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}' \
       '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
       "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"
     sleep 20; } | node "$NTA" 2>/tmp/nta-026/stderr.log | tail -n 1
   ```

6. 同じ 4 つのうち SQLite でないファイルと読む権限が無いファイルで、書き戻す 3 ツール（`nta_get_tax_answer` `{"no":"6101","format":"json"}`、`nta_get_qa` `{"topic":"shohi","category":"02","id":"19"}`、`nta_get_tsutatsu` `{"name":"消基通","clause":"1-4-1"}`）を呼び、国税庁サイトから取った内容（`source: "live"`）が返ること、`/tmp/nta-026/stderr.log` に `"level":"warn"` で `msg` が `ローカル DB を開けないため、DB を使わずに国税庁サイトから取ります。…` の行があること、`shasum text.db` が呼ぶ前と同じことを確かめる。`nta_get_tsutatsu` `{"name":"電帳法取通","clause":"4-1"}` で `TSUTATSU_NOT_FOUND` と開けないときの `hint` を確かめる
7. #145: 次の手順で壊れた表の DB を作り、`[WARN]` の行と終了コード 0 を確かめる（`saigai` は記事が少ないので数十秒で済む見込み。件数は確かめていない）

   ```bash
   export HOUKI_NTA_DB_PATH=/tmp/nta-026/ta.db
   node <作業コピー>/dist/index.js --bulk-download-tax-answer --tax-answer-taxonomy=saigai   # まず普通に入れる
   sqlite3 "$HOUKI_NTA_DB_PATH" "SELECT fetched_at FROM tax_answer_index_page;"
   sqlite3 "$HOUKI_NTA_DB_PATH" "DROP TABLE tax_answer_index; CREATE TABLE tax_answer_index (no TEXT PRIMARY KEY, taxonomy TEXT NOT NULL, title TEXT NOT NULL);"
   node <作業コピー>/dist/index.js --bulk-download-tax-answer --tax-answer-taxonomy=saigai --refresh; echo "exit=$?"
   sqlite3 "$HOUKI_NTA_DB_PATH" "SELECT fetched_at FROM tax_answer_index_page; SELECT COUNT(*) FROM document WHERE doc_type='tax-answer';"
   unset HOUKI_NTA_DB_PATH
   ```

   2 回目の実行で `[WARN] タックスアンサーの索引を DB に保存できませんでした（表: tax_answer_index、DB: /tmp/nta-026/ta.db）: table tax_answer_index has no column named url。記事の取り込みは続けます`、記事の進捗の行、`exit=0` が出ること、`tax_answer_index_page.fetched_at` が 1 回目の値のままであることを確かめる
8. `shasum ~/.cache/houki-nta-mcp/cache.db` と `ls -l ~/.cache/houki-nta-mcp/` が 2 と同じことを確かめ、`chmod 600 /tmp/nta-026/perm.db && rm -rf /tmp/nta-026` で片付ける
9. 結果を実装 PR の本文に書く

## 取り込みのとき（Publisher）

- ADDED の見出しを、各 `specs/current/<dir>/spec.md` の「できること」の末尾に足す。MODIFIED は見出しの行（題）も含めて、差分の見出しと本文に置き換える
- 各差分の spec.md の冒頭に書いた、ID の無い節の変更（「関連する Issue」、common_errors の「エラーの code」の表、db_schema の「処理の流れ」の図）を行う
- 14 の `specs/current/<dir>/spec.md` の承認日の行に「差分 `20261006-db-failure-paths` は YYYY-MM-DD（PR #N）」を足す
- この差分のフォルダーを `specs/releases/v0.26.0/20261006-db-failure-paths/` へ移し（`git mv`）、この proposal.md の「状態」を取り込み済みにする
- CHANGELOG の 0.26.0 に閉じる Issue（#144・#145）を書く

## 人が判断すること

1. **#144 の code（DB-SCHEMA-029・021、COMMON-ERRORS-006、10 のツールの ID）。** 案は (A) `DOC_NOT_FOUND`（基本通達は `TSUTATSU_NOT_FOUND`）に寄せ、029 の表に「開けない」の行を足す / (B) `INTERNAL_ERROR` のまま `hint` だけを DB の状態の文にする / (C) 新しい code（例: `LOCAL_DB_UNAVAILABLE`）を足す。A は「DB に 1 件も無い」ときの応答と同じ形で、版の合わない DB と同じ扱い（`code` を変えずに `hint` で状態を書く）になる。family の code の一覧（houki-research-skill の `docs/ERROR-CODES.md`）と houki-egov-mcp に code が増えない。B は「不具合の報告を求める」という 006 の意味と合わない。C は Skill と houki-egov-mcp の一覧にも影響する。**勧める: A（2026-10-06 の出発点のとおり）**
2. **`hint` の文と、SQLite の文の置き場所（DB-SCHEMA-029）。** 案は (A) `hint` に SQLite の文を入れず、`detail.cause` に入れる / (B) Issue の例のとおり `hint` の括弧に入れる（``ローカル DB（<パス>）を開けません（<SQLite の文>）。…``）。4 つの場面で A と B の `hint` の先頭は次のとおり（ホームディレクトリが `/Users/bonji`、文は 2026-10-06 JST に VM の Linux で `probeDbState` が返したもの）

   | 場面 | A の `hint` の先頭（`detail.cause`） | B の `hint` の先頭 |
   | --- | --- | --- |
   | SQLite でないファイル `~/.cache/houki-nta-mcp/cache.db` | `ローカル DB（~/.cache/houki-nta-mcp/cache.db）を開けません。パスがフォルダーを指していないか、…`（`file is not a database`） | `ローカル DB（~/.cache/houki-nta-mcp/cache.db）を開けません（file is not a database）。…` |
   | フォルダー `~/.cache/houki-nta-mcp/cache.db` | 同じ文（`disk I/O error`） | `…を開けません（disk I/O error）。…` |
   | パスの途中が普通のファイル `~/plain/cache.db` | `ローカル DB（~/plain/cache.db）を開けません。…`（`ENOTDIR: パスの途中が普通のファイルです (~/plain)`） | `…を開けません（ENOTDIR: パスの途中が普通のファイルです (~/plain)）。…` |
   | 読む権限が無いファイル | 同じ文（`unable to open database file`） | `…を開けません（unable to open database file）。…` |

   A を勧めるのは、(1) SQLite と OS の文は場面と合わないことがある（フォルダーで `disk I/O error`。DB を開く処理の例外ではさらに `unable to open database file` になる）ため、`hint` で利用者に見せると原因を取り違えやすい、(2) 確かめることを 4 つ並べれば、文が無くても直し方が分かる、(3) 理由は `hint` が案内する `--status` で同じ文が出る、(4) houki-egov-mcp の `note` も SQLite の文を入れていない、ため。B は 1 回の応答で理由まで分かる。**勧める: A**
3. **`detail.cause` の中のホームディレクトリを `~` にする（DB-SCHEMA-029）。** パスの途中が普通のファイルのときの文は普通のファイルの絶対パスを含む。0.25.x の `INTERNAL_ERROR` の `detail.cause` はホームを含む絶対パスのままだった。T6 の (a)「MCP の応答ではホームを `~` に置き換える」に合わせる。**勧める: `~` にする**
4. **`retryable: false`（DB-SCHEMA-029）。** DB のファイルを直すまで結果は変わらない。029 のほかの行（ファイルが無いなど）には今までどおり `retryable` を付けないので、開けない行だけが `retryable` を持つ。**勧める: false**
5. **`--status` を `next_actions` に入れるか（DB-SCHEMA-029）。** 今の `next_actions` の型（`action: string`）には入れられるが、CLI を案内する `action` は `cli_bulk_download` だけで、`--status` を表す名前は無い。案は (A) `next_actions` に入れず、`hint` の文だけで案内する / (B) 新しい `action: "cli_status"`（`example.command` に `<--status のコマンド>`）を足す。B は LLM がコマンドを `hint` から切り出さずに済むが、family の `action` の名前が増え、Skill の `ERROR-HANDLING.md` と common_errors の「エラー応答のフィールド」の表に足す必要がある。`--status` を案内するのは開けない DB だけで、`cli_bulk_download` と違って実行しても DB は直らない（理由を見るだけ）。**勧める: A（出発点のとおり）**
6. **`hint` の `--status` のコマンドに DB の場所の設定を付ける（DB-SCHEMA-027・029）。** 029 の「その種別が無い」ときの `--status` は、投入したシェルの設定を確かめるために変数を付けない（0.25.0 の人が判断すること 6）。開けないときの `--status` は、MCP サーバーが開こうとした DB の理由を見るためのものなので、027 の形（`HOUKI_NTA_DB_PATH="$HOME/…" npx -y …@latest --status`）にした（T6 の (c)）。**勧める: このまま**
7. **書き戻す 3 ツール（DB-SCHEMA-030、GET-TSUTATSU-007・010）。** 出発点は「国税庁サイトから取れた内容は返し、DB に書けないことを `logger.warn` に出す。サイトからも取れないときは 1〜4 の応答にする」。この差分では「サイトからも取れないとき」を、国税庁サイトに取りに行く先の無い通達（GET-TSUTATSU-007）に限り、国税庁サイトとの通信の失敗（`SOURCE_*`）・ページが無い（404 の `DOC_NOT_FOUND`）・ページの解析の失敗（`INTERNAL_ERROR`）・候補ページに条項が無い（`ARTICLE_NOT_FOUND`）は今までの応答のまま（`next_actions` の `cli_bulk_download` だけ外す）にした。これらを 1〜4 の応答にすると、`SOURCE_*` の `retryable: true`（時間をおけば取れる）が `false` になり、404（番号の誤り）や解析の失敗（国税庁サイトの構造の変更）の原因が `hint` から消えるため。どの場合も `warn` の行で DB を開けないことが残る。案は (A) この差分のとおり / (B) 出発点の文のとおり、国税庁サイトから取れなかったときはすべて 1〜4 の応答にする / (C) A に加えて、今までの応答の `hint` の後ろに「ローカル DB（<パス>）を開けないため、DB は使っていません」の 1 文を足す。**勧める: A**
8. **`warn` を出す回数と形（DB-SCHEMA-030）。** DB を開こうとした呼び出しごとに 1 行、国税庁サイトから取れたかによらない。`scope` は呼んだツールの名前（018 の `nta_get_tax_answer` と同じ考え方）、`meta` は `db_path`（絶対パス）と `cause`（開けない理由の文。`~` にしない）。018 の `meta.error`（`name` と `message`）と違うのは、開けない理由が `probeDbState` の文だけで例外の名前を持たないため。**勧める: このまま**
9. **`error` の文を変えない（DB-SCHEMA-029、10 のツールの ID）。** 開けない DB でも `error` は「ローカル DB に<種別>が 1 件も無いため…」のままで、厳密には事実と合わない。版の合わない DB でも同じ文を使っている（021 の注 1「`code` は変えない」、029「`code`・`error` … は変えない」）。案は (A) 変えない / (B) 開けないときだけ `ローカル DB を開けないため、検索できません` などに変える。**勧める: A（版の合わない DB と揃え、状態は `hint` の先頭で見分ける）**
10. **置き場所のフォルダーに入る権限が無いとき（この差分の外）。** `probeDbState` は `existsSync` が false を返すので「ファイルが無い」と判定する。読むだけのツールは「ファイルがありません」の `hint`、`--status` は `(DB がまだありません — …)` で終了コード 0、投入のフラグは `[ERROR] DB を開けません: unable to open database file` で終了コード 1 になり、入口ごとに食い違う（2026-10-06 JST に VM で確かめた）。直すには `probeDbState` の判定（`--status` の終了コードを含む CLI の動き）を変える必要があり、この Issue の「CLI は変えない」の外なので、この差分では変えない。**勧める: 別の Issue にする（下の「この差分の外で見つけたこと」1）**
11. **版。** 0.26.0（minor）。開けない DB の `code` が変わり、書き戻すツールと `--bulk-download-tax-answer` の終わり方が変わる。DB のスキーマの版は 12 のまま。**勧める: このまま**
12. **#145 の続けるか止めるか（CLI-BULK-DOWNLOAD-014、DB-SCHEMA-025）。** 案は (A) 続ける。保存の失敗は標準エラー出力に `[WARN]` の行（表の名前・DB の場所・SQLite の文） / (B) 止める。終了コード 1 で `[ERROR]` の行。A を勧めるのは、記事の URL はこの実行で取った索引で決まり、保存した索引は `nta_get_tax_answer` が索引を取り直さずに済むための写しなので、保存できなくても取り込みの目的は果たせるため（#137・SPEC-NTA-GET-TAX-ANSWER-018 と同じ考え方）。**勧める: A（出発点のとおり）**
13. **#145 の終了コード（CLI-BULK-DOWNLOAD-014）。** cli_bulk_download に ID の付いた終了コードの決まりは無く、「未決」1 に「種別の中で節や文書の取得に失敗しても 0」とある（テストは無い）。`src/cli.ts` も、記事ごとの失敗と `--bulk-download-everything` の種別ごとの失敗では `process.exitCode` を設定しない（VM で `--bulk-download-everything` の種別の失敗が終了コード 0 になることを確かめた）。案は (A) 0（記事を取り込めたなら 0。`[WARN]` の行で気付ける） / (B) 1（保存の失敗を処理の失敗として扱う。CLI-ENTRY の「処理の失敗は 1」）。B にすると、記事ごとの失敗や種別の失敗が 0 なのに、写しの保存の失敗だけが 1 になる。**勧める: A**
14. **#145 の `--bulk-download-everything`（CLI-BULK-DOWNLOAD-014）。** A なら、タックスアンサーの段は失敗にならず次の種別へ進む。種別ごとの失敗を受け取って次へ進む作りは変えない。**勧める: このまま**
15. **`[WARN]` の行の形（CLI-BULK-DOWNLOAD-014）。** `[WARN] タックスアンサーの索引を DB に保存できませんでした（表: <表の名前>、DB: <DB の場所>）: <エラーの文>。記事の取り込みは続けます`。`<DB の場所>` は同じ実行の `DB: ` の行と同じ値（CLI の出力は `--db-path` / `HOUKI_NTA_DB_PATH` の値をそのまま出す。SPEC-NTA-DB-SCHEMA-026）。`[WARN]` の接頭辞は `--status` の同じフォルダーの別の DB の行（SPEC-NTA-CLI-STATUS-002）と同じ。**勧める: このまま**
16. **承認日。** この proposal.md の「- 承認日:」に日付と PR 番号を書く（shuji がマージの前に）

## 確かめた値

| 何を | 結果 | いつ・どうやって | 使った仕様 ID |
| --- | --- | --- | --- |
| 起点 | main `c029602`（v0.25.1 の取り込み）、origin の main `c0296023c2cd…` と同じ。`specs/changes/` は `.gitkeep` だけ | 2026-10-06 JST、`git ls-remote https://github.com/shuji-bonji/houki-nta-mcp refs/heads/main` と `ls -la specs/changes/` | — |
| 開けない DB の判定の文 | SQLite でないファイル `file is not a database`、フォルダー `disk I/O error`、パスの途中が普通のファイル `ENOTDIR: パスの途中が普通のファイルです (<絶対パス>)`、`chmod 000` のファイル `unable to open database file` | 2026-10-06 JST、Cowork の VM（Linux aarch64、Node 22.23.2、better-sqlite3 12.11.1）で `probeDbState` を呼んだ | DB-SCHEMA-029 |
| 今の読むだけ・書き戻すツールの動き | 7 ツールとも 4 つの場面でハンドラーが例外を投げた。例外の文はフォルダー・権限・パスの途中（1 段）で `unable to open database file`、パスの途中（2 段）で `ENOTDIR: not a directory, mkdir '<絶対パス>'`。書き戻す 3 ツールの `fetch` の呼ばれた回数は 0 | 同上。作業用のテストでハンドラーを直接呼んだ（`src/server.ts` の `catch` は通していない） | 今の動き |
| 今の `--status` と投入のフラグ | 4 つの場面で `[ERROR] DB を開けません: <判定の文>`、終了コード 1。置き場所のフォルダーが `chmod 000` のときは `--status` が `(DB がまだありません — …)` で終了コード 0、`--bulk-download-qa` が `[ERROR] DB を開けません: unable to open database file` で終了コード 1 | 同上。`runCliIfRequested` を呼んだ | DB-SCHEMA-021、人が判断すること 10 |
| `next_actions` の型と action の名前 | `NextAction` は `action: string`・`reason: string`・`example?`。テストを除く `src` の `action: '…'` は `cli_bulk_download`（4）・`delegate_to_mcp`（3）・`list_tools`（3）・`nta_search_tax_answer`（2）など。`--status` を表す名前は無い | `src/errors.ts` を読み、`grep -rn "action: '" src --include=*.ts`（テストを除く） | 人が判断すること 5 |
| 今の `--bulk-download-tax-answer` | 壊れた表の DB で `runCliIfRequested` が `SqliteError: table tax_answer_index has no column named url` で reject。`document` は 0 行、標準出力は空 | 2026-10-06 JST、VM の作業用のテスト。`fetch` を `vi.stubGlobal` で差し替え、索引は No.6101 の 1 件 | CLI-BULK-DOWNLOAD-014 |
| 今の `--bulk-download-everything` | `(5/6) タックスアンサー 失敗: table tax_answer_index has no column named url` の後に質疑応答事例へ進み、`process.exitCode` は `undefined` | 同上。ほかの 5 種別の取り込みの関数は `vi.mock` で差し替えた | CLI-BULK-DOWNLOAD-014 |
| 終了コードを設定する箇所 | `src/cli.ts` の `process.exitCode =` は引数の誤り（2）、`--status`、`prepareIngestDb` の失敗（1）、`--refresh-stale` の DB の失敗（1）だけ | `grep -n exitCode src/cli.ts` | 人が判断すること 13 |
| `npx spec-ids next` | db_schema 030、cli_bulk_download 014（common_errors 020・nta_get_tsutatsu 019 なども取ったが使わない） | 2026-10-06 JST、VM の作業用のフォルダーに `specs/` を写して `npx --no-install spec-ids next <dir>` | 変わる仕様 ID |
| houki-research-skill の該当箇所 | 「互換性」の Skill の表 | 2026-10-06 JST、`skills/houki-research-skill`（main `0889824`）で grep（CHANGELOG を除く） | 互換性 |
| houki-hub の呼び出し例 | 開けない DB の例は無い | 2026-10-06 JST、houki-hub main `f37d8d5` で grep | 呼び出し例への影響 |
| houki-egov-mcp の開けない行 | 027・044 の `note` の先頭 `ローカル DB (<パス>) を開けなかったため`、続きは確かめる 3 つ、`next_actions` は `search_law` の 1 件 | `mcp/houki-egov-mcp/specs/current/search_fulltext/spec.md` を読んだ | houki-egov-mcp と文を変えた箇所 |

## 確かめていない点

1. Issue #144・#145 の GitHub の本文。この会話のクラウドの環境から `api.github.com` を引く操作が許可されなかったので、houki-hub `docs/notes/issues-2026-10-05-nta-0.25.0-followups/01-unopenable-db-hint.md`・`02-bulk-tax-answer-index-save-failure.md`（起票の下書き。`created.tsv` は無い）を読んで代えた。起票した本文が下書きと同じかは確かめていない
2. macOS（APFS）での、フォルダーと読む権限の無いファイルの判定の文（VM の Linux では `disk I/O error` と `unable to open database file`）。publish の前の確認 4 で控える
3. `node dist/index.js` を別のプロセスとして起動したときの今の動き（MCP の応答が `INTERNAL_ERROR` になることと、`--bulk-download-tax-answer` が `fatal error` のログを出して終了コード 1 で終わること）。どちらも同じプロセスで関数を呼んだ結果と、`src/server.ts`・`src/index.ts` を読んだ結果から書いた
4. root で走る CI（GitHub Actions の `ubuntu-latest` は root ではない見込み）で `chmod 000` のファイルを開けてしまうか
5. Windows での開けない DB の文と `chmod`
6. publish の前の確認 5 の `call.sh`（`initialize` の `protocolVersion` と 20 秒の待ち）で、MCP SDK v2 のサーバーがそのまま応答を返すか。返さないときは houki-nta-dev（Claude Desktop）の `env` を書き換えて確かめる
7. `--tax-answer-taxonomy=saigai` の記事の数と所要時間（publish の前の確認 7）

## この差分の外で見つけたこと

1. **置き場所のフォルダーに入る権限が無いときの判定（人が判断すること 10）。** Issue にするなら「`probeDbState` が `existsSync` で確かめられないフォルダーの下の DB を『ファイルが無い』と判定し、読むだけのツール・`--status`・投入のフラグで扱いが食い違う」。`statSync` の `EACCES` を見て `unopenable` にするかを決める
2. **`nta_get_tsutatsu` の 007 の案内（SPEC-NTA-GET-TSUTATSU-007）。** ライブ取得に対応していない通達（例: `電帳法取通`）に `--bulk-download --tsutatsu="<正式名>"` を案内するが、`--tsutatsu` は基本通達 4 種の正式名しか受け付けない（SPEC-NTA-CLI-BULK-DOWNLOAD-011。ほかの値は終了コード 2）。DB を開けるときも、案内のコマンドを実行すると引数の誤りで止まる。Issue にするなら「SPEC-NTA-GET-TSUTATSU-007 の `cli_bulk_download` は実行できないコマンドを案内している」
3. **開けない DB の文が入口で違う。** `--status` と投入のフラグは `probeDbState` の読み取り専用の open の文（フォルダーで `disk I/O error`）を出し、0.25.x のツールは `openDb` の読み書きの open の文（同じフォルダーで `unable to open database file`）を `detail.cause` に出していた。この差分で、ツールも `probeDbState` の文にそろう（DB-SCHEMA-029）

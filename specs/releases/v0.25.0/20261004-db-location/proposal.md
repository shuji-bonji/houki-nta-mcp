---
approved: 2026-10-05
pr: 142
implementation: required
targets: [cli_entry, cli_status, common_errors, db_schema, nta_get_bunshokaitou, nta_get_jimu_unei, nta_get_kaisei_tsutatsu, nta_get_tax_answer, nta_inspect_pdf_meta, nta_search_bunshokaitou, nta_search_jimu_unei, nta_search_kaisei_tsutatsu, nta_search_qa, nta_search_tax_answer, nta_search_tsutatsu, search_rules]
---
# 変更: ローカル DB の場所を、応答・起動時のログ・`--status` で確かめられるようにし、保存したタックスアンサーの索引を読めないことをログに残す（nta #138・#137、T6）

- 対象: `db_schema` / `search_rules` / `cli_status`（新規）/ `cli_entry` / `common_errors` / `nta_search_tsutatsu` / `nta_search_qa` / `nta_search_tax_answer` / `nta_search_kaisei_tsutatsu` / `nta_search_jimu_unei` / `nta_search_bunshokaitou` / `nta_get_kaisei_tsutatsu` / `nta_get_jimu_unei` / `nta_get_bunshokaitou` / `nta_get_tax_answer` / `nta_inspect_pdf_meta` の `specs/current/<dir>/spec.md`
- 実装の変更の補足: 下の「実装の変更」
- 状態: 取り込み済み（v0.25.0）
- 起こした日: 2026-10-04（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #138（開いている DB のパスが応答に出ず、残っている別の DB にも気付けない）、#137（`readStoredTaxAnswerIndex` が SQL の例外をすべて受け取って `null` を返すため、壊れた表と表が無い DB を区別できない）
- 規則の正本: houki-hub `docs/DECISIONS.md` の 2026-10-04 の行「T6 ローカル DB の場所の見え方」の (a)〜(f) と、「houki-nta-mcp #137」の行
- 写した元: houki-egov-mcp 0.20.0 の差分 `20261004-db-location`（PR #114、houki-egov-mcp `specs/releases/v0.20.0/20261004-db-location/`）の proposal.md の「houki-nta-mcp に写すとき」と、差分の spec.md（SPEC-EGOV-DB-SCHEMA-028・029、SPEC-EGOV-SEARCH-FULLTEXT-042・043・044、SPEC-EGOV-CLI-STATUS-013・014、SPEC-EGOV-CLI-ENTRY-012）
- 前提: main の `09ed4de`（v0.24.1 の取り込み）から切った。2026-10-04 JST に `git ls-remote https://github.com/shuji-bonji/houki-nta-mcp.git main` で origin の main と同じことを確かめた。`specs/changes/` にほかの差分は無い
- 版: 0.25.0（minor。検索の応答の `freshness` の形、`hint` の文、案内のコマンド、CLI のフラグと出力が変わる）。DB のスキーマの版は 12 のまま

## なぜ変えるか

2026-10-04 JST に houki-egov-mcp で、plugin（`env` を持たない）と手元のサーバー（`HOUKI_EGOV_DB_PATH` 付き）が別の DB を開いていて、応答からどのファイルの結果かが分からない問題が見つかった（houki-egov-mcp #108・#110）。houki-nta-mcp にも同じ形がある（#138）。

- plugin は `env` を持たないので `~/.cache/houki-nta-mcp/cache.db` を開く。macOS の Claude Desktop はシェルの `.zshrc` の環境変数を受け継がないので、`.zshrc` で `XDG_CACHE_HOME` や `HOUKI_NTA_DB_PATH` を設定している利用者は、CLI で投入した DB を plugin が見つけられない
- 「DB に 1 件も無い」ときの `hint` には開いた DB のパスが入るが、ファイルが無いのか、ファイルはあるがその種別が無いのかを区別しない（どちらも `MCP サーバーが開いている DB（<パス>）に<種別>（doc_type="…"）が入っていません`）。成功した応答（`freshness`）と MCP サーバーの起動時のログにはパスが出ない
- 案内のコマンドは `houki-nta-mcp --bulk-download-qa` の形で、グローバルにインストールしていないと `command not found`、`npx houki-nta-mcp` は npm に無い名前で 404 になる。`HOUKI_NTA_DB_PATH` を付けて起動したサーバーの案内に従って変数を付けずに実行すると、別のファイル（既定の `cache.db`）に投入してしまう
- CLI に DB の場所と中身を確かめる手段が無い（`--status` が無い。`--health-check` は国税庁サイトの確認）

#137 は、v0.24.0 の実装 PR #136 のレビューで挙がった。保存したタックスアンサーの索引の表が壊れている（列が足りない）DB では、`nta_get_tax_answer` を呼ぶたびに索引を条件なしで取り直し、保存にも失敗するが、どちらもログにも応答にも出ない。

## 今の動き（v0.24.1）

- DB の場所は `src/db/index.ts` の `defaultDbPath()`: `HOUKI_NTA_DB_PATH`（空文字は無いもの）→ `$XDG_CACHE_HOME/houki-nta-mcp/cache.db`（空文字は無いもの）→ `~/.cache/houki-nta-mcp/cache.db`。CLI は `--db-path=<path>` があればそれを先に使う
- 検索 6 ツールの `freshness` は `oldest_fetched_at`・`newest_fetched_at`・`staleness`・`days_since_oldest`（と `warning`）の 4 つで、DB のパスを持たない。範囲に文書が 1 件も無いときは `freshness` を付けない（SPEC-NTA-SEARCH-RULES-017）
- `freshness.warning` は `最新化するには \`--bulk-download-qa\` を実行してください` とフラグだけを書く
- 読むだけのツールの「DB に 1 件も無い」ときの `hint`（`explainDocZeroHits`・`explainDocIdNotFound`）は、DB のファイルが無いときも、版の記録が無いときも、DB はあるがその種別が無いときも、`MCP サーバーが開いている DB（<絶対パス>）に<種別>（doc_type="…"）が入っていません。\`houki-nta-mcp <フラグ>\` で投入してください。投入したはずの場合は、…環境変数 HOUKI_NTA_DB_PATH / XDG_CACHE_HOME が同じか確認してください` の 1 つの文。パスはホームディレクトリを含む絶対パス
- `nta_search_tsutatsu` の `TSUTATSU_NOT_FOUND` の `hint` は `初回は \`houki-nta-mcp --bulk-download-all\` を実行して…` で、DB のパスを含まない
- 版の合わない DB の `hint`（SPEC-NTA-DB-SCHEMA-021 の注 2）は `MCP サーバーが開いている DB（<絶対パス>）の版 …` で始まる
- `nta_inspect_pdf_meta` の `DOC_NOT_FOUND` の `hint` は、DB があるかどうかによらず `` `--bulk-download-<docType>` で投入済みか確認してください`` で、`docType` が `qa-jirei` のときは無いフラグ `--bulk-download-qa-jirei` を書く
- 案内のコマンドは、`next_actions[].example.command`（`NEXT_ACTIONS.bulkDownload`・`bulkDownloadAll`・`bulkDownloadDocs`、`unreadableFetchedAt`）、各 `hint`、CLI のエラーの文（`formatDbEntryError`、`[refresh-stale] DB がまだありません …`）のどれも `houki-nta-mcp --<フラグ>` の形
- MCP サーバーの起動時のログは `msg` が `<パッケージ名> v<版> started (…)` の JSON の 1 行で、DB のパスを出さない（`src/index.ts`）
- `--status` は無い（`houki-nta-mcp --status` は `ERROR: 未知のフラグ: --status` で終了コード 2）
- `readStoredTaxAnswerIndex`（`src/services/tax-answer-index.ts`）は SQL の例外をすべて受け取って `null` を返す。`resolveTaxAnswerUrl`（`src/tools/handlers.ts`）は `saveTaxAnswerIndex` と `touchTaxAnswerIndexPage` の例外を `catch {}` で捨てる

## 変えた後の動き

1. **検索 6 ツールの成功の応答は `freshness` を常に持ち、`db_path` に引いた DB のパスを入れる（a。SEARCH-RULES-022、017・SEARCH-TSUTATSU-004 を MODIFIED）。** ホームディレクトリの部分は `~` にする（DB-SCHEMA-028）。範囲に文書が無いときも `freshness` を付け、取得日時の 4 つを `null` にする
2. **「DB に 1 件も無い」ときの `hint` を DB の状態ごとに分け、先頭を事実に合う文にする（b。DB-SCHEMA-029、021 と 10 のツールの ID を MODIFIED）。** ファイルが無い・`HOUKI_NTA_DB_PATH` が指すファイルが無い・版の記録が無い・その種別が無い、の 4 つ。どれも開こうとしたパス（`~` の形）を含む。版の合わない DB の文も `ローカル DB（<パス>）の版 …` で始める
3. **案内のコマンドを `npx -y @shuji-bonji/houki-nta-mcp@latest <フラグ>` にし、DB の場所を決めた設定を同じ形で付ける（c。DB-SCHEMA-026・027）。** 環境変数なら前に `HOUKI_NTA_DB_PATH=…` / `XDG_CACHE_HOME=…`、CLI の `--db-path` なら後ろに `--db-path=…`。`freshness.warning` もこの形にする
4. **MCP サーバーの起動時のログに、DB の絶対パスと DB の場所の設定を出す（d。CLI-ENTRY-009。egov の SPEC-EGOV-CLI-ENTRY-012 に当たる）。** `started` の次の JSON の行で、`msg` は `DB: <絶対パス>（DB の場所の設定: <名前>）`
5. **`--status` を新しく足す（e。cli_status の 001〜008、CLI-ENTRY-002・004・007 を MODIFIED、DB-SCHEMA-021 に「確かめる」入口）。** DB の場所・DB の場所の設定・同じフォルダーの別の `cache*.db` の `[WARN]`・版・種別ごとの件数と取得日時の範囲を出す。DB を作らず、移行もしない。DB が無くても終了コード 0
6. **保存したタックスアンサーの索引を読めない・保存できないときは、記事を返したうえで MCP サーバーのログに `warn` を出す（#137。GET-TAX-ANSWER-018、DB-SCHEMA-025 を MODIFIED）。** 「索引の行が無い」ときだけを「まだ保存していない」とし、ほかの SQL の例外はログに表の名前と DB の絶対パスを出す。応答は変えない
7. **既定のファイル名は `cache.db` のまま（f）。** db_schema の「できないこと」に 1 行書く。開発で版を上げるときの「ローカル DB を使う開発」の節を CONTRIBUTING.md に置く（実装 PR で直す文書 5）

## 変わる仕様 ID

| 種類 | 仕様 ID |
| --- | --- |
| ADDED | SPEC-NTA-DB-SCHEMA-026・027・028・029、SPEC-NTA-SEARCH-RULES-022、SPEC-NTA-CLI-STATUS-001〜008、SPEC-NTA-CLI-ENTRY-009、SPEC-NTA-GET-TAX-ANSWER-018 |
| MODIFIED | SPEC-NTA-DB-SCHEMA-021・025、SPEC-NTA-SEARCH-RULES-017、SPEC-NTA-CLI-ENTRY-002・004・007、SPEC-NTA-COMMON-ERRORS-017、SPEC-NTA-SEARCH-TSUTATSU-003・004、SPEC-NTA-SEARCH-QA-001・005、SPEC-NTA-SEARCH-TAX-ANSWER-001、SPEC-NTA-SEARCH-KAISEI-TSUTATSU-001、SPEC-NTA-SEARCH-JIMU-UNEI-001、SPEC-NTA-SEARCH-BUNSHOKAITOU-001・002、SPEC-NTA-GET-KAISEI-TSUTATSU-001・002、SPEC-NTA-GET-JIMU-UNEI-001・002、SPEC-NTA-GET-BUNSHOKAITOU-002・003、SPEC-NTA-INSPECT-PDF-META-001 |
| REMOVED | なし |

ADDED 15、MODIFIED 23、REMOVED 0。触る dir は 16（`cli_status` は新しい spec.md）。ID は 2026-10-04 JST に `npx --no-install spec-ids next <dir>` で取った（`db_schema` 026、`search_rules` 022、`cli_entry` 009、`nta_get_tax_answer` 018、`cli_status` 001）。

DECISIONS.md の a〜f との対応:

| 規則 | この差分の答え | 仕様 ID |
| --- | --- | --- |
| a 応答のパス | `freshness.db_path` を検索 6 ツールの成功の応答に常に置く。ホームを `~` に置き換える。CLI の出力と起動時のログは絶対パス | SEARCH-RULES-022・017、DB-SCHEMA-028、SEARCH-TSUTATSU-004 |
| b DB が無いときの文 | 先頭を `ローカル DB（<パス>）がありません` などに分け、`HOUKI_NTA_DB_PATH` が指すファイルが無いときは別の文。版の合わない DB の文も先頭を揃える | DB-SCHEMA-029・021、SEARCH-TSUTATSU-003、SEARCH-QA-001、SEARCH-TAX-ANSWER-001、SEARCH-KAISEI-TSUTATSU-001、SEARCH-JIMU-UNEI-001、SEARCH-BUNSHOKAITOU-001、GET-KAISEI-TSUTATSU-001、GET-JIMU-UNEI-001、GET-BUNSHOKAITOU-002、INSPECT-PDF-META-001 |
| c 案内のコマンド | `npx -y @shuji-bonji/houki-nta-mcp@latest <フラグ>`。環境変数は前に、`--db-path` は後ろに付ける | DB-SCHEMA-026・027、021、SEARCH-RULES-017、COMMON-ERRORS-017、SEARCH-QA-005、SEARCH-BUNSHOKAITOU-002、GET-KAISEI-TSUTATSU-002、GET-JIMU-UNEI-002、GET-BUNSHOKAITOU-003、ほか b の ID |
| d 起動時のログ | `started` の次の JSON の行。`msg` は `DB: <絶対パス>（DB の場所の設定: <名前>）`、`meta` に `db_path`・`setting` | CLI-ENTRY-009 |
| e 確かめる手段 | `--status` を新しく足す。行の形は houki-egov-mcp の `--status` に合わせる | CLI-STATUS-001〜008、CLI-ENTRY-002・004・007、DB-SCHEMA-021 |
| f ファイル名に版を入れない | 入れない。db_schema の「できないこと」に書き、CONTRIBUTING.md に「ローカル DB を使う開発」を置く | —（ID なし。実装 PR で直す文書 5） |

Issue の「決めること」との対応:

| Issue の決めること | この差分の答え |
| --- | --- |
| #138 の 1（houki-egov-mcp と同じ形にするか） | 同じ形にする（DECISIONS.md の T6）。違えた箇所は下の「houki-egov-mcp と文を変えた箇所」 |
| #138 の 2（確かめるコマンドの名前） | `--status`（houki-egov-mcp と同じ） |
| #138 の 3（`--db-path` のときも同じように表示するか） | 表示する。DB の場所の設定に `--db-path` を足す（DB-SCHEMA-026、CLI-STATUS-001）。案内のコマンドには後ろに `--db-path=…` を付ける（DB-SCHEMA-027。人が判断すること 3） |
| #138 の 4（ファイル名の版をどの版から始めるか） | 入れない（DECISIONS.md の (f)） |
| #137 の 1（`null` を「索引の行が無い」ときだけにし、ほかは `INTERNAL_ERROR` にするか） | `null` は「索引の行が無い」ときだけ。ほかは `INTERNAL_ERROR` にせず、記事を返してログに出す（DECISIONS.md の #137 の行） |
| #137 の 2（`hint` に何を書くか） | `INTERNAL_ERROR` にしないので `hint` は無い。ログの `msg` に表の名前と DB の絶対パス（GET-TAX-ANSWER-018） |
| #137 の 3（`saveTaxAnswerIndex` と `touchTaxAnswerIndexPage` の失敗） | どちらも `logger.warn` に出す（人が判断すること 16） |
| #137 の 4（`INTERNAL_ERROR` にするか、記事を返して知らせるか） | 記事を返し、応答にはフィールドを足さない。知らせるのはログだけ |

## 変わらない振る舞い

- 応答のフィールドを消す・名前を変える変更は無い（T4）。`code` も変えない。足すのは `freshness.db_path` と、範囲に文書が無いときの `freshness`（取得日時の 4 つが `null`）
- 検索・取得の結果（`hits`・`results`・記事の本文）、0 件の理由の分け方、`next_actions` の `action`、版の合わない DB で `cli_bulk_download` を入れない規則（SPEC-NTA-DB-SCHEMA-021）
- `freshness` の取得日時の範囲の決め方（SPEC-NTA-SEARCH-RULES-017。v0.24.1 の索引から消えた文書を除く規則を含む）と、`warning` を付ける条件（`outdated` のときだけ）
- DB の場所の決まり方と優先の順（`--db-path` → `HOUKI_NTA_DB_PATH` → `XDG_CACHE_HOME` → 既定）。既定のファイル名は `cache.db` のまま
- DB を作る入口・移行する入口・作り直す入口（SPEC-NTA-DB-SCHEMA-021。足すのは何も書かない「確かめる」入口だけ）
- CLI の終了コードの規則（引数の誤りは 2、処理の失敗は 1）と、既存のフラグの出力の行の形（`DB: ` の行は今までどおり値のまま）
- `--help` の使い方のコマンドの形（`houki-nta-mcp <フラグ>`。足すのは `--status` の行）、`--quickstart` が終わった後の「次に試すこと」の行
- tools/list のツールの説明（フラグだけを書いていて、`houki-nta-mcp --` の形を含まない。2026-10-04 に `src/tools/definitions.ts` を grep）
- DB を開けない（フォルダー、SQLite でないファイルなど）ときの読むだけのツールの応答（SPEC-NTA-COMMON-ERRORS-006 の `INTERNAL_ERROR`）。人が判断すること 13
- `--bulk-download-tax-answer` が索引の保存に失敗したときの扱い（DB-SCHEMA-025 に「この差分では変えない」と書いた）
- `resolve_abbreviation`・`nta_get_qa`・`nta_get_tsutatsu` の応答（`nta_get_tsutatsu` は `hint` と `next_actions` の中のコマンドの形だけが変わる。SPEC-NTA-GET-TSUTATSU-007・010 の文はフラグだけを書いているので MODIFIED にしない）

## 互換性（0.25.0 の CHANGELOG の「互換性」の節に書くもの）

| 場面 | 0.24.x | 0.25.0 |
| --- | --- | --- |
| 検索 6 ツールの成功の応答の `freshness` | `db_path` が無い | `freshness.db_path` に引いた DB のパス（ホームは `~`） |
| 範囲に文書が無いときの `freshness` | キーが無い | 取得日時の 4 つが `null`、`db_path` は DB のパス |
| `freshness.warning` のコマンド | `` `--bulk-download-qa` ``（フラグだけ） | `` `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` ``（環境変数で起動したときは前に変数が付く） |
| 「DB に 1 件も無い」ときの `hint` の先頭 | どの場面でも `MCP サーバーが開いている DB（<絶対パス>）に…が入っていません`（`nta_search_tsutatsu` は `初回は …` でパスなし） | `ローカル DB（<パス>）がありません` / `HOUKI_NTA_DB_PATH が指すファイル（<パス>）がありません` / `ローカル DB（<パス>）にはまだ何も投入されていません` / `ローカル DB（<パス>）に…が入っていません`。`hint` の先頭で場面を見分けているスクリプトは直す必要がある |
| 版の合わない DB の `hint` の先頭 | `MCP サーバーが開いている DB（<絶対パス>）の版 …` | `ローカル DB（<パス>）の版 …` |
| `nta_inspect_pdf_meta` で DB が無いときの `hint` | `` `--bulk-download-<docType>` で投入済みか確認してください。… `` | DB の状態の文（パスと投入のコマンド）。`qa-jirei` のフラグは `--bulk-download-qa` |
| 案内のコマンド（`next_actions[].example.command`、`hint`、CLI のエラーの文） | `houki-nta-mcp --<フラグ>` | `npx -y @shuji-bonji/houki-nta-mcp@latest --<フラグ>`。`HOUKI_NTA_DB_PATH` / `XDG_CACHE_HOME` で起動したときは `HOUKI_NTA_DB_PATH="$HOME/…" npx -y …` のように前に、CLI に `--db-path` を付けたときは後ろに `--db-path=…` が付く |
| MCP サーバーの起動時のログ（標準エラー出力） | `started` の JSON の 1 行 | 次の行に `msg` が `DB: <絶対パス>（DB の場所の設定: <名前>）` の JSON |
| CLI `--status` | 無い（`ERROR: 未知のフラグ: --status` で終了コード 2） | DB の場所・設定・件数を出す。DB を作らず移行もしない |
| `nta_get_tax_answer` で保存した索引を読めない・保存できない | 何も出ない | MCP サーバーのログに `warn` の行。応答は変わらない |

houki-research-skill で関係する箇所（2026-10-04 JST に `skills/houki-research-skill`（main `7e07f03`）を `grep -rn "houki-nta-mcp --\|cache\.db\|MCP サーバーが開いている DB\|HOUKI_NTA_DB_PATH\|oldest_fetched_at\|db_path"` で探した。CHANGELOG を除く）:

| ファイル・行 | 書いていること | 0.25.0 で古くなるか |
| --- | --- | --- |
| `skills/houki-research/docs/ERROR-HANDLING.md` 77・80 行目 | `DOC_NOT_FOUND` の原因と、メッセージ整形例「`houki-nta-mcp --bulk-download-qa` で投入してください (DB: …/cache.db)」 | コマンドの形とパスの書き方（`~`）が古くなる |
| `skills/houki-research/docs/ERROR-HANDLING.md` 82〜86 行目 | 「`hint` が「MCP サーバーが開いている DB（…）の版」で始まるときは、…DB の版が合っていない」と、版 1・2 の案内のコマンド `houki-nta-mcp --quickstart` | 古くなる。見分けの文を `ローカル DB（…）の版` に直す |
| `skills/houki-research/examples/error-recovery-patterns.md` 129・164 行目 | `hint` の実例（`houki-nta-mcp --bulk-download-kaisei` をもう一度実行すると取り込めます）と、投入コマンド `houki-nta-mcp --bulk-download-kaisei` | コマンドの形が古くなる |
| `skills/houki-research/docs/ARCHITECTURE.md` 111 行目 | 応答契約の表の `freshness` の行（`staleness` + `oldest_fetched_at`、houki-nta-mcp） | 古くはならないが、`db_path` が表に無い。足すかは段階 3 の作業 7 で決める（houki-egov-mcp の差分と同じ） |
| `README.md` 167 行目、`skills/houki-research/SKILL.md` 341 行目 | v0.24.0 の DB の版 12 と移行 | 古くならない |

## 呼び出し例への影響

houki-hub の段階 3 の作業 6（例の取り直し）で、publish の後に取り直すもの。

- `scripts/reference-examples/houki-nta/ja/nta_search_*.md`（6 ファイル）の応答の `freshness` に `"db_path": "~/.cache/houki-nta-mcp/cache.db"` が入る（plugin で流したとき。houki-nta-dev で流すと、その `HOUKI_NTA_DB_PATH` のパスになるので、plugin で流す）。取得日時の値は取り直した日の値になる。2026-10-04 の例の `freshness` は、`nta_search_bunshokaitou.md`（50 行目）・`nta_search_jimu_unei.md`（41 行目）・`nta_search_kaisei_tsutatsu.md`（45 行目）・`nta_search_qa.md`（32・81・112 行目）・`nta_search_tax_answer.md`（40 行目。`stale` の理由の説明は v0.24.1 で古くなっている）・`nta_search_tsutatsu.md`（43 行目）
- `nta_search_tsutatsu.md` の「DB が古いとき」の例（86〜91 行目）の `warning` は ``最新化するには `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-all` を実行してください`` になる。同じファイルの 2 行目の `houki-nta-mcp --bulk-download-all` は説明の文なので、取り直すときに直すかを決める
- `nta_search_qa.md` 123 行目の「`hint` に MCP サーバーが開いている DB ファイルのパス…」の説明と、`nta_get_kaisei_tsutatsu.md` 64・80 行目の `hint` の実例と説明は、新しい文（DB-SCHEMA-029、GET-KAISEI-TSUTATSU-002）に合わせる
- `site/docs/reference/mcp/houki-nta.md` は tools/list から作る。tools/list の `description` は変えないので作り直しは要らない（`--status` は CLI のフラグでツールではない）

## houki-egov-mcp と文を変えた箇所

houki-egov-mcp の差分（以下「egov」）の文と規則を、`HOUKI_EGOV_DB_PATH` → `HOUKI_NTA_DB_PATH`、`houki-egov-mcp` → `houki-nta-mcp`、`note` → `hint` に置き換えて写した。次の箇所は文か規則を変えた。

| 箇所 | egov | この差分 | 変えた理由 |
| --- | --- | --- | --- |
| DB の場所の設定（DB-SCHEMA-026） | 3 つ（`HOUKI_EGOV_DB_PATH` / `XDG_CACHE_HOME` / `既定`） | 4 つ。`--db-path` を足し、優先の順を `--db-path` → `HOUKI_NTA_DB_PATH` → `XDG_CACHE_HOME` → `既定` にした | nta の CLI には `--db-path` がある（egov の「写せない点」1）。MCP サーバーでは当てはまらない |
| 案内のコマンド（DB-SCHEMA-027） | 環境変数を前に付ける | 環境変数は前に、`--db-path` は後ろに `--db-path=<シェルに書くパス>` を付ける | `--db-path` を使った人には同じフラグで案内するのがそのまま動く（人が判断すること 3） |
| `hint` の先頭（DB-SCHEMA-029） | `note` の `<先頭>` は `ローカル DB (<パス>) が無いため` の形（後ろに `、search_law … にフォールバックしています。` が続く 1 文） | `ローカル DB（<パス>）がありません。` の形（独立した文） | nta の `hint` は切り替えの文に続かない独立した文なので、DECISIONS.md の例「ローカル DB（`<パス>`）がありません」の形にした。括弧は nta の既存の `hint`（`DB（<パス>）`）に合わせて全角（人が判断すること 5） |
| 版の記録が無い DB の文 | `にまだ法令が取り込まれていないため` | `にはまだ何も投入されていません` | nta は複数の種別を持ち、CLI の語も「投入」 |
| その種別が無い DB の文 | 当たる場面が無い（egov の DB は 1 種別） | `ローカル DB（<パス>）に<種別>（doc_type="…"）が入っていません。…投入したシェルで … --status を実行し…` | nta の既存の文の先頭を揃え、`--status` で確かめる手順を足した（人が判断すること 6） |
| 版が古い・新しい・読めない DB の文 | 044 の表の 3 行 | DB-SCHEMA-021 の注 2 の 3 行の先頭を `ローカル DB（<パス>）の版` に変え、コマンドを 027 の形にした | nta は版の文を 021 の注 2 に持っているので、表を 2 つにしない |
| 開けない DB | `ローカル DB (<パス>) を開けなかったため`（`search_law` に切り替える） | 変えない（`INTERNAL_ERROR` のまま） | nta の読むだけのツールは開けない DB で例外になり、0.24.0 で「この差分では変えない」とした。直すなら `code` の決め直しが要る（人が判断すること 13） |
| `freshness.db_path` | `api-fallback` のときは `null` | `null` にならない | nta の検索ツールは DB を引けないときにエラー（`DOC_NOT_FOUND` など）を返し、成功の応答は DB を引いたときだけ（SEARCH-RULES-022） |
| `freshness` を常に置く | 同期の記録が無い DB でも置く（043） | 範囲（その種別・税目）に文書が無いときも置く | nta は範囲に文書が無いと `freshness` を付けなかった（egov の「写せない点」5）。egov の 043 と同じ考え（T4 の「値が無いフィールドは `null`」）で置く（人が判断すること 1） |
| `freshness.warning` | `` `<--sync のコマンド>` `` は 029 の形、括弧の中の `--bulk-download-everything` はフラグだけ | `` `<コマンド>` `` を 027 の形にする | nta の `warning` はフラグだけを書いていたが、括弧の中の補足ではなく、実行を勧める唯一のコマンド。egov で 029 の形にした `<--sync のコマンド>` に当たる（人が判断すること 4） |
| 起動時のログ（CLI-ENTRY-009） | `[server] DB: <絶対パス>（DB の場所の設定: <名前>）` のテキストの行 | `msg` が `DB: <絶対パス>（DB の場所の設定: <名前>）` の JSON の行。`meta` に `db_path`・`setting` | nta の logger は JSON の行を出す（`src/utils/logger.ts`）。`[server]` は `scope: "server"` に当たる（人が判断すること 12） |
| `--status` の件数の行（CLI-STATUS-003） | `  laws:`・`  articles:`・同期の欄 | `  schema_version:` と 6 種別の行（件数・索引から消えた件数・取得日時の範囲） | nta の DB の中身に合わせた（egov の「写せない点」3。人が判断すること 10） |
| `--status` の版 3〜11 の DB | 当たる場面が無い（egov は移行しない） | 移行せず、版と移行の案内を出して終了コード 0 | nta は版 3〜11 をどの入口でも移行するが、`--status` は確かめるだけで書き換えない（人が判断すること 7） |
| `--status` で DB が無いときの案内 | `--bulk-download-everything` を付けたコマンド | `--quickstart` を付けたコマンド「などの投入のフラグ」 | nta の CLI のエラーの文（021）が DB を作る案内に `--quickstart` を使っている |
| `[WARN]` のファイルの範囲（CLI-STATUS-002） | `laws*.db` | `cache*.db` | nta の既定のファイル名に合わせた（egov の「写せない点」2。人が判断すること 9） |
| tools/list の説明 | `search_fulltext` の `description` を npx の形に変えた | 変えない | nta のツールの説明はフラグだけを書いていて、`houki-nta-mcp --` の形を含まない |

## 実装 PR で直す文書

動きを変えない文書で、仕様 ID を作らないもの。

| # | 場所 | 直すこと |
| --- | --- | --- |
| 1 | README「検索が 0 件のとき」の表（219 行目）と、その下の 3 つ目の箇条書き（228 行目「`hint` の DB のパスで確かめられます」） | `hint` の先頭が DB の状態ごとに 4 つに分かれること（DB-SCHEMA-029）と、`--status` と起動時のログ（`DB: …`）で確かめる手順にする |
| 2 | README「DB の版（v0.24.0）」の節（411〜423 行目）と「投入済みかどうかを素早く確認する」（425 行目から） | `--status` を足す（`sqlite3` の手順の前に）。`--status` は DB を作らず移行もしないこと、DB の場所の設定と同じフォルダーの別の `cache*.db` を出すことを書く |
| 3 | README のエラー応答の例（663 行目からの JSON の `hint`）と、案内のコマンドの説明 | `hint` の中のコマンドを npx の形にする。応答と CLI の案内は npx の形（環境変数・`--db-path` 付き）、`--help` の使い方だけは `houki-nta-mcp <フラグ>` の形であることを書く |
| 4 | README の `freshness` の説明（75・542 行目など） | `db_path` を足す |
| 5 | CONTRIBUTING.md | houki-egov-mcp の CONTRIBUTING.md の「ローカル DB を使う開発」と同じ節を、「開発」の節の後に足す（T6 の (f)）。`HOUKI_EGOV_DB_PATH` → `HOUKI_NTA_DB_PATH`、`laws.db` → `cache.db`、`laws.dev.db` → `cache.dev.db`、`--sync` → `--bulk-download-*`。表の 1 行目は「古いコミット（0.23.x 以前）を起動する: 0.23.x 以前は版が新しい DB を見つけると全テーブルを消すので、版 12 の `cache.db` の中身が消えます」。確かめる行は「`node dist/index.js --status` の 2 行目の `DB:` が `cache.dev.db`、3 行目の `DB の場所の設定:` が `HOUKI_NTA_DB_PATH` であること」。nta は CLI に `--db-path` もあるが、MCP サーバーには渡せないので、MCP の設定の `env` と CLI のシェルの両方に `HOUKI_NTA_DB_PATH` を設定する手順にする |
| 6 | `docs/DATABASE.md` の「DB ファイルの場所」（8〜30 行目） | 優先の順に `--db-path`（CLI だけ）を明記し、`--status` で確かめられることと、MCP サーバーの起動時のログの行を書く |
| 7 | CHANGELOG 0.25.0 | 上の「互換性」の表。`Added` に `--status`、`Changed` に #138、`Fixed` に #137 と `nta_inspect_pdf_meta` の `qa-jirei` のフラグ。T6 の (f)（ファイル名に版を入れない）は DECISIONS.md の決定で、houki-nta-mcp では Issue を立てていないことを 1 行 |
| 8 | houki-hub `site/docs/guide/local-database.md`、`site/docs/mcp/houki-nta.md` の 115・150・304〜308 行目 | 新しい `hint` の先頭、`--status`、起動時のログで確かめる手順にする。houki-hub のブランチで行い、計画書 9 章に main に入ったかを書く（計画書 5.4） |
| 9 | houki-research-skill（段階 3 の作業 7） | 上の「互換性」の Skill の表の箇所。`ERROR-HANDLING.md` の版の見分けの文（「MCP サーバーが開いている DB（…）の版」で始まる）は直さないと見分けられなくなる |

## 実装の変更

- `src/db/index.ts`: DB の場所を決める関数を、パスだけでなく DB の場所の設定と絶対パスも返す形にする（例: `resolveDbLocation(cliDbPath?: string): { path: string; absolutePath: string; setting: '--db-path' | 'HOUKI_NTA_DB_PATH' | 'XDG_CACHE_HOME' | '既定' }`）。`defaultDbPath()` はそのまま残し、中で使う。`openReadDb`・`openWriteBackDb` は、ハンドラーが `hint` を作るために `state` と場所を返す（今も `openReadDb` は `state` と `path` を返している）
- パスの書き方の関数を 2 つ足す: 応答用（DB-SCHEMA-028。`os.homedir()` との前方一致を区切りの位置で比べて `~` にする）、シェル用（DB-SCHEMA-027。`"$HOME/…"` / `"$HOME"'/…'` / `'…'`）。案内のコマンドを組み立てる関数（フラグを受け取り、設定に応じて変数を前に、`--db-path` を後ろに付ける）を 1 か所に置き、MCP（`src/errors.ts` の `NEXT_ACTIONS.bulkDownload`・`bulkDownloadAll`・`bulkDownloadDocs`、`src/tools/handlers.ts` の各 `hint`）と CLI（`formatDbEntryError`、`[refresh-stale] DB がまだありません …`、`--status`）の両方で使う。houki-egov-mcp 0.20.0 の同じ関数（`src/db/index.ts` など）を参考にしてよいが、共有ライブラリには出さない（各 MCP の独自実装。houki-hub の family 方針）
- `src/tools/handlers.ts`: `explainDbState` を、版の合わない DB だけでなく、ファイルが無い・版の記録が無い状態にも広げ（DB-SCHEMA-029 の表）、`DOC_NOT_FOUND` / `TSUTATSU_NOT_FOUND` の `hint` をその状態の文にする。`explainDocZeroHits`・`explainDocIdNotFound` の「その種別が無い」ときの文を 029 の文にする。`dbStateHint` の先頭とコマンドを変える。`searchTsutatsuInner` の `TSUTATSU_NOT_FOUND` の `hint` を SEARCH-TSUTATSU-003 にする。`nta_inspect_pdf_meta` の DB が無いときの `hint` を 029 にし、`qa-jirei` のフラグを `--bulk-download-qa` にする。`unreadableFetchedAt` の `hint` と `next_actions` を 027 の形にする。`nta_get_tsutatsu` の `hint` の `houki-nta-mcp --bulk-download --tsutatsu=…` を 027 の形にする
- `src/services/freshness.ts`: `FreshnessRange` に `db_path: string` を足し、取得日時の 4 つを `string | null` / `number | null` / `StalenessLevel | null` にする。`summarizeFreshnessFromDocument`・`summarizeFreshnessFromSection` が `null` を返していた場面は、呼び出し側で取得日時を `null` にしたオブジェクトにする。`buildWarning` の第 3 引数に、027 の形のコマンドを渡す（今は `` `--bulk-download-qa` ``）
- `src/index.ts`: `logger.info('server', … started …)` の次に ``logger.info('server', `DB: ${absolutePath}（DB の場所の設定: ${setting}）`, { db_path: absolutePath, setting })``
- `src/cli.ts`: `--status` を処理を選ぶフラグに足し（一緒に使えるのは `--db-path`。`--help` の使い方にも行を足す）、`runStatus` を書く（DB を読み取り専用で開き、`probeDbState` で状態を見て、CLI-STATUS-001〜008 の行を出す。同じフォルダーの `cache*.db` は `readdirSync` と `statSync`）。`formatDbEntryError` と `[refresh-stale] DB がまだありません …` のコマンドを 027 の形にする
- `src/services/tax-answer-index.ts`・`src/tools/handlers.ts`（`resolveTaxAnswerUrl`）: `readStoredTaxAnswerIndex` は `tax_answer_index_page` の行が無いときだけ `null` を返し、SQL の例外は呼び出し側に分かる形で返す（例: `{ kind: 'unreadable', table, error }`）。`resolveTaxAnswerUrl` はそのとき「保存していない」と同じに索引を取り、`logger.warn('nta_get_tax_answer', …, { table, db_path, error })` を出す。`saveTaxAnswerIndex`・`touchTaxAnswerIndexPage` の例外にも同じ形の `logger.warn` を出す（どの表で失敗したかを `table` に入れる。`db_path` は `db.name`）
- 既存のテストで、案内のコマンドの文字列・`hint` の文・`freshness` が無いことを確かめているもの（2026-10-04 JST の grep で `src/spec-20261003-db-cli.test.ts`、`src/tools/doc-search-zero-hit.test.ts`、`src/tools/spec-20260927-search-zero-hits.test.ts`、`src/tools/spec-20261001-t2-error-codes.test.ts`、`src/tools/spec-20261003-db-cli.test.ts`、`src/tools/spec-20261003-t5-docs-mismatch.test.ts`、`src/tools/spec-20261004-freshness-orphaned.test.ts` など）は、MODIFIED の ID の期待値に合わせて Test Designer が直す

## publish の前の確認

計画書 5.2 の契約の確認（変えたツールの例を流す）に加えて、shuji の Mac で次を確かめる。

1. 受入テスト（ADDED 15・MODIFIED 23）が `npm test` で通り、`npm run check` が通る
2. 作業コピーで `npm run build` し、環境変数を付けずに `node dist/index.js --status` を実行して、3 行目が `  DB の場所の設定: 既定`、`tax-answer:` などの件数が `sqlite3 "$HOME/.cache/houki-nta-mcp/cache.db" "SELECT doc_type, COUNT(*) FROM document GROUP BY doc_type;"` と同じであること、`~/.cache/houki-nta-mcp/` に `cache.db` 以外の `cache*.db` があれば `[WARN]` が出ることを確かめる
3. `cp ~/.cache/houki-nta-mcp/cache.db /tmp/nta-status-check.db` で写しを作り、`shasum /tmp/nta-status-check.db` を取ってから `node dist/index.js --status --db-path=/tmp/nta-status-check.db` を実行し、もう一度 `shasum` を取って同じであること（`--status` が書き込まないこと。CLI-STATUS-008）
4. `HOUKI_NTA_DB_PATH=~/.cache/houki-nta-mcp/cache.none.db node dist/index.js --status` で、3 行目が `HOUKI_NTA_DB_PATH（…）`、`cache.db` を挙げた `[WARN]`、`  (DB がまだありません — HOUKI_NTA_DB_PATH="$HOME/.cache/houki-nta-mcp/cache.none.db" npx -y @shuji-bonji/houki-nta-mcp@latest --quickstart などの投入のフラグで作ります)` が出て、終了コード 0 で `cache.none.db` ができないことを確かめる
5. 4 の行の中のコマンドを zsh にそのまま貼り、`--quickstart` を `--status` に変えて実行し、2 行目が `  DB: /Users/bonji/.cache/houki-nta-mcp/cache.none.db` になることを確かめる（`"$HOME/…"` の形が zsh で動くことの確認。下の「確かめていない点」1）。`--db-path="$HOME/.cache/houki-nta-mcp/cache.none.db"` の形も同じように確かめる
6. houki-nta-dev（`HOUKI_NTA_DB_PATH` 付き）を build した 0.25.0 に向けて起動し、Claude Desktop のログ（`~/Library/Logs/Claude/mcp-server-houki-nta-dev.log`。場所は確かめていない）に `msg` が `DB: …（DB の場所の設定: HOUKI_NTA_DB_PATH）` の行が出ることと、`nta_search_qa` の `freshness.db_path` が `~/…` の形であることを確かめる
7. 結果を実装 PR の本文に書く

## 取り込みのとき（Publisher）

- ADDED の見出しを、各 `specs/current/<dir>/spec.md` の「できること」の末尾に足す。MODIFIED は見出しの行（題）も含めて、差分の見出しと本文に置き換える
- `specs/current/cli_status/spec.md` は、差分の `specs/cli_status/spec.md` の冒頭に書いた手順で新しく作る。承認日の行には差分 `20261004-db-location` の承認日と PR 番号を書く
- 各差分の spec.md の冒頭に書いた、ID の無い節の変更（「関連する Issue」、「入力」の表、「アクター」、「処理の流れ」の図、db_schema の「できないこと」と「未決」1、cli_entry の「できないこと」と「未決」4）を行う
- 各 `specs/current/<dir>/spec.md`（`cli_status` を除く 15 の dir）の承認日の行に「差分 `20261004-db-location` は YYYY-MM-DD（PR #N）」を足す
- この差分のフォルダーを `specs/releases/v0.25.0/20261004-db-location/` へ移し（`git mv`）、この proposal.md の「状態」を取り込み済みにする
- CHANGELOG の 0.25.0 に閉じる Issue（#138・#137）を書く。`Closes #138`・`Closes #137` は実装 PR の本文に書く
- houki-hub の計画書（`docs/notes/2026-10-04-plan-stage6-and-followups.md`）9 章の段階 3 の行に「済（日付・PR 番号・コミット）」を書く

## 人が判断すること

1. **`freshness` を検索 6 ツールの成功の応答に常に置く（SEARCH-RULES-022・017、SEARCH-TSUTATSU-004）。** DECISIONS.md の (a)「`db_path` を常に置く」を、nta の「範囲に文書が無いときは `freshness` を付けない」（017）にどう当てはめるか。案は (A) 範囲に文書が無いときも `freshness` を付け、取得日時の 4 つを `null` にする / (B) 今のまま付けない（`db_path` は `freshness` があるときだけ）。A は egov の 043（同期の記録が無い DB でも置く）と T4 の「値が無いフィールドは `null`、型を一定にする」に合い、範囲が空のとき（税目で絞った範囲がすべて索引から消えたときなど）にも DB のパスを出せる。代わりに、`freshness` の有無で「範囲に文書が無い」を見分けていた利用者は `freshness.oldest_fetched_at === null` に直す必要がある（Skill と hub の例は `freshness` が無い場面を引用していない。2026-10-04 に grep）。**勧める: A**
2. **`~` の置き換えの細かい規則（DB-SCHEMA-028）。** egov の 042 と同じ（`os.homedir()`、区切りの位置で比べる、ホームが空文字か `/` なら置き換えない、大文字・小文字を区別する、シンボリックリンクをたどらない）。Windows では確かめていない。**勧める: このまま**
3. **`--db-path` で DB を決めたときの案内のコマンド（DB-SCHEMA-027）。** 案は (A) 後ろに `--db-path=<シェルに書くパス>` を付ける / (B) 前に `HOUKI_NTA_DB_PATH=<…>` を付ける（`--db-path` を環境変数に置き換える） / (C) 何も付けない。案内するコマンドは投入のフラグ（`--quickstart`・`--bulk-download*`）と `--status` で、どれも `--db-path` を受け付ける（CLI-ENTRY-007）。A は利用者が使った方法のまま同じ DB を開ける。B は 1 つの規則で済むが、`--db-path` を使った人に環境変数を案内することになり、DECISIONS.md の (c) の「同じ変数を前に付けた形」の趣旨（同じ設定で案内する）から外れる。`--db-path="$HOME/…"` の形が bash と sh で展開されることは確かめた（下の「確かめた値」）。**勧める: A**
4. **`freshness.warning` のコマンドを 027 の形にする（SEARCH-RULES-017）。** 案は (A) `` `<コマンド>` ``（npx の形。環境変数で起動したときは変数付き） / (B) 今のまま `` `--bulk-download-qa` ``（フラグだけ）。egov の「フラグだけを書いた文は変えない」（egov の人が判断すること 7）は、egov の `warning` の括弧の中の補足（`--bulk-download-everything`）に当てはめたもので、`warning` の主のコマンド（`--sync`）は 029 の形に変えた。nta の `warning` のフラグは主のコマンドに当たる。A は houki-hub の `nta_search_tsutatsu.md` の「DB が古いとき」の例の文が変わる。**勧める: A**
5. **`hint` の先頭の形と括弧（DB-SCHEMA-029、021 の注 2）。** egov の `note` は `ローカル DB (<パス>) が無いため、…` の半角の括弧だが、nta の `hint` は独立した文で、既存の `hint` は `DB（<パス>）` の全角の括弧。DECISIONS.md の例「ローカル DB（`<パス>`）がありません」に合わせ、全角の括弧のまま `ローカル DB（<パス>）がありません。` の形にした。版の合わない DB の文も `MCP サーバーが開いている DB（…）` を `ローカル DB（…）` に変えた（先頭を 1 つの語に揃えるため。Skill の `ERROR-HANDLING.md` の見分けの文は直す必要がある）。**勧める: このまま**
6. **その種別が無い DB の `hint` に `--status` で確かめる手順を入れる（DB-SCHEMA-029）。** 今の「環境変数 HOUKI_NTA_DB_PATH / XDG_CACHE_HOME が同じか確認してください」を、「投入したシェルで `npx -y @shuji-bonji/houki-nta-mcp@latest --status` を実行し、表示される DB がこの DB と同じか確かめてください（…環境変数を受け継がないことがあります）」に変えた。この `--status` のコマンドは、MCP サーバーの設定ではなく、投入したシェルの設定で開く DB を確かめるためのものなので、027 の形にせず変数を付けない（027 の「この形にしない」箇所に書いた）。案は (A) このまま / (B) 今の文のまま（パスの `~` とコマンドの形だけ変える）。**勧める: A**
7. **`--status` は版 3〜11 の DB を移行しない（CLI-STATUS-005・008、DB-SCHEMA-021）。** DECISIONS.md 2026-10-04 の nta 0.24.0 の (2) は「版 3〜11 の DB は、…どの入口でも、行を保って版 12 に移行する」。案は (A) `--status` は移行しない（版と、次に開く入口が移行することを出し、件数は出さない。終了コード 0） / (B) ほかの入口と同じく移行してから件数を出す。A は `--status` を「確かめるだけで DB を書き換えない」入口にでき（egov の `--status` と同じ）、(2) の目的（上げた直後に検索が使えなくなるのを避ける）は、次に開く読むだけのツールが移行するので損なわない。B は件数を出せるが、確かめるつもりの実行で DB の版が変わり、0.24.x 以前のサーバーと共有している DB では、確かめただけで旧版から開けなくなる。A を選ぶなら、(2) は「`--status` を除くどの入口でも」と読み替える（DB-SCHEMA-021 に書いた）。DECISIONS.md に 1 行足すかは shuji が決める。**勧める: A**
8. **`--status` の終了コード（CLI-STATUS-004〜007）。** DB が無い・版の記録が無い・版 3〜11 は 0、版 1・2・新しい・読めない・開けないは 1。egov の `--status`（SPEC-EGOV-CLI-STATUS-006・010・011）と同じで、0.24.0 の「処理の失敗は 1」（CLI-ENTRY-008）にも合う。**勧める: このまま**
9. **同じフォルダーの別の DB の `[WARN]` の範囲（CLI-STATUS-002。#138 の「足したいこと」2）。** 案は (A) `cache` で始まり `.db` で終わる普通のファイル / (B) `.db` で終わるファイルすべて / (C) DB のファイル名の拡張子より前で始まるファイル（`nta.db` なら `nta*.db`）。A を勧めるのは、egov の `laws*.db` と同じ考え方（既定のファイル名の前半）で、この差分の CONTRIBUTING.md の例（`cache.dev.db`）と、DB の版を名前に付けた退避（`cache.v11.bak.db` など）が当てはまり、同じフォルダーの `baseline-*.json` と `files/` が外れるため。B は `HOUKI_NTA_DB_PATH` で別の用途のフォルダーを指したときに関係の無いファイルを挙げる。C は 2026-10-04 の egov の場面（`laws.v3.db` を指したが `laws.db` があった）に当たると、`laws.v3*.db` になり `laws.db` を見つけられない。#138 は一覧に「DB の版」を挙げていたが、egov と同じく見つけたファイルは開かない（読み取り専用でも WAL の DB は `-shm` を作ることがあるため）。退避したファイルも数える。**勧める: A・開かない・退避したファイルも数える**
10. **`--status` の件数の行の形（CLI-STATUS-003）。** `  schema_version: 12` の後に、`tsutatsu`（通達の数・条項の数・節の取得日時の範囲）と文書の 5 種別（件数・国税庁の索引から消えた件数・索引にある文書の取得日時の範囲）を 1 行ずつ。行の名前は `doc_type` の値（egov の `laws:`・`articles:` がテーブル名なのと同じ）、数は区切りなし、桁揃えなし、取得日時は DB の文字列のまま（読めない値でもエラーにしない）、`staleness` は出さない（検索の `freshness` で分かり、読めない取得日時で `--status` が止まるのを避けるため）。取得日時の範囲は検索の `freshness` と同じく索引から消えた文書を除く（v0.24.1 の 017）。案は (A) このまま / (B) `staleness` も出す / (C) タックスアンサーの索引（`tax_answer_index` の行の数と `tax_answer_index_page.fetched_at`）の行も足す。**勧める: A**
11. **版の記録が無い DB の文を、ファイルが無いときと分ける（DB-SCHEMA-029、CLI-STATUS-004）。** egov の `--status` は版の記録が無い DB でも `(DB がまだありません — …)` を出すが、ファイルはあるので事実に合わない（DECISIONS.md の (b) の「事実に合う文」）。`hint` は `にはまだ何も投入されていません`、`--status` は `(DB のファイルはありますが、まだ何も投入されていません — …)` にした。**勧める: 分ける**
12. **起動時のログの形（CLI-ENTRY-009）。** nta の logger は JSON の行を出すので、`msg` を egov の行の `[server] ` の後と同じ文にし、`meta` に `db_path` と `setting` を入れた。案は (A) `msg` と `meta` / (B) `msg` だけ。A はログを読むスクリプトがパスを文から切り出さずに済む。**勧める: A**
13. **開けない DB の読むだけのツールの応答（この差分の外）。** egov は開けない DB で `search_law` に切り替え、`note` にパスを入れた（044 の 7 行目）。nta の読むだけのツールは開けない DB で例外になり、SPEC-NTA-COMMON-ERRORS-006 の `INTERNAL_ERROR`（`hint` は「バグの可能性があります…」、パスは `detail.cause` の SQLite の文だけ）を返す。直すには、どの `code` にするか（`DOC_NOT_FOUND` に寄せるか、新しい場面にするか）の決め直しが要り、T6 の (b)（DB が無いとき）の外なので、この差分では変えない。**勧める: 別の Issue にする（起票の下書きは報告に添える）**
14. **`nta_inspect_pdf_meta` にも DB-SCHEMA-029 を当てはめ、`qa-jirei` のフラグを直す（INSPECT-PDF-META-001）。** `nta_inspect_pdf_meta` は読むだけのツールで、DB が無いときも「DB に未登録」の `hint` だった。029 の状態の文を当てはめ、DB があるときの文はフラグだけのまま残す。その文の `qa-jirei` のフラグ `--bulk-download-qa-jirei` は存在しないフラグなので `--bulk-download-qa` に直す（不具合の修正。この ID を MODIFIED にするので一緒に入れた）。**勧める: このまま**
15. **027 の形にしない箇所。** `--help` の使い方、`--quickstart` が終わった後の「次に試すこと」の行（`houki-nta-mcp --bulk-download --tsutatsu=所得税基本通達` など。今その CLI を実行した人に向けた一覧で、`--help` と同じ扱い）、フラグだけを書いた `hint`（`nta_get_tsutatsu` の `ARTICLE_NOT_FOUND`、`nta_inspect_pdf_meta` の DB があるとき）、021 の CLI のエラーの文の `か --bulk-download-all` の 2 つ目のフラグ。egov の人が判断すること 7 と同じ考え方。**勧める: 変えない**
16. **#137 の `touchTaxAnswerIndexPage` の失敗もログに出す（GET-TAX-ANSWER-018）。** DECISIONS.md の #137 の行は `saveTaxAnswerIndex` の失敗だけを挙げているが、Issue の決めること 3 は `touchTaxAnswerIndexPage` も挙げている。どちらも「DB に書けなかったことを利用者が気付けない」点が同じなので、同じ形の `warn` にした。ログの `scope` は `nta_get_tax_answer`、`meta` は `table`・`db_path`（絶対パス）・`error`。**勧める: このまま**
17. **#137 の `--bulk-download-tax-answer` の保存の失敗（この差分の外）。** bulk download は `saveTaxAnswerIndex` の例外を受け取らない（`src/services/tax-answer-bulk-downloader.ts` 137 行目）。投入がどう終わるか（終了コード、ほかの種別へ進むか）は確かめていない。**勧める: この差分では変えない（DB-SCHEMA-025 に書いた）**
18. **版。** 0.25.0（minor）。応答の `freshness` の形・`hint` の文・案内のコマンド・CLI のフラグが変わる。DB のスキーマの版は 12 のまま。**勧める: このまま**
19. **承認日。** この proposal.md の「- 承認日:」に日付と PR 番号を書く（shuji がマージの前に）

## 確かめた値

| 何を | 結果 | いつ・どうやって | 使った仕様 ID |
| --- | --- | --- | --- |
| 起点 | main `09ed4de`（v0.24.1 の取り込み。版 0.24.1）、origin の main と同じ。`specs/changes/` は空。`npx spec-ids check` は current 258 IDs・テスト 258 IDs で一致 | 2026-10-04 JST、`git ls-remote https://github.com/shuji-bonji/houki-nta-mcp.git main` と `ls specs/changes/` | — |
| DB のパスの決め方 | `HOUKI_NTA_DB_PATH`（`if (process.env.HOUKI_NTA_DB_PATH)` なので空文字は無いもの。値は `resolve` しない）→ `XDG_CACHE_HOME`（空文字は無いもの）→ `~/.cache`。後の 2 つは `resolve(cacheRoot, 'houki-nta-mcp', 'cache.db')`。CLI は `args.dbPath ?? defaultDbPath()` | `src/db/index.ts` の `defaultDbPath`、`src/cli.ts` の 549・748・773 行目などを読んだ | DB-SCHEMA-026 |
| 読むだけのツールが DB を開く入口 | `openReadDb` は `missing`・`unversioned`・版の合わない DB で空の DB（メモリー）を返し、`unopenable` では `openDb(path)` で例外になる。`explainDbState` は版の合わない DB のときだけ `hint` を書き換える | `src/db/index.ts`・`src/tools/handlers.ts` 1145〜1185 行目を読んだ | DB-SCHEMA-029、人が判断すること 13 |
| 「DB に 1 件も無い」ときの `hint` | `explainDocZeroHits`（758 行目）と `explainDocIdNotFound`（837 行目）が同じ文 `MCP サーバーが開いている DB（${dbPath}）に${meta.label}（doc_type="${docType}"）が入っていません。…`。`dbPath` は `options.dbPath ?? defaultDbPath()` で、ホームを含む | `src/tools/handlers.ts` を読んだ | DB-SCHEMA-029 |
| 案内のコマンドが出る箇所 | `src/errors.ts` の `NEXT_ACTIONS.bulkDownload`・`bulkDownloadAll`・`bulkDownloadDocs`、`src/tools/handlers.ts` の `unreadableFetchedAt`・298・463・538・758・837・849・1153・1157 行目と `explainDocZeroHits` の税目の追加の文、`src/cli.ts` の `formatDbEntryError`（609〜617 行目）と 1071 行目 | 2026-10-04 JST に `grep -rn "houki-nta-mcp --" src`（テストを除く） | DB-SCHEMA-027 |
| specs/current の中の `houki-nta-mcp --` | cli_bulk_download 1・cli_entry 9・cli_refresh 1・db_schema 6・nta_get_bunshokaitou 3・nta_get_jimu_unei 3・nta_get_kaisei_tsutatsu 4・nta_search_bunshokaitou 4・nta_search_jimu_unei 3・nta_search_kaisei_tsutatsu 2・nta_search_qa 4・nta_search_tax_answer 2・nta_search_tsutatsu 2。cli_entry・cli_refresh・cli_bulk_download のものは実行例（入力）か「アクター」の文で、案内ではない | 2026-10-04 JST に `grep -c` と `grep -n` | MODIFIED の範囲 |
| `freshness` が付かない場面 | `summarizeFreshnessFromDocument`・`summarizeFreshnessFromSection` が範囲に行が無いと `null` を返し、呼び出し側が `...(freshness ? { freshness } : {})` で付けない。取得ツールは `freshness` を付けない | `src/services/freshness.ts`・`src/tools/handlers.ts` を読んだ | SEARCH-RULES-022 |
| `freshness.warning` | `buildWarning` が `一部ドキュメントが ${daysSince} 日前のデータです。最新化するには ${bulkDownloadHint} を実行してください`。呼び出し側は `` '`--bulk-download-qa`' `` などフラグだけを渡す | `src/services/freshness.ts`・`src/tools/handlers.ts` | SEARCH-RULES-017 |
| 起動時のログ | `logger.info('server', '<name> v<version> started (MCP SDK v2 / …)')`。logger は `{"ts","level","scope","msg","meta"}` の JSON の 1 行を `process.stderr` に書く | `src/index.ts`、`src/utils/logger.ts` を読んだ | CLI-ENTRY-009 |
| `nta_inspect_pdf_meta` の `hint` のフラグ | `` `--bulk-download-${args.docType === 'tax-answer' ? 'tax-answer' : args.docType}` ``。`qa-jirei` では `--bulk-download-qa-jirei` になり、このフラグは `src/cli.ts` のフラグの表に無い | `src/tools/handlers.ts` 2380 行目、`src/cli.ts` 181 行目付近の表 | INSPECT-PDF-META-001 |
| tools/list の説明 | `--bulk-download-all` などフラグだけで、`houki-nta-mcp --` の形は無い | `grep -n "houki-nta-mcp\|bulk-download" src/tools/definitions.ts` | 変わらない振る舞い |
| 既定のフォルダーの中身 | `cache.db`、`baseline-<doc_type>.json`（9 ファイル。`src/services/health-store.ts` 104 行目）、`files/`（添付 PDF。`src/services/pdf-files.ts` 29 行目） | `docs/DATABASE.md` 20〜31 行目とコードを読んだ | CLI-STATUS-002 |
| タックスアンサーの索引の読み書き | `readStoredTaxAnswerIndex` は `try { … } catch { return null; }`。`saveTaxAnswerIndex` は `db.prepare(INSERT …)` をトランザクションの前に呼ぶ（列が無ければトランザクションに入る前に例外）。`resolveTaxAnswerUrl` は `touchTaxAnswerIndexPage` と `saveTaxAnswerIndex` を `catch { // best effort }` で囲む。`--bulk-download-tax-answer` は `saveTaxAnswerIndex` を囲まない | `src/services/tax-answer-index.ts`、`src/tools/handlers.ts` 1583〜1611 行目、`src/services/tax-answer-bulk-downloader.ts` 137 行目 | GET-TAX-ANSWER-018、DB-SCHEMA-025 |
| 壊れた表の SQL の文 | `url` の列の無い `tax_answer_index` に対して、`SELECT no, url, taxonomy, title FROM tax_answer_index` は `no such column: url`、`INSERT OR IGNORE INTO tax_answer_index(no, url, taxonomy, title) …` は `table tax_answer_index has no column named url` | 2026-10-04 JST、Cowork の VM の Python 3（SQLite 3.37.2）で同じ表を作って実行 | GET-TAX-ANSWER-018 |
| シェルに書くパスの展開 | `--db-path="$HOME/.cache/houki-nta-mcp/cache.dev.db"`、`--db-path="$HOME"'/dev$1/cache.db'`、`--db-path='/tmp/x/cache.db'`、`X="$HOME/.cache/a.db"` を引数・変数に置くと、どれも `HOME` を展開した値（`$1` はそのまま）になった | 2026-10-04 JST、Cowork の VM の bash 5.1.16 と dash（`/bin/sh`）で `printf '%s\n'` と `env` | DB-SCHEMA-027 |
| `npx spec-ids next` | db_schema 026、search_rules 022、cli_entry 009、nta_get_tax_answer 018、cli_status 001 | 2026-10-04 JST、`npx --no-install spec-ids next <dir>` | 変わる仕様 ID |
| houki-research-skill の該当箇所 | 「互換性」の Skill の表 | 2026-10-04 JST、`skills/houki-research-skill`（main `7e07f03`）で grep（CHANGELOG を除く） | 互換性 |
| houki-hub の該当箇所 | `scripts/reference-examples/houki-nta/ja/nta_search_*.md` の `freshness`（6 ファイル）、`nta_search_tsutatsu.md` の `warning` の例、`nta_search_qa.md` 123 行目、`nta_get_kaisei_tsutatsu.md` 64・80 行目、`site/docs/guide/local-database.md`、`site/docs/mcp/houki-nta.md` 115・150・304〜308 行目 | 2026-10-04 JST、houki-hub main `d3e2e02` で grep | 呼び出し例への影響、実装 PR で直す文書 |
| 期待値を直す既存のテスト | 「実装の変更」の最後の箇条書きのファイル | 2026-10-04 JST、`grep -rln "houki-nta-mcp --\|MCP サーバーが開いている DB\|freshness).toBeUndefined\|not.toHaveProperty('freshness'\|bulk-download-qa-jirei\|readStoredTaxAnswerIndex" src tests --include=*.test.ts` | 実装の変更 |

## 確かめていない点

1. `"$HOME/…"`・`"$HOME"'/…'`・`--db-path="$HOME/…"` の形が zsh（macOS の既定のシェル）と fish でそのまま動くこと。VM に zsh・fish が無く、bash と dash でだけ確かめた。publish の前の確認 5 で zsh を確かめる
2. Windows（cmd・PowerShell）。`VAR=値 コマンド` の形はどちらでも動かない。houki-nta-mcp を Windows で使う利用者がいるかは確かめていない
3. Claude Desktop が MCP サーバーを起動するときの作業フォルダー（相対パスの `HOUKI_NTA_DB_PATH` がどこを指すか）と、MCP サーバーのログの場所（publish の前の確認 6）
4. `os.homedir()` と環境変数 `HOME` が食い違う環境での `~` の置き換え
5. shuji の `~/.cache/houki-nta-mcp/` に `cache.db` 以外の `*.db` があるか（`[WARN]` が出るか。publish の前の確認 2）
6. 読み取り専用で開いた WAL の DB で、SQLite が `-shm` を作るか（CLI-STATUS-008 は「置くことはある」とした）
7. better-sqlite3 に入っている SQLite の版で、壊れた表の SQL の文が Python の SQLite 3.37.2 と同じこと（受入テストでは `meta.error.message` に `url` を含むことを確かめれば足りる）
8. `hint` の先頭（`MCP サーバーが開いている DB`）で場面を見分けているスクリプトが利用者の手元にあるか。houki-hub の `scripts/` と houki-research-skill は文を引用しているだけで、プログラムで見分けてはいない（2026-10-04 に grep）
9. `--bulk-download-tax-answer` が索引の保存に失敗したときの終わり方（人が判断すること 17）

## この差分の外で見つけたこと

- `nta_inspect_pdf_meta` の `hint` の `--bulk-download-qa-jirei`（無いフラグ）は、INSPECT-PDF-META-001 を MODIFIED にするのでこの差分で直す（人が判断すること 14）
- 開けない DB で読むだけのツールが `INTERNAL_ERROR`（パスを含まない `hint`）を返す点（人が判断すること 13）。Issue にするなら「DB を開けないとき、読むだけのツールの応答に DB のパスと直し方を入れるか（egov の SPEC-EGOV-SEARCH-FULLTEXT-027・044 の開けない行に当たる）」
- houki-hub `scripts/reference-examples/houki-nta/ja/nta_search_tax_answer.md` 60 行目からの「`--bulk-download-everything` の直後なのに `stale`」の説明は、v0.24.1（索引から消えた文書を範囲から外す）で当たらなくなっている。段階 3 の作業 6 で例を取り直すときに直すとよい

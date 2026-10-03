# 変更: 国税庁サイトから取る経路（通信の失敗の code・タックスアンサーの URL と 8xxx 帯）と、事務運営指針の legal_status.note（段階 5）

- 対象: `specs/current/common_errors/spec.md`、`nta_get_qa`・`nta_get_tax_answer`・`nta_get_tsutatsu`・`cli_bulk_download`（#120・#128）、`nta_search_jimu_unei`・`nta_get_jimu_unei`・`nta_inspect_pdf_meta`・`search_rules`（#131）の `specs/current/<dir>/spec.md`
- 実装の変更: 要（下の「実装の変更」）
- 承認日: 2026-10-03（PR #134）
- 状態: 草案
- 起こした日: 2026-10-03（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #120（国税庁サイトとの通信の失敗を houki-egov-mcp と同じ 4 つの code に分けるか）、#128（タックスアンサーの 8xxx 帯に対応し、記事の URL を国税庁の索引から決める）、#131（事務運営指針の `legal_status.note` を `nta_search_jimu_unei` と `nta_inspect_pdf_meta` でも揃える）
- 決定の出典: houki-hub `docs/DECISIONS.md` 2026-09-29「T2 code」「T2 の互換の扱い」、`docs/notes/2026-10-03-stage5-spec-instructions.md` の指示 J、houki-egov-mcp `specs/current/common_errors/spec.md` の SPEC-EGOV-COMMON-ERRORS-027・028 と `specs/changes/20261003-law-resolution/`（PR #95。#87 の規則）、houki-hub `docs/notes/2026-10-03-issue-draft-nta-tax-answer-8xxx.md`、`docs/notes/2026-10-03-issue-draft-nta-jimu-unei-legal-status-note.md`、#120 のコメント（2026-10-02・10-03）
- 前提: 差分 `20261003-search-rules`（`spec/20261003-search-rules`）の上に積む。`search_rules` の spec.md を両方が触る（あちらは 003・004・006・009・021、こちらは 015）ため。マージも catchup → search-rules → この差分の順。nta の DB と CLI の差分（指示 K、`spec/<日付>-db-cli`）はこの差分の上に積む

## なぜ変えるか

- #120: 国税庁サイトとの通信の失敗は、時間切れ・接続できない・429・5xx・403 のどれでも `SOURCE_API_ERROR`・`retryable: true` で、利用者（LLM）は `error` の文と `detail.status` の有無でしか見分けられない。houki-research-skill の案内（`SOURCE_TIMEOUT` / `SOURCE_UNAVAILABLE` は retry、`SOURCE_RATE_LIMITED` は間隔をあける）が nta では効かない。さらに 0.22.0 から、403・400 は取り直さないのに `retryable: true` と `retry_later` を返している（#120 の 2026-10-02 のコメント）
- #128: `nta_get_tax_answer` は番号の先頭の桁で税目フォルダを決めるので、8xxx 帯（災害、`saigai` フォルダ）を `INVALID_ARGUMENT` で断り、ほかにも 113 件を誤ったフォルダの URL で引いて `DOC_NOT_FOUND` になる。0.23.0 の SPEC-NTA-SEARCH-TAX-ANSWER-006 は 8xxx の記事にも `nta_get_tax_answer` を案内するので、案内のとおりに呼ぶと失敗する
- #131: 0.23.0 で `nta_get_jimu_unei` の json の `legal_status.note` を事務運営指針を名指しする文に変えたが、`nta_search_jimu_unei` と `nta_inspect_pdf_meta` は「通達は行政内部文書。…」のまま。同じ文書の位置付けの注が、検索と取得で 2 通り返る

#120 と #128 は、どちらも `nta_get_qa` / `nta_get_tax_answer` / `nta_get_tsutatsu` の国税庁サイトから取る経路を変えるので、同じ差分にした。#131 は触る dir が別なので、下で独立した節にした。

## 確かめた値（2026-10-03 JST）

| 呼び出し                                                                                                                 | 結果                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 使った仕様 ID                           |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Mac の VM から `curl -I https://www.nta.go.jp/taxes/shiraberu/taxanswer/code/`（13:37）                                  | 200、`last-modified: Tue, 15 Sep 2026 08:58:03 GMT`、`etag: "25b0a-65b81bf96ae40"`、`content-length: 154378`                                                                                                                                                                                                                                                                                                                                                     | GET-TAX-ANSWER-016                      |
| 同じ URL に `If-None-Match: "25b0a-65b81bf96ae40"`、`If-Modified-Since: Tue, 15 Sep 2026 08:58:03 GMT` を付けて（13:37） | どちらも 304                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 016                                     |
| 索引の本文から `taxanswer/<フォルダ>/<4 桁>.htm` を集めた（13:37）                                                       | 755 件、番号の重複 0、`0` で始まる番号 0。先頭の桁とフォルダの組は `1 shotoku` 170・`2 gensen` 65・`2 shotoku` 37・`3 joto` 71・`3 shotoku` 1・`3 hojin` 1・`4 sozoku` 52・`4 hyoka` 29・`4 zoyo` 29・`5 hojin` 109・`6 shohi` 118・`7 inshi` 30・`7 hotei` 14・`7 fufuku` 2・`8 saigai` 16・`9 osirase` 11。先頭の桁で決めるフォルダと違うのは 129 件（Issue の値と同じ）                                                                                       | 003                                     |
| `curl https://www.nta.go.jp/taxes/shiraberu/taxanswer/saigai/8001.htm` / `…/osirase/8001.htm`（13:37）                   | 200 / 302 → `https://www.nta.go.jp/error/404.htm`                                                                                                                                                                                                                                                                                                                                                                                                                | 003・005                                |
| houki-nta-dev（手元のビルド、0.23.0）`nta_search_jimu_unei { keyword: "電帳法", limit: 2 }`（13:4x）                     | 2 件。`legal_status.note` は `通達は行政内部文書。納税者・裁判所には直接的拘束力なし。…`                                                                                                                                                                                                                                                                                                                                                                         | SEARCH-JIMU-UNEI-002                    |
| `src/constants.ts`・`src/tools/handlers.ts`（main `9ae81aa`）を読んだ                                                    | `JIMU_UNEI_LEGAL_STATUS.note` は `通達・事務運営指針は行政内部文書であり、納税者・裁判所には直接的拘束力なし。ただし税務署員は職務として守る義務あり（最高裁 昭和43.12.24）`。`nta_get_jimu_unei` の markdown の注は `*通達・事務運営指針は行政内部文書であり、納税者・裁判所への直接的拘束力なし（最高裁 昭和43.12.24）*`、`nta_get_kaisei_tsutatsu` の markdown の注は `*通達は行政内部文書であり、納税者・裁判所への直接的拘束力なし（最高裁 昭和43.12.24）*` | GET-JIMU-UNEI-005・INSPECT-PDF-META-016 |
| `src/services/nta-scraper.ts`・`src/config.ts`（main `9ae81aa`）を読んだ                                                 | 1 回の要求は 30 秒で打ち切り（`AbortController`）、5xx・ネットワークの失敗は 1・2・4 秒あけて合わせて 4 回、4xx は取り直さない。最後の失敗は `NtaFetchError`（`status` は HTTP の応答があったときだけ、`cause` に元の例外）                                                                                                                                                                                                                                      | COMMON-ERRORS-018                       |

## 確かめていない点

- 国税庁サイトが 429・403・400 を返す場面（実際に起こしていない。表は `fetchNtaPage` の分岐から書いた）
- `nta_inspect_pdf_meta` の `docType: "jimu-unei"` の `legal_status.note` を呼び出しで見ること（実装の `LEGAL_STATUS_BY_DOCTYPE` から判断した。#131 の Issue と同じ）
- 作者の DB の、国税庁サイトから取って書き戻したタックスアンサーの行の税目（#128 の決めること 4。下の答えのとおり、誤った税目の行は作られない見込み）

## #120 通信の失敗の code

**今の動き（v0.23.0）**: `nta_get_qa` / `nta_get_tax_answer` は 404・410・404 ページへの転送を `DOC_NOT_FOUND` にし、それ以外の失敗（429・403・400・5xx・時間切れ・接続できない）はすべて `SOURCE_API_ERROR`・`retryable: true`・`next_actions: [retry_later]`。`nta_get_tsutatsu` は候補ページの 404 を次の候補へ進め、それ以外の失敗（目次の 404 を含む）は `SOURCE_API_ERROR`・`retryable: true`（`tool` が無い）。

**変えた後の動き**: houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-027・028 と同じ 4 つの code に分ける（SPEC-NTA-COMMON-ERRORS-018・019）。

| 国税庁サイトへの要求の終わり方                        | 取り直し | v0.23.0                                          | この差分                                         |
| ----------------------------------------------------- | -------- | ------------------------------------------------ | ------------------------------------------------ |
| 404・410・転送                                        | しない   | `DOC_NOT_FOUND`（`nta_get_tsutatsu` は次の候補） | 変えない                                         |
| 429                                                   | しない   | `SOURCE_API_ERROR`・`true`                       | `SOURCE_RATE_LIMITED`・`true`                    |
| 時間切れ（30 秒）                                     | する     | `SOURCE_API_ERROR`・`true`                       | `SOURCE_TIMEOUT`・`true`                         |
| 5xx                                                   | する     | `SOURCE_API_ERROR`・`true`                       | 変えない                                         |
| 403・400 など                                         | しない   | `SOURCE_API_ERROR`・`true`・`retry_later`        | `SOURCE_API_ERROR`・`false`・`next_actions` 無し |
| 接続できない（`cause.code` が `ENOTFOUND` など 5 つ） | する     | `SOURCE_API_ERROR`・`true`                       | `SOURCE_UNAVAILABLE`・`true`・`detail.cause`     |
| そのほかのネットワークの失敗                          | する     | `SOURCE_API_ERROR`・`true`                       | 変えない                                         |

| 種類     | 仕様 ID                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------- |
| ADDED    | SPEC-NTA-COMMON-ERRORS-018・019                                                                         |
| MODIFIED | SPEC-NTA-COMMON-ERRORS-016、SPEC-NTA-GET-QA-015、SPEC-NTA-GET-TAX-ANSWER-014、SPEC-NTA-GET-TSUTATSU-009 |

| 決めること                                                                                                                      | 答え                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. egov の 027・028 と同じ表を足すか（3 つの code を実際に返す）、`SOURCE_API_ERROR` 1 つのままにして「nta は分けない」と書くか | 足す（018・019）。分けないと、houki-research-skill の `SOURCE_TIMEOUT` / `SOURCE_UNAVAILABLE` / `SOURCE_RATE_LIMITED` の案内が nta で効かず、`docs/ERROR-CODES.md` の表で nta だけ列が空く                                                  |
| 2. `NtaFetchError` に「どの種類の失敗か」を持たせるか（egov の `status: 0` の形か、`kind` のようなフィールドか）                | 仕様は振る舞いだけを書き、持たせ方は実装 PR で決める。勧める案は `kind`（`timeout` / `unreachable` / `http` / `network`）を足す形。`status: 0` を時間切れの印にすると、`detail.status` に HTTP に無い値が出るおそれがある（「実装の変更」） |
| 3. 4xx（429 と 404・410 以外）を `SOURCE_API_ERROR`・`retryable: false` にするか                                                | する（018）。`fetchNtaPage` が取り直さない失敗に `retryable: true` を付けない。理由は 018 の本文に書いた                                                                                                                                    |
| 4. どの版で入れるか                                                                                                             | 0.24.0（この差分）                                                                                                                                                                                                                          |

0.22.0 の 4xx の扱いの追記（#120 のコメント 2026-10-02）への答えも 018 に入れた。429 は取り直さないまま `SOURCE_RATE_LIMITED`・`retryable: true` にする（取り直すと国税庁サイトへの要求が増えるため。egov は 429 を取り直すので、ここだけ違う）。`nta_get_tsutatsu` の目次のページの 404 は、目次の URL がこのサーバーの決めた値なので `SOURCE_API_ERROR`・`retryable: false` にする（009）。

## #128 タックスアンサーの URL と 8xxx 帯

**今の動き（v0.23.0）**: `no` の先頭の桁で税目フォルダを決める（`1`→`shotoku` … `9`→`osirase`、`8`・`0` は表に無い）。`8xxx`・`0xxx` は `INVALID_ARGUMENT`（SPEC-NTA-GET-TAX-ANSWER-002）。DB に無い記事は先頭の桁のフォルダの URL を取り、索引のフォルダと違う 113 件は 404 ページへの転送で `DOC_NOT_FOUND`。

**変えた後の動き**: DB に行があればその行の URL、無ければ国税庁の索引でその番号の URL を決める（003）。索引は DB に保存して使い回し、番号が見つからないときだけ条件付きで取り直す（016）。索引に無い番号は記事を取りに行かずに `DOC_NOT_FOUND`（013）。先頭の桁では断らない（002 を REMOVED、012 の例を直す）。書き戻す行の税目は URL のフォルダ（006・011）。

| 種類        | 仕様 ID                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ADDED       | SPEC-NTA-GET-TAX-ANSWER-016・017                                                                                                       |
| MODIFIED    | SPEC-NTA-GET-TAX-ANSWER-003・005・006・011・012・013・014・015、SPEC-NTA-COMMON-ERRORS-009（索引の解析の失敗の行）・016                |
| REMOVED     | SPEC-NTA-GET-TAX-ANSWER-002                                                                                                            |
| ID の無い節 | `nta_get_tax_answer` の「入力」・「処理の流れ」・「できないこと」、`cli_bulk_download` の「入力」の `--tax-answer-taxonomy` の値の一覧 |

| 決めること                                                                                             | 答え                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 記事の URL の決め方（A: DB の `source_url` → 索引 / B: 番号の範囲の表 / C: B で取り、転送なら索引） | A（003・016）。国税庁の索引が正本で、SPEC-NTA-GET-TSUTATSU-014 の目次の使い回しと同じ考え方。1 回の呼び出しで取るページが 2 つ（索引と記事）になることがある。2 回目からは保存した索引を使うので 1 つ                                                                                                                                                                                                                                                                                           |
| 2. 先頭の桁による `INVALID_ARGUMENT`（002）を残すか                                                    | 外す（002 を REMOVED）。4 桁の検査（012）だけ残す。`0xxx` は索引に無いので `DOC_NOT_FOUND`（013）になる                                                                                                                                                                                                                                                                                                                                                                                         |
| 3. `taxonomy` の値と、`--tax-answer-taxonomy` の値の一覧をどこから作るか                               | 書き戻す行は取った URL の税目フォルダ（`saigai`・`hyoka`・`zoyo`・`hotei`・`fufuku` を含む。006・011）。`--tax-answer-taxonomy` の一覧は、2026-10-03 の索引にある 13 個の固定の一覧にする（cli_bulk_download の入力の表）。索引から毎回作る案は、引数を読む時点で国税庁サイトを引くことになるので採らない                                                                                                                                                                                       |
| 4. 既存の DB の行で `taxonomy` が誤っているものを直すか                                                | 直さない（スキーマの版上げの移行に入れない）。v0.23.0 で国税庁サイトから取って書き戻せた行は、先頭の桁のフォルダの URL が 200 を返した記事だけで、そのフォルダは索引のフォルダと同じ。索引のフォルダと違う 129 件は、先頭の桁のフォルダの URL が 404 ページへの転送になり、書き戻す行が作られない。bulk download の行は、もともと索引のフォルダを税目にしている（`src/services/tax-answer-bulk-downloader.ts`）。したがって誤った税目の行は作られていない見込み（作者の DB では確かめていない） |

### 索引を DB に保存するためのスキーマ（指示 K に渡す）

016 は「索引を DB に保存して使い回す」と書いた。今のスキーマ（版 11）には、タックスアンサーの索引を入れる場所が無い。`tsutatsu_toc` は目次の URL を主キーに `formal_name`（通達の正式名、`NOT NULL`）と `toc_json` を持つ表で、タックスアンサーの索引を入れると、列の意味（通達の目次）と中身がずれる。そこで次の 3 案を並べ、案 1 を勧める。

| 案          | 内容                                                                                                                   | スキーマ                                                  | 利用者への影響                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1（勧める） | 索引を入れる新しいテーブルを足す（番号・URL・税目フォルダ・題名と、索引のページの `Last-Modified` / `ETag`・取得日時） | 版を上げる。K の版上げ（#107・#112）と同じ 1 回にまとめる | 版上げは K の分と合わせて 1 回。新しいテーブルは空で作り、最初の `nta_get_tax_answer` の呼び出しで埋まる。再取り込みは要らない |
| 2           | `tsutatsu_toc` に索引の URL を鍵として入れる（`formal_name` に `タックスアンサー` のような値）                         | 変えない                                                  | 無し。ただし db_schema の `tsutatsu_toc` の説明（目次ページの解析結果）が実際と合わなくなる                                    |
| 3           | DB に保存せず、MCP サーバーのプロセスの中だけで保持する                                                                | 変えない                                                  | 無し。サーバーを起動し直すたびに、最初の 1 回は索引を取る。016 の「DB に保存」を「サーバーのプロセスの中で保持」に直す         |

案 1 を採るなら、K の会話には次を渡す。

- 足すテーブル: タックスアンサーの索引（1 行 1 記事: 番号（主キー）・記事の URL・税目フォルダ・題名）と、索引のページの取得の記録（URL・取得日時・`Last-Modified`・`ETag`）。テーブル名・列名は K が db_schema で決める
- 版上げ: K の版上げ（#107 の版の扱い・#112 の `document.doc_type` / `taxonomy` の `CHECK`）と同じ 1 回にする。既存の行は変えず、新しいテーブルは空で作る（国税庁サイトは取りに行かない）
- #112 の `taxonomy` の `CHECK` を入れるなら、タックスアンサーの値に `saigai`・`hyoka`・`zoyo`・`hotei`・`fufuku` を含める（cli_bulk_download の 13 個）
- `--bulk-download-tax-answer` が取った索引を同じテーブルに保存するか（016 の最後の行）。保存すれば、bulk download の後の `nta_get_tax_answer` は索引を取らない
- `--refresh`（cli_refresh）で索引の保存も消すか

## #131 事務運営指針の `legal_status.note`

**今の動き（v0.23.0）**: `nta_get_jimu_unei` の json は `JIMU_UNEI_LEGAL_STATUS`（`通達・事務運営指針は行政内部文書であり、…`）。`nta_search_jimu_unei`（ヒットあり・0 件）と `nta_inspect_pdf_meta` の `docType: "jimu-unei"` は `TSUTATSU_LEGAL_STATUS`（`通達は行政内部文書。…`）。`binds_*` の値は同じ。仕様（SEARCH-JIMU-UNEI-002・003、INSPECT-PDF-META-016、SEARCH-RULES-015）は「通達は行政内部文書である旨の注」とだけ書き、文を約束していない。

**変えた後の動き**: 3 つのツールとも `JIMU_UNEI_LEGAL_STATUS` と同じ値にし、仕様に `note` の文を書く。

| 種類     | 仕様 ID                                                                                                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODIFIED | SPEC-NTA-SEARCH-JIMU-UNEI-002（003 は 002 を参照するので変えない）、SPEC-NTA-INSPECT-PDF-META-016、SPEC-NTA-GET-JIMU-UNEI-005（0.23.0 の文を本文に書くだけ。振る舞いは変えない）、SPEC-NTA-SEARCH-RULES-015（`legal_status` の表の行を分ける） |

| 決めること                     | 答え                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 上の案で揃えるか            | 揃える                                                                                                                                                                                                                                                                                                                                  |
| 2. markdown の注の文も揃えるか | 揃えない（SPEC-NTA-GET-JIMU-UNEI-006 は変えない）。markdown の注は、改正通達（`*通達は行政内部文書であり、納税者・裁判所への直接的拘束力なし（最高裁 昭和43.12.24）*`）と事務運営指針で同じ形の短い文にそろっており、json の `note` とは別の書き方として並んでいる。揃えるなら改正通達の注も一緒に見直すことになり、#131 の範囲を超える |
| 3. どの段階で入れるか          | 段階 5 の 0.24.0（この差分）                                                                                                                                                                                                                                                                                                            |

## 変わらない振る舞い

- ページが無い（404・410・転送）ときの `DOC_NOT_FOUND`（SPEC-NTA-GET-QA-014、SPEC-NTA-GET-TAX-ANSWER-013 の後者）と、`nta_get_tsutatsu` の候補ページの 404 で次へ進むこと
- `fetchNtaPage` の取り直しの回数・間隔・30 秒の打ち切り。429 を取り直さないこと
- `nta_get_tax_answer` の DB の経路（004・009・010）と、応答の形（007・008）
- `nta_inspect_pdf_meta` の `save: true` の PDF の取得の失敗（`saved[].error`。SPEC-NTA-INSPECT-PDF-META-011・015）と、CLI の bulk download の取得の失敗。この差分の code の表は tools/call のエラーだけに当てる
- 事務運営指針の `binds_*` の値、改正通達の `legal_status`、markdown の注
- 応答のフィールドを消す・名前を付け替える変更は無い。`nta_get_tsutatsu` の `SOURCE_*` に `tool` を足すだけ（T4）

## 互換性（0.24.0 の CHANGELOG の「互換性」の節に書くもの）

T2 の互換の扱い（旧 code → 新 code を書き、同じ日に houki-research-skill の `docs/ERROR-CODES.md` を直し、minor を上げる。旧 code を並行して返す期間は設けない）に従う。

| 場面                                                                                | 0.23.0                                                      | 0.24.0                                                                                  |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 国税庁サイトが 429（`nta_get_qa`・`nta_get_tax_answer`・`nta_get_tsutatsu`）        | `SOURCE_API_ERROR`・`retryable: true`                       | `SOURCE_RATE_LIMITED`・`retryable: true`                                                |
| 国税庁サイトが 30 秒以内に応答しない                                                | `SOURCE_API_ERROR`・`retryable: true`                       | `SOURCE_TIMEOUT`・`retryable: true`                                                     |
| 国税庁サイトに接続できない（`ENOTFOUND` など）                                      | `SOURCE_API_ERROR`・`retryable: true`・`detail.status` 無し | `SOURCE_UNAVAILABLE`・`retryable: true`・`detail.cause`                                 |
| 国税庁サイトが 403・400 など                                                        | `SOURCE_API_ERROR`・`retryable: true`・`retry_later`        | `SOURCE_API_ERROR`・`retryable: false`・`next_actions` 無し                             |
| `nta_get_tsutatsu` の目次のページが 404                                             | `SOURCE_API_ERROR`・`retryable: true`                       | `SOURCE_API_ERROR`・`retryable: false`                                                  |
| `nta_get_tax_answer` に `8xxx`・`0xxx`                                              | `INVALID_ARGUMENT`                                          | `8xxx` は記事を返す。`0xxx` は `DOC_NOT_FOUND`                                          |
| `nta_get_tax_answer` で DB に無く、索引に無い番号                                   | 先頭の桁のフォルダを取りに行き、転送なら `DOC_NOT_FOUND`    | 記事を取りに行かずに `DOC_NOT_FOUND`（`detail.url` は索引の URL、`detail.status` 無し） |
| `nta_get_tax_answer` で DB に無い `2010`・`4402`・`7400` など 113 件                | `DOC_NOT_FOUND`                                             | 記事を返す                                                                              |
| `--tax-answer-taxonomy=saigai` など 5 個                                            | 使えない値                                                  | 使える                                                                                  |
| `nta_search_jimu_unei`・`nta_inspect_pdf_meta`（`jimu-unei`）の `legal_status.note` | `通達は行政内部文書。…`                                     | `通達・事務運営指針は行政内部文書であり、…`                                             |

## 実装の変更

- `src/services/nta-scraper.ts`: `NtaFetchError` に失敗の種類（時間切れ・接続できない（`cause.code` が 019 の 5 つ）・HTTP・そのほか）を持たせる。時間切れは `AbortController` の中断で分かる。取り直しの回数と 4xx を取り直さないことは変えない
- `src/tools/handlers.ts`: `liveFetchError()` と `renderLiveResult()` の `fetch_error` を、018 の表で code・`retryable`・`next_actions`・`hint` に振り分ける共通の関数にする。`nta_get_tsutatsu` にも `tool` を付ける。`nta_get_tax_answer` の先頭の桁の検査（002）を消し、URL を DB の行 → 索引で決める。書き戻す行の `taxonomy` を URL のフォルダにする
- タックスアンサーの索引: bulk download の索引の解析（`src/services/tax-answer-bulk-downloader.ts`）を `nta_get_tax_answer` からも使う。保存先は「索引を DB に保存するためのスキーマ」の案 1〜3 のどれか（案 1 なら K のスキーマの版上げの後）
- `src/constants.ts`: `TAX_ANSWER_FOLDER_MAP` を `nta_get_tax_answer` の URL に使わない。`--tax-answer-taxonomy` の一覧（`src/cli.ts` の `TAX_ANSWER_TAXONOMIES`）を 13 個の固定の一覧にする。`LEGAL_STATUS_BY_DOCTYPE['jimu-unei']` を `JIMU_UNEI_LEGAL_STATUS` にする
- `src/tools/handlers.ts` の `nta_search_jimu_unei` の 2 か所の `legal_status: TSUTATSU_LEGAL_STATUS` を `JIMU_UNEI_LEGAL_STATUS` にする

## 実装 PR で直す文書

| #   | 場所                                                                                                        | 直すこと                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | tools/list の `nta_get_tax_answer` の `description` と `no` の `description`                                | 「番号の先頭桁から税目フォルダを自動判定」「先頭桁で税目決定: 1xxx=所得税 … 9xxx=お知らせ」を、「国税庁の索引で番号から記事の URL を決める。8xxx（災害）も取れる」にする |
| 2   | 未対応の番号帯のエラー文（#70 の T5 の文書 1、保留していた行）                                              | 002 を外すのでエラー文ごと消える。#70 の行 1 はこの版で片付く                                                                                                            |
| 3   | README のエラーの表                                                                                         | `SOURCE_TIMEOUT`・`SOURCE_RATE_LIMITED`・`SOURCE_UNAVAILABLE` の行を足し、`SOURCE_API_ERROR` の行に「403・400 などは `retryable: false`」を足す                          |
| 4   | README の 322 行目付近の呼び出し例のコメント `// nta_get_tax_answer — 番号で取得（先頭桁から税目自動判定）` | 「（国税庁の索引で URL を決める）」にする                                                                                                                                |
| 5   | `src/cli.ts` の使い方の `--tax-answer-taxonomy の値:`                                                       | 一覧から作っているので、4 の一覧の変更で 13 個になる（文の直しは要らない）                                                                                               |
| 6   | CHANGELOG の 0.24.0                                                                                         | 上の「互換性」の表                                                                                                                                                       |

## 取り込みのとき（Publisher）

- ADDED の見出しを、各 `specs/current/<dir>/spec.md` の「できること」の末尾に足す（`common_errors` は 018・019、`nta_get_tax_answer` は 016・017）。MODIFIED は見出しの行（題）も含めて、差分の見出しと本文に置き換える
- REMOVED の SPEC-NTA-GET-TAX-ANSWER-002 は見出しごと消し、同じコミットで、その ID を名前に持つテストを消す。2026-10-03 の main では `src/tools/handlers.test.ts` 927 行目付近の `it`（002 だけの名前）。`src/tools/spec-20261001-t1-argument-guards.test.ts` 824 行目付近の `it` は 012 と 002 の両方を名前に持ち、`no: "8101"` が 002 のエラーになることを確かめているので、消さずに 012 の MODIFIED の例（`"8001"` は検査を通る）に合わせて書き直す（Test Designer の仕事。名前から 002 を外す）
- 各差分の spec.md の末尾の「ID の無い節の変更」を行う（`cli_bulk_download` は入力の表だけ）
- 各 `specs/current/<dir>/spec.md` の承認日の行に「差分 `20261003-source-paths` は YYYY-MM-DD（PR #N）」を足す
- この差分のフォルダーを `specs/releases/v0.24.0/20261003-source-paths/` へ移し、この proposal.md の「状態」を取り込み済みにする
- CHANGELOG の 0.24.0 に閉じる Issue（#120・#128・#131）を列挙する。`Closes` は実装 PR の本文に書く

## 人が判断すること

1. **（#120）4 つの code に分けること。** 分ける側で書いた（018・019）。分けない案は「決めること」1 の答えのとおり勧めない。
2. **（#120）429 を取り直さないまま `SOURCE_RATE_LIMITED` にすること。** houki-egov-mcp は 429 も 3 回取り直すが、nta は v0.21.x から 4xx を取り直さない（国税庁サイトへの取得の決まり: 1 秒に 1 回以下、同じホストに 1 本）。取り直すようにする案もあるが、この差分では今の取得の決まりを変えない。`Retry-After` の値を応答に入れるかも決めていない（入れない側）。
3. **（#120）403・400 などを `retryable: false`・`next_actions` 無しにすること。** 018 の本文の理由で `false` にした。`next_actions` に国税庁サイトを直接開く案内（egov の `visit_egov_site` に当たるもの）を入れる案もあるが、nta にはまだその action が無いので入れなかった。
4. **（#128）案 A（索引で URL を決める）と、002 を外すこと。** A で書いた。B（番号の範囲の表）は国税庁が記事を足すと表が古くなる。
5. **（#128）索引の保存先（案 1〜3）。** 案 1（新しいテーブル、K の版上げと 1 回にまとめる）を勧める。案 1 を採るなら、K の会話に上の「索引を DB に保存するためのスキーマ」の 5 点を渡す。案 3 を採るなら、016 の「DB に保存して」を「サーバーのプロセスの中で保持して」に直してからマージする（スキーマは変わらず、K に渡すものは無い）。
6. **（#128）`--tax-answer-taxonomy` の一覧を 13 個の固定の一覧にすること。** 索引に新しいフォルダが現れたら、一覧を足す版を出す。
7. **（#131）markdown の注は揃えないこと（決めること 2）。** 揃えない側で書いた。
8. **（#131）SPEC-NTA-SEARCH-RULES-015 を MODIFIED にすること。** 015 の `legal_status` の表で事務運営指針の行を改正通達から分けた。015 は大きな見出しなので、本文の他の行は current のまま写した。
9. **承認日。** この proposal.md に承認日と PR 番号を書く。

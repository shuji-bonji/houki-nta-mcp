# 差分: common_errors（国税庁サイトとの通信の失敗を 4 つの code に分ける・タックスアンサーの索引の解析の失敗）

この差分は `specs/current/common_errors/spec.md` に対するものです。見出し単位で、足す（ADDED）・置き換える（MODIFIED）を書きます。ID の無い節の変更は末尾の「ID の無い節の変更」に書きます。

## ADDED

### SPEC-NTA-COMMON-ERRORS-018 国税庁サイトへの要求の終わり方で、取り直すか・どの code にするか・`retryable` を決める

国税庁サイトから 1 ページを取るツール（`nta_get_qa`・`nta_get_tax_answer`・`nta_get_tsutatsu`）は、要求が次の表のどれで終わったかで、取り直すか、どのエラーを返すかを決める。取り直すときは、1 回目の失敗から 1 秒・2 秒・4 秒あけて、合わせて 4 回まで要求する。1 回の要求で応答を待つのは 30 秒までで、それを過ぎたら打ち切る。

| 国税庁サイトへの要求の終わり方 | 取り直し | `code` | `retryable` | `next_actions` | `detail` |
|---|---|---|---|---|---|
| HTTP 404・410、`https://www.nta.go.jp/error/404.htm` への転送（ページが無い） | しない | 各ツールの spec.md（`DOC_NOT_FOUND`。`nta_get_tsutatsu` は次の候補ページへ進む） | `false` | 各ツールの spec.md（正しい番号を探す検索ツール） | `status`（転送は 404）、`url` |
| HTTP 429 | しない | `SOURCE_RATE_LIMITED` | `true` | `retry_later` | `status: 429`、`url` |
| 応答を待ちきれなかった（30 秒で打ち切った） | する | `SOURCE_TIMEOUT` | `true` | `retry_later` | `url` |
| HTTP 5xx | する | `SOURCE_API_ERROR` | `true` | `retry_later` | `status`、`url` |
| HTTP 4xx（404・410・429 を除く。403・400 など） | しない | `SOURCE_API_ERROR` | `false` | 付けない | `status`、`url` |
| 接続できない（SPEC-NTA-COMMON-ERRORS-019） | する | `SOURCE_UNAVAILABLE` | `true` | `retry_later` | `cause`（`ENOTFOUND` などの code）、`url` |
| そのほかのネットワークの失敗（例外の `cause.code` が 019 の表に無いもの） | する | `SOURCE_API_ERROR` | `true` | `retry_later` | `cause`（例外の文）、`url` |

- 4 つの `SOURCE_*` のエラーの `error` は `国税庁サイトからの取得に失敗: <失敗の説明>`、`tool` は呼んだツールの名前
- `hint` は code ごとに次の内容を書く。`SOURCE_RATE_LIMITED`: 国税庁サイトが要求の回数を制限していること、間隔をあけて呼び直すこと。`SOURCE_TIMEOUT`: 国税庁サイトが 30 秒以内に応答しなかったこと、時間をおいて呼び直すこと。`SOURCE_UNAVAILABLE`: 国税庁サイトに接続できなかったこと、ネットワークか DNS を確かめること。`SOURCE_API_ERROR`（5xx・そのほかのネットワークの失敗）: 時間をおいて呼び直すこと。`SOURCE_API_ERROR`（4xx）: 国税庁サイトがこの要求を受け付けなかったこと（HTTP <status>）、時間をおいても変わらない見込みで、続くときは報告してほしいこと
- 429 を取り直さないのは、取り直すと国税庁サイトへの要求をさらに増やすためである。取り直すかどうかは呼び出し側（LLM）が `retryable` と `next_actions` で決める
- 403・400 など（404・410・429 を除く 4xx）を `retryable: false` にするのは、取り直しても結果が変わりにくいためである。URL はこのサーバーが組み立て、識別子の形は国税庁サイトを引く前に確かめる（SPEC-NTA-COMMON-ERRORS-015）ので、400 は引数の誤りではなく URL の組み立ての誤りか国税庁サイトの変更であり、403 はアクセスの拒否と考えられる

houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-027 と同じ code・`retryable` である。違いは 2 つで、houki-egov-mcp は 429 を取り直すが houki-nta-mcp は取り直さない（v0.21.x からの国税庁サイトへの取得の決まり）、houki-egov-mcp は e-Gov の応答本文の `code` で 4xx をさらに分ける（`404004` を `LAW_NOT_FOUND` など。SPEC-EGOV-COMMON-ERRORS-033）が、国税庁サイトの 4xx の応答本文には分けられる値が無い。

例: `nta_get_qa` に `{ topic: "shohi", category: "02", id: "19" }` を渡し、事例が DB に無いとき、国税庁サイトの応答が次のとおりなら、返す code は次のとおり（v0.23.0 では 404・410・転送以外はどれも `SOURCE_API_ERROR`・`retryable: true`・`next_actions: [retry_later]` だった）。

| 国税庁サイト | `code` | `retryable` |
|---|---|---|
| 429 | `SOURCE_RATE_LIMITED` | `true` |
| 30 秒を過ぎても応答しない（4 回とも） | `SOURCE_TIMEOUT` | `true` |
| 503（4 回とも） | `SOURCE_API_ERROR` | `true` |
| 403 | `SOURCE_API_ERROR` | `false` |
| `fetch failed`、`cause.code: "ENOTFOUND"`（4 回とも） | `SOURCE_UNAVAILABLE` | `true` |

### SPEC-NTA-COMMON-ERRORS-019 国税庁サイトに接続できないときは、例外の `cause.code` を見て `SOURCE_UNAVAILABLE` を返す

国税庁サイトへの要求で、HTTP の応答を受け取る前に接続の失敗で例外が起きたときは、例外の `message` だけでなく `cause.code`（Node の `fetch` が投げる `TypeError: fetch failed` の `cause` に入る、`ENOTFOUND` のような文字列）も見て、次の表の code のどれかなら `SOURCE_UNAVAILABLE`（`retryable: true`）を返す。`detail.cause` にその code を入れる。取り直しは SPEC-NTA-COMMON-ERRORS-018 のとおり（合わせて 4 回）で、取り直しても接続できなかったときにこのエラーになる。

| `cause.code`   | 意味                       |
| -------------- | -------------------------- |
| `ENOTFOUND`    | ホスト名を解決できない     |
| `EAI_AGAIN`    | DNS が一時的に答えない     |
| `ECONNREFUSED` | 接続を拒否された           |
| `ECONNRESET`   | 接続が途中で切れた         |
| `ETIMEDOUT`    | TCP の接続が時間切れになった |

表は houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-028 と同じである。`cause.code` がこの表に無いネットワークの失敗は、SPEC-NTA-COMMON-ERRORS-018 の表の最後の行（`SOURCE_API_ERROR`、`retryable: true`）のままである。このサーバーが 30 秒で打ち切った要求は、この ID ではなく `SOURCE_TIMEOUT` になる。

例: `fetch` が `TypeError("fetch failed")` を投げ、その `cause` が `{ code: "ENOTFOUND", hostname: "www.nta.go.jp" }` のとき、DB に無い記事を `nta_get_tax_answer` に `{ no: "6101" }` で求めると、`code: "SOURCE_UNAVAILABLE"`、`retryable: true`、`detail.cause: "ENOTFOUND"`（v0.23.0 では `SOURCE_API_ERROR`、`detail.status` 無し）。

## MODIFIED

### SPEC-NTA-COMMON-ERRORS-009 国税庁のページの解析に失敗したときは `INTERNAL_ERROR`（`retryable: false`）で、ページの構造の変更を疑う案内を付ける

国税庁サイトから取ったページを読み取れなかったときは、エラー `INTERNAL_ERROR` を返す（`isError: true`）。当てはまるのは次の 3 ツールである。

| ツール | 読み取れなかったページ | `error` |
|---|---|---|
| `nta_get_tsutatsu` | 条項のある節のページ、または目次のページ（SPEC-NTA-GET-TSUTATSU-006・014） | `通達ページのパースに失敗: <理由>` |
| `nta_get_qa` | 事例のページ（SPEC-NTA-GET-QA-005） | `質疑応答事例ページのパースに失敗: <理由>` |
| `nta_get_tax_answer` | 記事のページ（SPEC-NTA-GET-TAX-ANSWER-005） | `タックスアンサーページのパースに失敗: <理由>` |
| `nta_get_tax_answer` | タックスアンサーの索引のページ（SPEC-NTA-GET-TAX-ANSWER-016）から記事の URL が 1 件も読み取れない | `タックスアンサーの索引のパースに失敗: <理由>` |

- `retryable` は `false`（ページの構造が変わったか、パーサの不具合で、時間をおいても結果は変わらない。SPEC-NTA-COMMON-ERRORS-006 と同じ）
- `hint` は `パーサのバグまたは国税庁ページの構造変更の可能性。報告してください`
- `url` に、読み取れなかったページの URL を入れる
- `detail` は `{ url: <同じ URL>, cause: <理由> }`
- 読み取れなかったページの内容は DB に書き戻さない

ページの取得そのものに失敗したとき（SPEC-NTA-COMMON-ERRORS-018 の `SOURCE_*`）と、処理中の想定外の例外（SPEC-NTA-COMMON-ERRORS-006）は、この ID に当たらない。

例: `nta_get_qa` が取った事例のページから照会要旨を読み取れなかったとき、`code: "INTERNAL_ERROR"`、`retryable: false`、`hint` は上の文（v0.22.0 では `retryable` が無かった）。

### SPEC-NTA-COMMON-ERRORS-016 `SOURCE_*` は国税庁サイトとの通信が失敗したときだけ返し、`*_NOT_FOUND` は問い合わせが成功して求めたものが無かったときだけ返す

`SOURCE_API_ERROR` / `SOURCE_TIMEOUT` / `SOURCE_RATE_LIMITED` / `SOURCE_UNAVAILABLE` は、国税庁サイトへの要求が SPEC-NTA-COMMON-ERRORS-018 の表の「ページが無い」以外の行で終わったときだけ返す。`DOC_NOT_FOUND` / `TSUTATSU_NOT_FOUND` / `ARTICLE_NOT_FOUND` は、ローカル DB を引いて求めたものが無かったとき、国税庁の索引を引いて求めた番号が無かったとき（`nta_get_tax_answer`。SPEC-NTA-GET-TAX-ANSWER-013）、または国税庁サイトへの要求が「そのページは無い」という答え（HTTP 404・410、`https://www.nta.go.jp/error/404.htm` への転送）で終わったときに返す。ページが無いことは番号や docId の誤りなので `retryable: false` にし、`next_actions` には時間をおいて取り直す案内（`retry_later`）を入れず、正しい番号を探すツールを入れる。

「DB にその種別が 1 件も無い」と「DB にはあるがその docId が無い」は、どちらも DB を引いて 0 件なので同じ code（`DOC_NOT_FOUND`）で、見分けは `error` の文・`available_doc_ids`・`next_actions`（`cli_bulk_download` か検索ツールか）で付ける。

| 場面                                                            | `code`                                        | `retryable` | 仕様 ID                                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| 文書系 3 ツールで、DB にその種別が無い・その docId が無い       | `DOC_NOT_FOUND`                               | 付けない    | SPEC-NTA-GET-BUNSHOKAITOU-002・003、SPEC-NTA-GET-JIMU-UNEI-001・002、SPEC-NTA-GET-KAISEI-TSUTATSU-001・002 |
| `nta_get_qa` / `nta_get_tax_answer` で、国税庁サイトにページが無い | `DOC_NOT_FOUND`                               | `false`     | SPEC-NTA-GET-QA-014、SPEC-NTA-GET-TAX-ANSWER-013                                                          |
| `nta_get_tax_answer` で、国税庁の索引にその番号が無い             | `DOC_NOT_FOUND`                               | `false`     | SPEC-NTA-GET-TAX-ANSWER-013                                                                               |
| `nta_get_tsutatsu` で、候補ページが無い                          | `ARTICLE_NOT_FOUND`                           | 付けない    | SPEC-NTA-GET-TSUTATSU-009・010                                                                             |
| 国税庁サイトとの通信の失敗                                      | `SOURCE_*`（SPEC-NTA-COMMON-ERRORS-018 の表） | 018 の表    | SPEC-NTA-GET-QA-015、SPEC-NTA-GET-TAX-ANSWER-014・017、SPEC-NTA-GET-TSUTATSU-009                          |

houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-027 と同じ規則である。

例: `nta_get_tax_answer` に `{ no: "6999" }` を渡し、DB に無く、国税庁の索引にも無いときは `DOC_NOT_FOUND`・`retryable: false` で、記事のページは取りに行かない。索引にある番号で、国税庁サイトが記事のページを 503 で返し続けたときは `SOURCE_API_ERROR`・`retryable: true`。`nta_get_jimu_unei` に DB に無い docId を渡したときは `DOC_NOT_FOUND`（v0.21.3 では `TSUTATSU_NOT_FOUND` だった）。

## ID の無い節の変更

- 「エラーの code」の表:
  - `SOURCE_API_ERROR` の行を「国税庁サイトとの通信が失敗した（HTTP 5xx、404・410・429 以外の 4xx、`SOURCE_UNAVAILABLE` に当たらないネットワークの失敗）。ページが無い（404）ことは含まない（SPEC-NTA-COMMON-ERRORS-018）」にする
  - `SOURCE_TIMEOUT` / `SOURCE_RATE_LIMITED` の行を 2 行に分ける。`SOURCE_TIMEOUT`「国税庁サイトが 30 秒以内に応答しなかった（018）」、`SOURCE_RATE_LIMITED`「国税庁サイトが HTTP 429 を返した（018）」。「v0.21.0 ではどのツールも返さない」を消す
  - `SOURCE_UNAVAILABLE` の行を足す。「国税庁サイトに接続できなかった（DNS の失敗・接続の拒否など。019）」
  - `DOC_NOT_FOUND` の行に「`nta_get_tax_answer` で国税庁の索引にその番号が無いときも同じ」を足す
- 「未決」の 9 を消す（番号は振り直さない）
- 冒頭の「関連する Issue」に `#120（通信の失敗の code）` を足す

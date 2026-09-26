# 機能: nta_inspect_pdf_meta（文書の添付 PDF の一覧と読み方を返す）

- 機能 ID: NTA
- 版: current
- 承認日: 2026-09-26（PR #63）
- 起こした元: v0.21.0 の `src/tools/handlers.ts`（`handleNtaInspectPdfMeta`）、`src/tools/definitions.ts`、`src/tools/tool-args.ts`、`src/services/pdf-meta.ts`、`src/services/pdf-files.ts`、`src/constants.ts`、`src/tools/handlers.test.ts`
- 関連する Issue: houki-nta-mcp #36（読み方の事実と `save: true`）、#44（改正通達の「別紙 N」を新旧対照表として扱う）、#1（docType 別の `legal_status`）

この文書は「このツールは何をするか」を書きます。どう実装しているか（関数名・テーブル名）は書きません。

## アクター

- MCP クライアント（Claude などの LLM、または CLI から呼ぶ人）。`docType` と `docId` を渡して、ローカル DB にあるその文書の添付 PDF の一覧（種別・読み方・URL）を受け取る。PDF の本文は受け取らない。`save: true` にすると PDF をサーバー側に保存した絶対パスも受け取り、pdf-reader-mcp などの PDF 読み取りツールにそのパスを渡す

## 入力

| 引数      | 必須 | 内容                                                                                                                                                                                                |
| --------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docType` | 必須 | 文書種別。`kaisei`（改正通達）/ `jimu-unei`（事務運営指針）/ `bunshokaitou`（文書回答事例）/ `tax-answer`（タックスアンサー）のどれか。質疑応答事例（qa-jirei）は PDF を持たないので選べない        |
| `docId`   | 必須 | 文書 ID。`nta_search_*` の結果や `nta_get_*` の応答から得る                                                                                                                                         |
| `kind`    | 任意 | 返す PDF の種別を 1 つに絞る。`comparison`（新旧対照表）/ `attachment`（別紙・別表）/ `qa-pdf`（Q&A）/ `related`（参考資料）/ `notice`（通知・連絡）/ `unknown`（判定できなかったもの）。省くと全件 |
| `save`    | 任意 | `true` のとき、返す PDF をサーバー側の保存先に取得し、`saved[]` に絶対パスを返す。既定は `false`                                                                                                    |

保存先は、環境変数 `HOUKI_NTA_FILES_DIR` があればその下、無ければ `XDG_CACHE_HOME`（無ければ `~/.cache`）の下の `houki-nta-mcp/files/`。その中に `<docType>/<docId>/<URL の最後のパス要素>` の形で置く。

## 処理の流れ

呼び出しを受けてから応答を返すまでに、何をどの順で確かめるかを示します。図の中の番号は「できること」の仕様 ID の末尾 3 桁です。

```mermaid
flowchart TD
  A["呼び出し（docType・docId・kind・save）"] --> B{"docType と docId の組がローカル DB にあるか"}
  B -- 無い --> E1["DOC_NOT_FOUND を返す。国税庁サイトには取りに行かない（001）"]
  B -- ある --> C["kind の無い PDF は題名から kind を決める（003）"]
  C --> D["kaisei の「別紙 N」だけの題名の attachment を comparison にする（004）"]
  D --> F["各 PDF に read_strategy と layout_note を付ける（005）"]
  F --> G{"kind を渡したか"}
  G -- はい --> H["その kind の PDF だけに絞る（006）"]
  H --> I{"絞った結果が 0 件か"}
  I -- はい --> K{"kaisei・kind が comparison で、attachment の PDF があるか"}
  K -- はい --> L["別紙も読むよう note に書き足す（008）"]
  K -- いいえ --> J["attachedPdfs: [] と、ある種別の note を返す。next_actions は付けない（007）"]
  L --> J
  I -- いいえ --> M{"save: true か"}
  G -- いいえ --> M
  M -- はい --> N{"保存先に同じパスのファイルがあるか（PDF ごと）"}
  N -- ある --> O["取りに行かず cached: true で返す（013）"]
  N -- 無い --> P["国税庁サイトから取って保存先に置く（010）"]
  P --> Q{"取得の応答が 2xx か"}
  Q -- いいえ --> R["saved[] に error 付きで残し、note に失敗の件数を書く（011）"]
  Q -- はい --> T
  O --> T
  R --> T
  M -- いいえ --> T["kind ごとの呼び出し例と read_pdf の 1 件を next_actions に付ける（009）。保存できた PDF は file_path を渡す形にする（012）"]
  T --> U["kind の順の attachedPdfs・legal_status などの応答（002）と、save: true のときは saved[]（010）を返す"]
```

## できること

### SPEC-NTA-INSPECT-PDF-META-001 ローカル DB に無い文書は取りに行かない

`docType` と `docId` の組がローカル DB に無いときは、エラー `DOC_NOT_FOUND` を返す。`error` に「DB に未登録」である旨、`hint` に `--bulk-download-<docType>`（例: `--bulk-download-kaisei`）で投入済みかを確かめることと、`docId` が正しいかを `nta_search_*` で確かめられることを書く。国税庁サイトには取りに行かない。

### SPEC-NTA-INSPECT-PDF-META-002 文書の添付 PDF の一覧を種別の順に返す

文書がローカル DB にあるとき、応答は次のフィールドを持つ。

| フィールド            | 内容                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `docType` / `docId`   | 引数のとおり                                                                                               |
| `title` / `sourceUrl` | 文書の題名と、文書ページの URL                                                                             |
| `attachedPdfs`        | 添付 PDF の配列。要素は `title`・`url`・`sizeKb`（分かるときだけ）・`kind`・`read_strategy`・`layout_note` |
| `legal_status`        | 文書種別に応じた法的位置付け（`binds_citizens` / `binds_courts` / `binds_tax_office` と注）                |

`attachedPdfs` は `kind` の順に並べる。順は `comparison` → `attachment` → `qa-pdf` → `related` → `notice` → `unknown`。同じ `kind` の中では DB に入っている順のまま。

例: 「別紙1 計算明細書」（`attachment`）と「新旧対照表」（`comparison`）がこの順で入っている改正通達では、応答の `attachedPdfs` は `comparison` の「新旧対照表」が先、`attachment` の「別紙1 計算明細書」が後になる。

### SPEC-NTA-INSPECT-PDF-META-003 種別の無い PDF は題名から種別を決める

DB に入っている PDF に `kind` が無い（v0.6.0 期に投入した文書）ときは、題名から `kind` を決めて応答に入れる。題名の語で決める。「新旧対照表」「新旧対応表」「対比表」は `comparison`、「Q&A」「質疑応答」「FAQ」は `qa-pdf`、「別紙」「別表」「様式」「付録」「添付資料」は `attachment`、「通知」「お知らせ」「連絡」は `notice`、「参考」「参考資料」「関連資料」は `related`。どれにも当たらなければ `unknown`。全角の英字・`＆`・空白の違いは吸収する。DB の内容は書き換えない。

例: `kind` の無い「新旧対応表」は `comparison` として返る。

### SPEC-NTA-INSPECT-PDF-META-004 改正通達の「別紙 N」だけの題名は comparison として返す

`docType` が `kaisei` で、題名が「別紙」と番号だけ（「別紙1」「別紙２」「別紙1（PDF/221KB）」「（別紙2）」「別紙1-2」）の `attachment` は、応答では `kind` を `comparison` にして返す。改正通達の本文が「別紙のとおり改める」と書く別紙は新旧対照表本体のことが多いためである。「別紙1 計算明細書」「別紙3 様式」のように別の語を含む題名は `attachment` のまま。`kaisei` 以外の `docType` では変えない。DB の `kind` は書き換えない。

例: 改正通達 0025004-026 の「【参考】…新旧対応表」「別紙1（PDF/221KB）」「別紙2（PDF/449KB）」「別紙3 様式」に `kind: "comparison"` で絞ると、前の 3 件が `comparison` として返り、「別紙3 様式」は `attachment` のまま返らない。

### SPEC-NTA-INSPECT-PDF-META-005 各 PDF に読み方（read_strategy と layout_note）を付ける

`attachedPdfs` の各要素に、`kind` に応じた `read_strategy` と `layout_note` を付ける。どちらも PDF 読み取りツールの名前を含まない。

| `kind`       | `read_strategy` | `layout_note` の要点                                                                                                                                                                                                                                  |
| ------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comparison` | `tables`        | 改正後と改正前を左右 2 列に並べた表。左が改正後・右が改正前のことが多いが見出し行で確かめる。「（同左）」「（省略）」「（新設）」「（削除）」と「【新設】」「【削除】」「【一部改正】」の 2 通りの印がある。表として取れないなら左右 2 列に分けて読む |
| `attachment` | `tables`        | 別紙・別表・様式。表として取れるなら表で、取れなければ本文として読む。改正通達（kaisei）の別紙は新旧対照表本体のことが多い                                                                                                                            |
| `qa-pdf`     | `text`          | 問と答が交互に並ぶ散文。本文として通して読む                                                                                                                                                                                                          |
| `related`    | `text`          | 参考資料。本文として読む                                                                                                                                                                                                                              |
| `notice`     | `text`          | 通知・連絡。本文として読む。調査の結論には通常含めない                                                                                                                                                                                                |
| `unknown`    | `sample`        | 先頭ページを読んで中身を確かめてから決める                                                                                                                                                                                                            |

### SPEC-NTA-INSPECT-PDF-META-006 kind で絞る

`kind` を渡したときは、その `kind` の PDF だけを `attachedPdfs` に入れる。SPEC-NTA-INSPECT-PDF-META-003 と 004 で決めた後の `kind` で絞る。`next_actions` と `saved[]` も絞った後の PDF だけを対象にする。

例: 「新旧対照表」と「別紙1 計算明細書」のある改正通達に `kind: "comparison"` を渡すと、`attachedPdfs` は「新旧対照表」の 1 件、`next_actions` は `pdf-reader-mcp:read_url` と `read_pdf` の 2 件になる。

### SPEC-NTA-INSPECT-PDF-META-007 絞った結果が 0 件のときは空の一覧と、ある種別の注記を返す

`kind` で絞って該当が無いときは、エラーにせず `attachedPdfs` を空の配列で返す。`next_actions` は付けない。`note` に `kind="<kind>" の PDF はありません。この文書にある種別: <この文書の PDF の kind の一覧>` と書く（種別は SPEC-NTA-INSPECT-PDF-META-002 の順、`, ` 区切り）。

例: `comparison` と `attachment` のある文書に `kind: "qa-pdf"` を渡すと、`note` は `kind="qa-pdf" の PDF はありません。この文書にある種別: comparison, attachment` になる。

### SPEC-NTA-INSPECT-PDF-META-008 改正通達で comparison が無く attachment があるときは別紙を読むよう注記する

`docType` が `kaisei`、`kind` が `comparison` で該当が 0 件、かつその文書に `attachment` の PDF があるときは、SPEC-NTA-INSPECT-PDF-META-007 の `note` に続けて `改正通達（kaisei）の別紙は新旧対照表本体のことが多いので、kind="attachment" の別紙も読んでください` と書く。

### SPEC-NTA-INSPECT-PDF-META-009 next_actions に kind ごとの呼び出し例と汎用の 1 件を付ける

`attachedPdfs` が 1 件以上あるとき、`next_actions` を付ける。内容は次のとおり。

- 応答に含まれる `kind` ごとに 1 件（同じ `kind` の中では先頭の PDF を使う）。順は SPEC-NTA-INSPECT-PDF-META-002 の `kind` の順
- 最後に汎用の 1 件。`action` は `read_pdf`。`example` は先頭の PDF の `url`（保存済みならそれに `path` を加える）。pdf-reader-mcp が無い環境で、使っている PDF 読み取りツールに渡すためのもの
- `example` は引数だけを持つ（`mcp` / `tool` は入れない）

保存していない PDF（`save` を渡さないか、保存に失敗した）の 1 件は、`action` が `pdf-reader-mcp:read_url` で、`example` は次のとおり。

| `read_strategy`          | `example`                   |
| ------------------------ | --------------------------- |
| `tables`（`comparison`） | `{ url, split_columns: 2 }` |
| `tables`（`attachment`） | `{ url }`                   |
| `text`                   | `{ url }`                   |
| `sample`                 | `{ url, pages: "1" }`       |

例: 「新旧対照表」と「別紙1 計算明細書」のある改正通達を `save` 無しで呼ぶと、`next_actions` の `action` は `pdf-reader-mcp:read_url`・`pdf-reader-mcp:read_url`・`read_pdf` の 3 件で、`example` は順に `{ url: "…/a.pdf", split_columns: 2 }`・`{ url: "…/b.pdf" }`・`{ url: "…/a.pdf" }` になる。

### SPEC-NTA-INSPECT-PDF-META-010 save: true で PDF を保存し、saved[] に絶対パスを返す

`save: true` のとき、`attachedPdfs` に入る各 PDF を国税庁サイトから取得して保存先に置き、`saved[]` を返す。`saved[]` の要素は `attachedPdfs` と同じ順で、`url`（`attachedPdfs[].url` と同じ値）・`path`（保存したファイルの絶対パス）・`bytes`（ファイルの大きさ）・`cached`（今回取得しなかったとき `true`）を持つ。保存先のパスは `<保存先>/<docType>/<docId>/<URL の最後のパス要素>`。`save` を渡さないときは `saved` を付けない。

例: `docType: "kaisei"`、`docId: "sample-003"`、URL が `https://…/a.pdf` の PDF は `<保存先>/kaisei/sample-003/a.pdf` に置かれ、`saved[]` に `{ url: "https://…/a.pdf", path: "<そのパス>", bytes: <大きさ>, cached: false }` が入る。

### SPEC-NTA-INSPECT-PDF-META-011 保存に失敗した PDF は saved[] に error 付きで残す

取得の応答が 2xx でない PDF は、`saved[]` から落とさず `path: null`・`bytes: null`・`cached: false`・`error`（例: `HTTP 404`）で残す。他の PDF の保存は続ける。1 件でも失敗があれば `note` に `<件数> 件の PDF を保存できませんでした（saved[].error を参照）。その PDF は URL のまま読んでください` と書く。失敗した PDF の `next_actions` は保存していないときと同じ（`pdf-reader-mcp:read_url`）になる。

### SPEC-NTA-INSPECT-PDF-META-012 保存した PDF の next_actions は file_path を渡す形にする

保存に成功した PDF の `next_actions` の 1 件は、`example` に `url` の代わりに `{ file_path: <saved[].path> }` を持つ。`action` は `read_strategy` が `tables` なら `pdf-reader-mcp:extract_tables`、`text` なら `pdf-reader-mcp:read_text`。汎用の `read_pdf` の `example` は `{ url, path }` になる。

例: `comparison`・`related`・`unknown`（取得に失敗）の 3 件を `save: true` で呼ぶと、`next_actions` の `action` は `pdf-reader-mcp:extract_tables`・`pdf-reader-mcp:read_text`・`pdf-reader-mcp:read_url`・`read_pdf` の 4 件になる。

### SPEC-NTA-INSPECT-PDF-META-013 保存済みの PDF は取りに行かない

同じ保存先のパスに既にファイルがあるときは、国税庁サイトに取りに行かず、そのファイルの `path` と `bytes` を `cached: true` で返す。

例: 同じ文書を `save: true` で 2 回呼ぶと、2 回目の `saved[]` は `cached: true` になり、取得の回数は増えない。

## できないこと

- PDF の本文を読むこと・要約すること（読むのは pdf-reader-mcp などの PDF 読み取りツール。このツールは一覧・種別・読み方・保存だけ）
- 質疑応答事例（qa-jirei）と基本通達の条項（`nta_get_tsutatsu` の対象）の PDF を扱うこと（`docType` に無い）
- ローカル DB に無い文書を国税庁サイトから取ること（先に `--bulk-download-<docType>` か `nta_get_*` で DB に入れる）
- 保存した PDF を更新すること・消すこと（同じパスにあれば常にそれを使う）
- 50MB を超える PDF を保存すること
- 種別や読み方を DB に書き戻すこと（応答のときに決めるだけ）

## 未決

初版起こしで見つけた、意図か不具合かを人が決める項目です。決まったら「できること」に ID を振るか、`specs/changes/` の差分にします。

意図か不具合かの判断が要る項目は houki-nta-mcp の Issue に移し、ここには題と Issue の番号だけを残します。今の振る舞いのままでよくテストが無いだけの項目は、受入テストを書いてから「できること」に ID を振ります。

1. **索引から消えた文書の印が付かない。** → houki-nta-mcp #71
2. **`legal_status` の docType 別の出し分け。** `kaisei` / `jimu-unei` は通達の位置付け（`binds_tax_office: true`）、`bunshokaitou` は文書回答事例の位置付け、`tax-answer` は解説資料の位置付けを返す。このツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
3. **`read_strategy` が `sample` の PDF を保存したときの `next_actions`** は `pdf-reader-mcp:summarize`（`example` は `{ file_path }`）になる。テストは `unknown` の PDF の保存に失敗する経路しか無い。ID を振るのは受入テストを書いてから。
4. **保存に失敗する条件のうち HTTP 404 以外**（応答が PDF でない: `Content-Type` が `application/pdf` でなく先頭が `%PDF-` でもない、50MB を超える、30 秒のタイムアウト、ネットワークの例外）は、`saved[].error` に理由を書いて残す。このツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
5. **`save: true` で絞った結果が 0 件のとき `saved` を付けない。** → houki-nta-mcp #71
6. **保存ファイル名は URL の最後のパス要素だけで決める。** → houki-nta-mcp #73
7. **DB の添付 PDF の記録が壊れている（JSON として読めない）文書**は、エラーにせず `attachedPdfs: []` で返す。テストが無い。ID を振るのは受入テストを書いてから。
8. **`docType` が 4 種以外、`kind` が 6 種以外、`save` が真偽値でない、未知の引数があるとき**は、tools/call の入力の検査でエラー `INVALID_ARGUMENT`（`tool: "nta_inspect_pdf_meta"`、`detail.issues` に引数名）になる。このツールとしてのテストが無い。ID を振るのは受入テストを書いてから。

# 機能: cli_refresh（取り込み済みの通達と文書の取り直し）

- 機能 ID: NTA
- 種類: CLI
- 版: current
- 承認日:
- 起こした元: v0.21.2 の `src/cli.ts`（`--refresh`・`--refresh-stale`・`--apply`）、`src/services/bulk-downloader.ts`（節ごとの条件付き取得）、`src/services/document-conditional-fetch.ts`、`src/services/nta-scraper.ts`（`If-Modified-Since` / `If-None-Match`）、`src/services/db-search.ts`（古い節の列挙）、`src/cli.test.ts`、`src/services/db-stale.test.ts`
- 関連する Issue: なし（v0.10.2 で `--refresh` が通達の投入に、v0.10.4 で文書系 5 種別の投入にも効くようになった）

この文書は「このコマンドは何をするか」を書きます。どう実装しているか（関数名・テーブル名）は書きません。投入そのもの（どの種別を何から取るか）は cli_bulk_download の spec.md に書きます。

## アクター

- 利用者（取り込み済みのローカル DB を持ち、国税庁サイトの改正に追随させたい人）。投入のフラグに `--refresh` を付けて全部取り直すか、`--refresh-stale=<日数>` で古い節を確かめてから `--apply` で取り直す

## 入力

| フラグ | 必須 | 内容 |
|---|---|---|
| `--refresh` | 任意 | `--quickstart` / `--bulk-download*` と組み合わせる。条件付き取得を使わず、対象をすべて国税庁サイトから取り直す |
| `--refresh-stale=<日数>` | どちらか 1 つ | 取得日時が `<日数>` 日より古い通達の節を列挙する（DB は変えない）。`<日数>` は 0 以上の整数 |
| `--apply` | 任意 | `--refresh-stale=<日数>` と組み合わせる。列挙した節を含む通達を取り直す |
| `--db-path=<path>` | 任意 | 対象の DB ファイル（cli_entry） |

## 処理の流れ

投入のフラグに `--refresh` を付けたときの各節・各文書の扱いと、`--refresh-stale` の流れを示します。図の中の番号は「できること」の仕様 ID の末尾 3 桁です。

```mermaid
flowchart TD
  subgraph 投入の 1 節・1 文書
    A["節・文書を取りに行く"] --> B{"--refresh があるか（001〜003）"}
    B -- ある --> F["条件を付けずに取得し、内容を入れ直す"]
    B -- ない --> C{"DB に前回の last_modified / etag があるか"}
    C -- ある --> D["If-Modified-Since / If-None-Match を付けて取得する（未決 1）"]
    C -- ない --> F
    D --> E{"応答"}
    E -- "304" --> G["fetched_at だけ更新する（未決 1）"]
    E -- "200 で内容が前回と同じ" --> H["fetched_at・last_modified・etag だけ更新する（未決 1）"]
    E -- "200 で内容が変わった" --> F
  end
  subgraph --refresh-stale
    R["--refresh-stale=<日数>"] --> S{"日数は 0 以上の整数か（006）"}
    S -- いいえ --> S2["指定しなかったものとして扱う（未決 4）"]
    S -- はい --> T["取得日時が日数より古い節を古い順に集める（004）"]
    T --> U{"--apply があるか（005）"}
    U -- ない --> V["一覧を JSON で標準出力に出して終わる（004）"]
    U -- ある --> W["その節を含む通達を、差分更新で取り直す（未決 3）"]
  end
```

## できること

### SPEC-NTA-CLI-REFRESH-001 `--refresh` を付けると、通達の投入は条件付き取得を使わずに全部取り直す

`--bulk-download --refresh` は、`--tsutatsu` の通達（既定: 消費税法基本通達）を、前回の `last_modified` / `etag` / `content_hash` を使わずに全節取り直して入れ直す。`--bulk-download-all --refresh` は 4 通達すべてにこれを行う。`--refresh` を付けないときは差分更新（SPEC-NTA-CLI-BULK-DOWNLOAD-002）である。

### SPEC-NTA-CLI-REFRESH-002 `--refresh` は文書系 5 種別の投入にも効く

`--bulk-download-bunshokaitou` / `--bulk-download-jimu-unei` / `--bulk-download-tax-answer` / `--bulk-download-qa` / `--bulk-download-kaisei` に `--refresh` を付けると、その種別の文書を条件付き取得を使わずに全部取り直す。付けないときは差分更新（SPEC-NTA-CLI-BULK-DOWNLOAD-003）である（v0.10.3 の文書回答事例で、解析を直しても 304 で入れ直されなかったことへの対応）。

### SPEC-NTA-CLI-REFRESH-003 `--bulk-download-everything --refresh` は 6 種別すべてを取り直す

`--bulk-download-everything --refresh` は、通達本体（4 通達）と文書系 5 種別のすべてを、条件付き取得を使わずに取り直す。

### SPEC-NTA-CLI-REFRESH-004 `--refresh-stale=<日数>` は、取得日時が日数より古い通達の節を古い順に列挙する

`--refresh-stale=<日数>` は、DB にある通達の節のうち、取得日時（`fetched_at`）が実行時点から `<日数>` 日より前のものを、取得日時の古い順に列挙する。各要素は `formalName`・`abbr`・`rootUrl`・`chapterNumber`・`sectionNumber`・`url`・`fetchedAt` を持つ。`--apply` を付けないときは DB を変えない（dry-run）。該当が無ければ空の配列である。

例: 節の取得日時が 60 日前・45 日前・10 日前・今日の 4 節がある DB で `--refresh-stale=30` を実行すると、60 日前と 45 日前の 2 節を、60 日前の節を先にして列挙する。

### SPEC-NTA-CLI-REFRESH-005 `--refresh-stale=<日数> --apply` で取り直しの実行になる

`--refresh-stale=<日数>` に `--apply` を付けると、列挙した節を含む通達を取り直す実行になる。`--apply` が無いときは列挙だけ（SPEC-NTA-CLI-REFRESH-004）である。

### SPEC-NTA-CLI-REFRESH-006 `--refresh-stale` の日数が 0 以上の整数でなければ、指定しなかったものとして扱う

`--refresh-stale=abc` や `--refresh-stale=-5` のように、値が数でないか負のときは、`--refresh-stale` を指定しなかったものとして扱う（列挙も取り直しもしない。その後どうなるかは未決 4）。

## できないこと

- 国税庁サイト側の更新日時だけを確かめて、DB を変えずに「更新があるか」を知ること（`--refresh-stale` は DB の取得日時で古さを見るだけで、国税庁サイトには行かない）
- 文書系 5 種別の古い文書を `--refresh-stale` で列挙・取り直しすること（通達の節だけ。文書系は投入のフラグを再実行する）
- 節を 1 つだけ取り直すこと（`--apply` は節を含む通達全体を取り直す）
- `--refresh-stale` を `--refresh` と組み合わせて、古い通達を条件付き取得なしで取り直すこと（未決 3）

## 未決

初版起こしで見つけた、意図か不具合かを人が決める項目です。決まったら「できること」に ID を振るか、`specs/changes/` の差分にします。

意図か不具合かの判断が要る項目は houki-nta-mcp の Issue に移し、ここには題と Issue の番号だけを残します。今の振る舞いのままでよくテストが無いだけの項目は、受入テストを書いてから「できること」に ID を振ります。

1. **差分更新の 3 つの経路。** `--refresh` を付けない投入は、DB に前回の `last_modified` / `etag` があれば `If-Modified-Since` / `If-None-Match` を付けて取得し、304 なら `fetched_at` だけを更新し、200 でも内容の SHA-1 が前回と同じなら `fetched_at`・`last_modified`・`etag` だけを更新し、変わっていれば入れ直す。結果の JSON にはその内訳（通達は `sectionsNotModified` / `sectionsContentSame` / `sectionsContentChanged`、文書系は `documentsNotModified` / `documentsContentSame` / `documentsContentChanged`）が入る。質疑応答事例とタックスアンサーは、DB の行が段落の構造（`structured_json`）を持たないときは条件を付けずに取り直す。テストは、ヘッダーを付ける・304 を受け取るという取得の単位（`src/services/nta-scraper.test.ts`）と、DB の読み書きの単位（`src/services/document-conditional-fetch.test.ts`）にしか無く、投入の結果として確かめたものが無い。ID を振るのは受入テストを書いてから。
2. **`--refresh` の説明が実際の動きと合わない。** 使い方の `--refresh` の説明は「既存 DB を消去して再 DL」だが、消すのは対象の通達の節と条項だけで、文書系 5 種別では行を消さずに取り直した内容で置き換える（索引から消えた文書の行は残る）。ほかの通達・ほかの種別の行には触れない。説明を直すか、DB を消す動きにするかは人が決める（案内と実際の動きの食い違いとして houki-nta-mcp #70 と同じ種類）。
3. **`--apply` の取り直しは差分更新で、`--refresh` を組み合わせても全部取り直しにならない。** `--refresh-stale=<日数> --apply` は、列挙した節を含む通達をすべて取り直すが、条件付き取得を使う差分更新なので、304 が返る節は `fetched_at` が更新されるだけで内容は入れ直されない（古い節を最新に確かめ直す目的には合う）。`--refresh` を同時に付けても、`--apply` の経路には渡らない。取り直した通達ごとの結果（`formalName`・`status`・`detail`）を JSON で標準出力に出す。テストが無い。`--refresh` を効かせるかは人が決める。
4. **日数が不正なときに MCP サーバーが起動する。** `--refresh-stale=abc` だけを渡すと、SPEC-NTA-CLI-REFRESH-006 で指定なしになり、ほかに処理を選ぶフラグが無いので MCP サーバーが起動して待ち続ける。cli_entry の未決 2 と同じ。
5. **`--refresh-stale` の表示。** 標準エラー出力に `[refresh-stale] DB: <DB の場所> (<日数> 日以上古い section を対象)`、`[refresh-stale] 該当: <件数> sections`、dry-run なら `[refresh-stale] dry-run（--apply で再 DL を実行）`、`--apply` なら `[refresh-stale] 再 DL 対象通達: <通達名を / で並べたもの>` を出す。テストが無い。ID を振るのは受入テストを書いてから。
6. **「N 日以上古い」と「N 日より古い」。** 使い方には「N 日以上古い section」とあるが、列挙するのは取得日時が実行時点の N 日前より前の節である（ちょうど N 日前の節は境界で、テストは 60 日前と 45 日前しか確かめていない）。表現を揃えるかは人が決める。

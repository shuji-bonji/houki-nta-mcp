# 差分: cli_refresh（20261003-db-cli）

`specs/current/cli_refresh/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える（見出しの行の題も置き換える）
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 冒頭の「関連する Issue」を `houki-nta-mcp #106（日数の検査）、#109（--refresh-stale --apply と --refresh の組み合わせ）。0.24.0` にする
- 「入力」の表の `--refresh` の行の内容の末尾に「。`--refresh-stale=<日数> --apply` とも組み合わせられる（SPEC-NTA-CLI-REFRESH-007）」を足す。`--refresh-stale=<日数>` の行の内容の末尾の「`<日数>` は 0 以上の整数」を「`<日数>` は 0 以上の整数（数字だけ。ほかは SPEC-NTA-CLI-REFRESH-006）」にする
- 「処理の流れ」の図の `subgraph --refresh-stale` から `end` までを次に置き換える（`subgraph 投入の 1 節・1 文書` は変えない）

```text
  subgraph --refresh-stale
    R["--refresh-stale=<日数>"] --> S{"日数は 0 以上の整数か（006）"}
    S -- いいえ --> S2["値のエラーを出して exit 2（006）"]
    S -- はい --> DB{"DB の状態（SPEC-NTA-DB-SCHEMA-021）"}
    DB -- "無い（--apply なし）" --> DB0["[] を出して exit 0"]
    DB -- "無い（--apply あり）・古く移行できない・新しい・読めない・開けない" --> DB1["exit 1"]
    DB -- "同じ・移行できる" --> T["取得日時が日数より古い節を古い順に集める（004）"]
    T --> U{"--apply があるか（005）"}
    U -- ない --> V["一覧を JSON で標準出力に出して終わる（004）"]
    U -- ある --> W{"--refresh があるか（007）"}
    W -- ない --> W1["その節を含む通達を差分更新で取り直す（005）"]
    W -- ある --> W2["その節を含む通達を、条件付き取得を使わずに取り直す（007）"]
  end
```

- 「できないこと」の「`--refresh-stale` を `--refresh` と組み合わせて、古い通達を条件付き取得なしで取り直すこと（未決 3）」を消す
- 「未決」の 3（→ #109）と 4（→ #106）の行を消す

## MODIFIED

### SPEC-NTA-CLI-REFRESH-005 `--refresh-stale=<日数> --apply` で、列挙した節を含む通達を差分更新で取り直す

`--refresh-stale=<日数>` に `--apply` を付けると、列挙した節（SPEC-NTA-CLI-REFRESH-004）を含む通達を、重複を除いて 1 つずつ取り直す。`--refresh` を付けないときは差分更新（前に取り込んだ節は条件付き取得で確かめ、304 の節は `fetched_at` だけを更新する。cli_refresh の未決 1）である。304 の節は次の `--refresh-stale=<日数>` では列挙されなくなる。取り直した通達ごとの結果（`formalName`・`status`・`detail`）を JSON で標準出力に出す。`--apply` が無いときは列挙だけ（SPEC-NTA-CLI-REFRESH-004）である。

### SPEC-NTA-CLI-REFRESH-006 `--refresh-stale` の日数が 0 以上の整数でなければ、何もせずに exit 2

`--refresh-stale=<日数>` の値が数字だけでできていない（`abc`・`-5`・`1.5`・`+5`・`90d` など）ときは、DB を開かず、国税庁サイトに接続せず、MCP サーバーも起動せずに、標準エラー出力に `[houki-nta-mcp] --refresh-stale="<値>" は使えません。0 以上の整数の日数を指定してください（例: --refresh-stale=90）` を出して終了コード 2 で終わる（SPEC-NTA-CLI-ENTRY-008 の値の誤り）。`0` は正しい値で、取得日時が実行時点より前の節をすべて列挙する。

例: `houki-nta-mcp --refresh-stale=abc` は上の文を出して終了コード 2（v0.23.x では `--refresh-stale` を指定しなかったものとして扱い、ほかに処理を選ぶフラグが無いので MCP サーバーとして起動した。#106）。

## ADDED

### SPEC-NTA-CLI-REFRESH-007 `--refresh-stale=<日数> --apply --refresh` は、列挙した節を含む通達を条件付き取得を使わずに取り直す

`--refresh-stale=<日数> --apply` に `--refresh` を付けると、列挙した節を含む通達を、`--bulk-download --tsutatsu=<その通達> --refresh`（SPEC-NTA-CLI-REFRESH-001）と同じく、前回の `last_modified` / `etag` / `content_hash` を使わずに全節取り直して入れ直す。列挙の規則（SPEC-NTA-CLI-REFRESH-004）と、取り直す通達の決め方（SPEC-NTA-CLI-REFRESH-005）は変わらない。`--apply` の無い `--refresh-stale=<日数> --refresh` は、SPEC-NTA-CLI-ENTRY-007 の余分な引数のエラーにする（列挙だけでは何も取らないので `--refresh` は効かない）。

例: 消費税法基本通達の節が 60 日前の取得で、国税庁サイトがその節に 304 を返す DB で `--refresh-stale=30 --apply --refresh` を実行すると、その節は 200 で取り直されて入れ直され、`fetched_at`・`last_modified`・`etag` が新しい値になる（v0.23.x では `--refresh` が `--apply` の取り直しに渡らず、304 で `fetched_at` だけが更新された。#109）。

# 差分: nta_get_qa（20261001-t1-argument-guards）

`specs/current/nta_get_qa/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `category` と `id` の行を「…。1 桁か 2 桁の半角の数字（SPEC-NTA-GET-QA-013）。空文字・空白だけは不可（002）」にする

## MODIFIED

### SPEC-NTA-GET-QA-002 category と id が空文字・空白だけのときは取りに行かない

`category` / `id` が空文字のときは、inputSchema の `minLength: 1` の検査（SPEC-NTA-COMMON-ERRORS-013）で止まり、`INVALID_ARGUMENT`（`tool: "nta_get_qa"`、`detail.issues[].path` はその引数名、`message: "空文字は指定できません"`）を返す。空白（半角スペース・全角スペース・タブ・改行）だけのときは、ツールの処理が DB と国税庁サイトを引く前に、SPEC-NTA-COMMON-ERRORS-014 の形の `INVALID_ARGUMENT`（`error: "<引数名> が空です"`、`detail.issues: [{ path: "<引数名>", message: "空白だけは指定できません" }]`、`hint` に税目の目次ページ（`/law/shitsugi/{topic}/01.htm`）でカテゴリ番号と事例番号を確かめるよう書く）を返す。

例: `{ topic: "shohi", category: "", id: "19" }` は `detail.issues` が `[{ path: "category", message: "空文字は指定できません" }]`。`{ topic: "shohi", category: "02", id: "  " }` は `error: "id が空です"`・`detail.issues[0].path: "id"`。どちらも `code: "INVALID_ARGUMENT"` で、DB も国税庁サイトも引かない。

## ADDED

### SPEC-NTA-GET-QA-013 category と id は 1 桁か 2 桁の半角の数字で、それ以外は取りに行かずに `INVALID_ARGUMENT` を返す

`category` と `id` の形は、前後の空白を除いて、半角の数字 1 桁か 2 桁である（SPEC-NTA-COMMON-ERRORS-015）。それ以外（英字を含む、3 桁以上、記号を含む）のときは、DB と国税庁サイトを引く前に `INVALID_ARGUMENT`（`tool: "nta_get_qa"`、`error: "<引数名> の形が受け付ける形ではありません: <渡した値>"`、`detail.issues: [{ path: "<引数名>", message: "1 桁か 2 桁の数字で指定してください" }]`、`hint` に `"02"`・`"19"` のような例）を返す。形が正しければ SPEC-NTA-GET-QA-003 のとおり 2 桁に揃えて引く。

例: `{ topic: "shohi", category: "02", id: "19" }` と `{ topic: "shohi", category: "2", id: "9" }` は検査を通る。`{ topic: "shohi", category: "1a", id: "19" }` は `detail.issues[0].path: "category"`、`{ topic: "shohi", category: "02", id: "190" }` は `detail.issues[0].path: "id"` で、どちらも `code: "INVALID_ARGUMENT"`、DB も国税庁サイトも引かない（v0.21.3 では引いてから `DOC_NOT_FOUND` か `SOURCE_API_ERROR` になっていた）。

# 差分: nta_get_tax_answer（20261001-t1-argument-guards）

`specs/current/nta_get_tax_answer/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `no` の行を「タックスアンサー番号。半角の数字 4 桁（001・012）。例: `"6101"`（消費税の基本的なしくみ）、`"1120"`（医療費控除）。先頭の桁で税目が決まる（下の表）」にする

## MODIFIED

### SPEC-NTA-GET-TAX-ANSWER-001 番号が空か数字でなければ取りに行かない

`no` が空文字のときは、inputSchema の `minLength: 1` の検査（SPEC-NTA-COMMON-ERRORS-013）で止まり、`INVALID_ARGUMENT`（`tool: "nta_get_tax_answer"`、`detail.issues: [{ path: "no", message: "空文字は指定できません" }]`）を返す。空白だけのときは、SPEC-NTA-COMMON-ERRORS-014 の形の `INVALID_ARGUMENT`（`error: "no が空です"`、`detail.issues: [{ path: "no", message: "空白だけは指定できません" }]`）を返す。前後の空白を除いた値が半角の数字以外の文字を含む（`"abc"`、`"61-01"` など）ときは、SPEC-NTA-COMMON-ERRORS-015 の形の `INVALID_ARGUMENT`（`error: "no の形が受け付ける形ではありません: <渡した値>"`、`detail.issues: [{ path: "no", message: "半角の数字 4 桁で指定してください" }]`、`hint` に `"6101"`・`"1120"` のような例）を返す。どれも DB も国税庁サイトも引かない。全角の数字（`"６１０１"`）を半角に揃えてから見るかどうかは、差分 `20261001-t3-normalize` で決める（この差分では今のまま、揃えずに数字以外として扱う）。

例: `no: ""` は `detail.issues[0].message: "空文字は指定できません"`。`no: " "` は `error: "no が空です"`。`no: "abc"` は `detail.issues[0].message: "半角の数字 4 桁で指定してください"`。どれも `code: "INVALID_ARGUMENT"`・`tool: "nta_get_tax_answer"`。

## ADDED

### SPEC-NTA-GET-TAX-ANSWER-012 番号は 4 桁で、桁数が違えば取りに行かずに `INVALID_ARGUMENT` を返す

`no` は、前後の空白を除いて半角の数字 4 桁である（SPEC-NTA-COMMON-ERRORS-015）。数字だけだが 4 桁でない（`"61"`、`"61011"`）ときは、先頭の桁で税目を決める（SPEC-NTA-GET-TAX-ANSWER-002・003）前に、`INVALID_ARGUMENT`（`tool: "nta_get_tax_answer"`、`error: "no の形が受け付ける形ではありません: <渡した値>"`、`detail.issues: [{ path: "no", message: "半角の数字 4 桁で指定してください" }]`、`hint` に `"6101"`・`"1120"` のような例）を返す。DB も国税庁サイトも引かない。

例: `no: "6101"` は検査を通る。`no: "61"` と `no: "61011"` は `code: "INVALID_ARGUMENT"`・`detail.issues[0].path: "no"` で、DB も国税庁サイトも引かない（v0.21.3 では先頭の桁で税目を決めて取りに行っていた）。`no: "8101"` は 4 桁なので検査を通り、SPEC-NTA-GET-TAX-ANSWER-002 の未対応の桁のエラーになる。

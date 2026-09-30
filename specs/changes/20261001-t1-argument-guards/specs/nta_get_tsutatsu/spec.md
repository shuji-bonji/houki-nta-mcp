# 差分: nta_get_tsutatsu（20261001-t1-argument-guards）

`specs/current/nta_get_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-GET-TSUTATSU-017 name が空文字・空白だけのときは略称辞書と DBを引かずに `INVALID_ARGUMENT` を返す

空文字は inputSchema の `minLength: 1` の検査（SPEC-NTA-COMMON-ERRORS-013）で止まり、`INVALID_ARGUMENT`（`tool: "nta_get_tsutatsu"`、`detail.issues: [{ path: "name", message: "空文字は指定できません" }]`）を返す。空白（半角スペース・全角スペース・タブ・改行）だけのときは、ツールの処理が略称辞書と DBを引く前に、SPEC-NTA-COMMON-ERRORS-014 の形の `INVALID_ARGUMENT`（`tool: "nta_get_tsutatsu"`、`error: "name が空です"`、`detail.issues: [{ path: "name", message: "空白だけは指定できません" }]`、`hint` に通達名（略称か正式名）を渡すよう書く）を返す。

例: `name: ""` は `code: "INVALID_ARGUMENT"`・`detail.issues[0].message: "空文字は指定できません"`。`name: "　"`（全角スペース）と `name: " \n"` は `code: "INVALID_ARGUMENT"`・`error: "name が空です"`。どれも略称辞書と DBは引かない。

`clause` は任意なので、空文字・空白だけの `clause` は今までどおり SPEC-NTA-GET-TSUTATSU-003（無いときと同じ）に従う。

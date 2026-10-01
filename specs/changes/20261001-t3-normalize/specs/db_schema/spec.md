# 差分: db_schema（20261001-t3-normalize）

`specs/current/db_schema/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える（表は変えない。本文の「版 10」を「版 11」にし、「v0.21.2 の」を「v0.22.0 の」にする）
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- SPEC-NTA-DB-SCHEMA-006・007・010〜014 の本文にある「最新の版」「`schema_version` を `10` にする」は、取り込みのときに `11` に読み替えて直す

## MODIFIED

### SPEC-NTA-DB-SCHEMA-001 DB を開くとテーブルを作り、スキーマの版 11 を記録する

新しい DB を開くと、次のテーブルを作り、`schema_meta` テーブルに `key = 'schema_version'`、`value = '11'` の行を記録する。v0.22.0 のスキーマの版は 11 である。既にテーブルのある DB を開いても、テーブルは残る。

（テーブルの表は current のまま）

## ADDED

### SPEC-NTA-DB-SCHEMA-019 版 10 の DB を開くと、ダッシュ類も揃えた形で clause・section・document の文字列を入れ直し、版 11 にする

`schema_version` が `10` の DB（ダッシュ類 `‐` `‑` `–` `—` `―` `−` を `-` にしない揃え方で入れた行がある）を開くと、国税庁サイトを取りに行かずに、DB の中の文字列を SPEC-NTA-SEARCH-RULES-007（houki-abbreviations 0.7.0 の `normalizeJpText`）の揃え方で入れ直し、`schema_version` を `11` にする。もう一度開いても何も変わらない。入れ直す列は版 4 → 5 のとき（SPEC-NTA-DB-SCHEMA-007）と同じである。

- `clause`: `clause_number`・`title`・`full_text`・`paragraphs_json` の各段落の `text`。例: `1―4―13の2` → `1-4-13の2`
- `section`: `title`
- `document`: `title`・`full_text`。例: `課消２―11` → `課消2-11`

版 4 以前の DB は、007 の入れ直しの後にこの入れ直しも通る（順に移行する。SPEC-NTA-DB-SCHEMA-006）。

例: `document.full_text` に `課消２―11` を含む版 10 の DB を開くと、`schema_version` は `11` になり、その行の `full_text` は `課消2-11` を含み、`document_fts MATCH '課消2-11'` で当たる。

### SPEC-NTA-DB-SCHEMA-020 版 10 から 11 の入れ直しでも、section の content_hash を未計算に戻し、document の content_hash は計算し直す

SPEC-NTA-DB-SCHEMA-019 の入れ直しで、`section.content_hash` は NULL（未計算）に戻し、`document.content_hash` は入れ直した `title`・`full_text` で SPEC-NTA-DB-SCHEMA-009 と同じ式で計算し直す。次の取り込みで、変わっていない文書が「更新された」と数えられないようにするためである。

例: 入れ直した `document` の行の `content_hash` は、`doc_type`・`doc_id`・入れ直した `title`・入れ直した `full_text` を改行で連結した SHA-1 になる。

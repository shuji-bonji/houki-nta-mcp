# 差分: nta_get_tsutatsu（20260927-get-responses）

`specs/current/nta_get_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-GET-TSUTATSU-016 本文に画像がある条項には、画像を読めない旨の注記を付ける

条項の本文に画像（算式などを GIF で載せた箇所）があるときは、DB から返したとき（SPEC-NTA-GET-TSUTATSU-004）も国税庁サイトから取ったとき（SPEC-NTA-GET-TSUTATSU-006）も、次の注記を付ける。画像が無い条項には付けない。

- 注記の文: `本文に画像が <箇所数> 箇所含まれています（算式などが GIF 画像で掲載されている箇所）。画像の内容は取得できないため、本文には alt テキストを [画像: …] として同じ位置に残しています（"<alt1>" / "<alt2>"）。算式の正確な内容は出典 URL の原ページで確認してください`。alt テキストが 1 つも無いときは `（"…"）` の部分を書かない
- `format` が `json` のとき: `content_notes` に、この注記 1 件の配列を入れる
- `format` を省くか `markdown` のとき: 本文の後、`出典:` の行の前に `> 注意: <注記>` の行を入れる

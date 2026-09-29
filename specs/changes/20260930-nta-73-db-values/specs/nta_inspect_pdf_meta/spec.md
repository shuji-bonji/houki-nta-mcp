# 差分: nta_inspect_pdf_meta（20260930-nta-73-db-values）

`specs/current/nta_inspect_pdf_meta/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の節（見出しから次の `###` または `##` の手前まで）を丸ごと置き換える
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- `## 入力` は、current の同じ見出しの節を丸ごと置き換える

## MODIFIED

### SPEC-NTA-INSPECT-PDF-META-010 save: true で PDF を保存し、saved[] に絶対パスを返す

`save: true` のとき、`attachedPdfs` に入る各 PDF を国税庁サイトから取得して保存先に置き、`saved[]` を返す。`saved[]` の要素は `attachedPdfs` と同じ順で、`url`（`attachedPdfs[].url` と同じ値）・`path`（保存したファイルの絶対パス）・`bytes`（ファイルの大きさ）・`cached`（今回取得しなかったとき `true`）を持つ。保存先のパスは `<保存先>/<docType>/<docId>/<ファイル名>`。ファイル名は、その文書の添付 PDF の中で URL の最後のパス要素が他と重ならなければ最後のパス要素（拡張子が無ければ `.pdf` を付ける）、重なるときは SPEC-NTA-INSPECT-PDF-META-018 のとおり前のパス要素を付けたもの。`save` を渡さないときは `saved` を付けない。

例: `docType: "kaisei"`、`docId: "sample-003"`、URL が `https://…/a.pdf` の PDF は `<保存先>/kaisei/sample-003/a.pdf` に置かれ、`saved[]` に `{ url: "https://…/a.pdf", path: "<そのパス>", bytes: <大きさ>, cached: false }` が入る。

## ADDED

### SPEC-NTA-INSPECT-PDF-META-018 同じ文書の中で最後のパス要素が同じ URL は、前のパス要素を付けて区別する

保存するファイル名は、その文書の添付 PDF 全体（`kind` で絞る前）の URL を並べて決める。URL の最後のパス要素が他の PDF と同じときは、その PDF どうしが区別できるようになるまで、直前のパス要素から順に `_` でつないで前に付ける。他と重ならない PDF のファイル名は最後のパス要素のまま（SPEC-NTA-INSPECT-PDF-META-010）。同じ URL は、`kind` で絞っても絞らなくても同じファイル名になる。区別した PDF はそれぞれ取得して別のファイルに置き、`saved[]` の `path` はその PDF 自身のファイルを指す。

例: 添付 PDF の URL が `https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/0026003-067/pdf/01.pdf` と `https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/0026003-068/pdf/01.pdf` と `https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/0026003-067/pdf/02.pdf` の文書を `save: true` で呼ぶと、ファイル名は順に `0026003-067_pdf_01.pdf`・`0026003-068_pdf_01.pdf`・`02.pdf` になる（`pdf_01.pdf` ではまだ重なるので、もう 1 つ前の要素を付ける）。3 件とも取得され、`cached` は `false`。`kind` で絞って 2 件目だけを保存する呼び出しでも、ファイル名は `0026003-068_pdf_01.pdf` のまま。

## 入力

| 引数      | 必須 | 内容                                                                                                                                                                                                |
| --------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docType` | 必須 | 文書種別。`kaisei`（改正通達）/ `jimu-unei`（事務運営指針）/ `bunshokaitou`（文書回答事例）/ `tax-answer`（タックスアンサー）のどれか。質疑応答事例（qa-jirei）は PDF を持たないので選べない        |
| `docId`   | 必須 | 文書 ID。`nta_search_*` の結果や `nta_get_*` の応答から得る                                                                                                                                         |
| `kind`    | 任意 | 返す PDF の種別を 1 つに絞る。`comparison`（新旧対照表）/ `attachment`（別紙・別表）/ `qa-pdf`（Q&A）/ `related`（参考資料）/ `notice`（通知・連絡）/ `unknown`（判定できなかったもの）。省くと全件 |
| `save`    | 任意 | `true` のとき、返す PDF をサーバー側の保存先に取得し、`saved[]` に絶対パスを返す。既定は `false`                                                                                                    |

保存先は、環境変数 `HOUKI_NTA_FILES_DIR` があればその下、無ければ `XDG_CACHE_HOME`（無ければ `~/.cache`）の下の `houki-nta-mcp/files/`。その中に `<docType>/<docId>/<ファイル名>` の形で置く。ファイル名は URL の最後のパス要素で、同じ文書の中で重なるときは前のパス要素を付けて区別する（SPEC-NTA-INSPECT-PDF-META-010・018）。

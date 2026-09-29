# 差分: nta_get_jimu_unei（20260930-nta-73-db-values）

`specs/current/nta_get_jimu_unei/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の節（見出しから次の `###` または `##` の手前まで）を丸ごと置き換える
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## MODIFIED

### SPEC-NTA-GET-JIMU-UNEI-007 添付 PDF の一覧を返す

json では `document.attachedPdfs` に、DB にある添付 PDF を入れる。要素は `title`・`url`・`sizeKb`・`kind`。`kind` は全要素に付く（DB に無ければ SPEC-NTA-GET-JIMU-UNEI-008 で題名から決める）。添付が無ければ空の配列。

markdown では、添付 PDF がある文書に限り、`## 本文` の後に `## 添付 PDF (<件数> 件)` の節を置く。節の中身は次のとおり。

- PDF の本文はこのサーバーが読まないことと、pdf-reader-mcp の `read_url` か、`nta_inspect_pdf_meta` を `save: true` で呼んで `extract_tables` に渡す読み方の案内（`>` の引用）
- 種別・タイトル・サイズ・読み方・URL の表（種別は SPEC-NTA-GET-JIMU-UNEI-008 で補った後のもの）。行は種別の順（新旧対照表・別紙・Q&A・参考資料・通知・その他）で、同じ種別の中は DB に入っている順
- `### 読み方` の節。表に現れた種別ごとに 1 行ずつ、その種別の PDF の読み方（`nta_inspect_pdf_meta` の `layout_note` と同じ文。SPEC-NTA-INSPECT-PDF-META-005）

## ADDED

### SPEC-NTA-GET-JIMU-UNEI-008 kind の無い添付 PDF は題名から kind を決めて返す

DB に入っている添付 PDF に `kind` が無い（v0.6.0 期に投入した文書）ときは、題名から `kind` を決めて応答に入れる。判定は `nta_inspect_pdf_meta` の SPEC-NTA-INSPECT-PDF-META-003 と同じ（「新旧対照表」「新旧対応表」「対比表」は `comparison`、「Q&A」「質疑応答」「FAQ」は `qa-pdf`、「別紙」「別表」「様式」「付録」「添付資料」は `attachment`、「通知」「お知らせ」「連絡」は `notice`、「参考」「参考資料」「関連資料」は `related`、どれにも当たらなければ `unknown`）。改正通達の「別紙 N」を `comparison` に付け替える扱い（SPEC-NTA-GET-KAISEI-TSUTATSU-007）は nta_get_jimu_unei では行わない（`docType` が `kaisei` でないため）。json の `document.attachedPdfs` の全要素に `kind` が付き、markdown の表と `### 読み方` では決めた種別の行になる（「その他」になるのは `unknown` のときだけ）。DB の内容は書き換えない。

例: `kind` の無い「参考資料」「別紙1」「Q&A」を持つ事務運営指針を `json` で取ると、`document.attachedPdfs` の `kind` は順に `related`・`attachment`・`qa-pdf`。markdown の表には「別紙」「Q&A」「参考資料」の行があり、「その他」の行は無い。同じ文書を `nta_inspect_pdf_meta` で見たときと `kind` が一致する。

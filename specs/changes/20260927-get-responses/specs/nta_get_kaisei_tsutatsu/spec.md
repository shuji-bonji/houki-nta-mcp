# 差分: nta_get_kaisei_tsutatsu（20260927-get-responses）

`specs/current/nta_get_kaisei_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-GET-KAISEI-TSUTATSU-005 markdown（既定）の応答

`format` を省くか `markdown` にしたとき、応答は次の順に並ぶ文字列である。種別の行（`- **種別**`）は無い。

- 見出し `# <題名>`
- `- **発出日**: <発出日>`（DB にあるときだけ）、`- **税目**: <税目>`（DB にあるときだけ）、`` - **docId**: `<docId>` ``、`- **出典**: <国税庁ページの URL>`、`- **取得**: <DB に入れた日時>` の行
- 国税庁の索引から消えた文書では、索引の状態の行と注記（SPEC-NTA-GET-KAISEI-TSUTATSU-004）
- 宛先・発出者が DB にある文書では `## 宛先・発出者` の節。各行を `> ` で引用する
- `## 本文` の節と本文
- 添付 PDF がある文書では `## 添付 PDF (<件数> 件)` の節（下のとおり。種別は SPEC-NTA-GET-KAISEI-TSUTATSU-007 で付け替えた後のもの）
- 最後に `---` と、`*通達は行政内部文書であり、納税者・裁判所への直接的拘束力なし（最高裁 昭和43.12.24）*` の注

添付 PDF がある文書では、`## 本文` の後に `## 添付 PDF (<件数> 件)` の節を置く。節の中身は次のとおり。

- PDF の本文はこのサーバーが読まないことと、pdf-reader-mcp の `read_url` か、`nta_inspect_pdf_meta` を `save: true` で呼んで `extract_tables` に渡す読み方の案内（`>` の引用）
- 種別・タイトル・サイズ・読み方・URL の表。行は種別の順（新旧対照表・別紙・Q&A・参考資料・通知・その他）で、同じ種別の中は DB に入っている順
- `### 読み方` の節。表に現れた種別ごとに 1 行ずつ、その種別の PDF の読み方（`nta_inspect_pdf_meta` の `layout_note` と同じ文。SPEC-NTA-INSPECT-PDF-META-005）

### SPEC-NTA-GET-KAISEI-TSUTATSU-006 json の応答

`format` を `json` にしたとき、応答は次のフィールドを持つ。

| フィールド | 内容 |
|---|---|
| `document.docType` | `kaisei` |
| `document.docId` / `document.taxonomy` / `document.title` | 文書 ID・税目・題名 |
| `document.issuedAt` / `document.issuer` | 発出日と宛先・発出者。DB にあるときだけ付く |
| `document.sourceUrl` / `document.fetchedAt` | 出典 URL と DB に入れた日時 |
| `document.fullText` | 本文 |
| `document.attachedPdfs` | 添付 PDF の配列。要素は `title`・`url`・`sizeKb`・`kind`（SPEC-NTA-GET-KAISEI-TSUTATSU-007 で付け替えた後のもの）。添付が無ければ空の配列 |
| `legal_status` | `binds_citizens: false` / `binds_courts: false` / `binds_tax_office: true` と注 |
| `source` | `db` |

### SPEC-NTA-GET-KAISEI-TSUTATSU-007 「別紙 N」とだけ題した添付 PDF は新旧対照表として返す

添付 PDF のうち、`kind` が `attachment` で題名が「別紙」と番号だけのもの（判定は SPEC-NTA-INSPECT-PDF-META-004 と同じ。「別紙1」「別紙1（PDF/221KB）」「（別紙2）」「別紙1-2」など）は、応答では `kind` を `comparison` にして返す。json の `document.attachedPdfs` と markdown の表・`### 読み方` の両方に当てはまる。「別紙1 計算明細書」のように別の語を含む題名は `attachment` のまま。DB の内容は書き換えない。

例: 「新旧対照表（PDF/100KB）」（`comparison`）と「別紙1（PDF/221KB）」（`attachment`）を持つ改正通達を `json` で取ると、`document.attachedPdfs` の 2 件目の `kind` は `comparison` になる。

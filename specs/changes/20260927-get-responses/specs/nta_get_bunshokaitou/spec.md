# 差分: nta_get_bunshokaitou（20260927-get-responses）

`specs/current/nta_get_bunshokaitou/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-GET-BUNSHOKAITOU-005 markdown（既定）の応答

`format` を省くか `markdown` にしたとき、応答は次の順に並ぶ文字列である。

- 見出し `# <題名>`
- `- **種別**: 文書回答事例`、`- **発出日**: <発出日>`（DB にあるときだけ）、`- **税目**: <税目>`（DB にあるときだけ）、`` - **docId**: `<docId>` ``、`- **出典**: <国税庁ページの URL>`、`- **取得**: <DB に入れた日時>` の行
- 国税庁の索引から消えた文書では、索引の状態の行と注記（SPEC-NTA-GET-BUNSHOKAITOU-004）
- 宛先・発出者が DB にある文書では `## 宛先・発出者` の節。各行を `> ` で引用する
- `## 本文` の節と本文
- 添付 PDF がある文書では `## 添付 PDF (<件数> 件)` の節（下のとおり）
- 最後に `---` と、`*文書回答事例は照会者・国税庁双方の合意に基づく個別事案回答であり、一般的な法的拘束力はない（実務判断は通達・法令本文に基づく必要あり）*` の注

添付 PDF がある文書では、`## 本文` の後に `## 添付 PDF (<件数> 件)` の節を置く。節の中身は次のとおり。

- PDF の本文はこのサーバーが読まないことと、pdf-reader-mcp の `read_url` か、`nta_inspect_pdf_meta` を `save: true` で呼んで `extract_tables` に渡す読み方の案内（`>` の引用）
- 種別・タイトル・サイズ・読み方・URL の表。行は種別の順（新旧対照表・別紙・Q&A・参考資料・通知・その他）で、同じ種別の中は DB に入っている順
- `### 読み方` の節。表に現れた種別ごとに 1 行ずつ、その種別の PDF の読み方（`nta_inspect_pdf_meta` の `layout_note` と同じ文。SPEC-NTA-INSPECT-PDF-META-005）

### SPEC-NTA-GET-BUNSHOKAITOU-006 json の応答

`format` を `json` にしたとき、応答は次のフィールドを持つ。

| フィールド | 内容 |
|---|---|
| `document.docType` | `bunshokaitou` |
| `document.docId` / `document.taxonomy` / `document.title` | 文書 ID・税目・題名 |
| `document.issuedAt` / `document.issuer` | 発出日と宛先・発出者。DB にあるときだけ付く |
| `document.sourceUrl` / `document.fetchedAt` | 出典 URL と DB に入れた日時 |
| `document.fullText` | 本文 |
| `document.attachedPdfs` | 添付 PDF の配列。要素は `title`・`url`・`sizeKb`・`kind`。添付が無ければ空の配列 |
| `legal_status` | `binds_citizens: false` / `binds_courts: false` / `binds_tax_office: false` と、個別事案への回答で一般的な法的拘束力はない旨の `note` |
| `source` | `db` |

### SPEC-NTA-GET-BUNSHOKAITOU-007 `available_doc_ids` は発出日の新しい順で、発出日の無い文書は後ろに置く

SPEC-NTA-GET-BUNSHOKAITOU-003 の `available_doc_ids` は、次の順で最大 30 件である。

- 発出日の新しい順
- 発出日の無い文書は、発出日のある文書の後ろ
- 発出日が同じなら `docId` の降順

例: 発出日が `2026-05-01` の `souzoku-X`、`2026-04-01` の `A`、発出日の無い `B` がある DB では、`available_doc_ids` の `docId` は `souzoku-X`・`A`・`B` の順になり、`B` の `issuedAt` は `null`。DB に 31 件以上あっても 30 件までしか入らない。

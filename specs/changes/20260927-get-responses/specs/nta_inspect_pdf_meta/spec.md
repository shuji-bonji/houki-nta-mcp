# 差分: nta_inspect_pdf_meta（20260927-get-responses）

`specs/current/nta_inspect_pdf_meta/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-INSPECT-PDF-META-014 保存した `unknown` の PDF の next_actions は、先に中身を確かめる形にする

保存に成功した PDF のうち `read_strategy` が `sample`（`kind` が `unknown`）のものは、`next_actions` の 1 件の `action` を `pdf-reader-mcp:summarize` にし、`example` を `{ file_path: <saved[].path> }` にする。SPEC-NTA-INSPECT-PDF-META-012 の `tables` / `text` と並ぶ 3 つ目の場合である。

### SPEC-NTA-INSPECT-PDF-META-015 取得の応答が PDF でない、大きすぎる、取得できないときも saved[] に error 付きで残す

SPEC-NTA-INSPECT-PDF-META-011 の HTTP の失敗のほかに、次の場合も PDF を保存せず、`saved[]` に `path: null`・`bytes: null`・`cached: false`・`error` で残す。`note` の件数（011）にも数える。

| 場合 | `error` |
|---|---|
| 応答の `Content-Type` が `application/pdf` でなく、本文の先頭も `%PDF-` でない | `PDF ではありません（Content-Type: <値>）`。`Content-Type` が無ければ `不明` |
| 本文が 50MB（52,428,800 バイト）を超える | `<バイト数> バイトあり、上限 52428800 バイトを超えています` |
| 30 秒で応答が終わらない、またはネットワークの例外 | 例外の文 |

`Content-Type` が `application/pdf` でなくても、本文の先頭が `%PDF-` なら保存する。

例: `Content-Type: text/html` の応答は `error: "PDF ではありません（Content-Type: text/html）"`、`Content-Type: application/octet-stream` で本文が `%PDF-1.4` で始まる応答は保存される。

### SPEC-NTA-INSPECT-PDF-META-016 legal_status は docType ごとの資料の位置付けを返す

応答の `legal_status` は `docType` で決まる。

| `docType` | `binds_citizens` | `binds_courts` | `binds_tax_office` | `note` の要点 |
|---|---|---|---|---|
| `kaisei` / `jimu-unei` | `false` | `false` | `true` | 通達は行政内部文書で納税者・裁判所を直接は拘束しないが、税務署員は職務として守る（最高裁 昭和43.12.24） |
| `bunshokaitou` | `false` | `false` | `false` | 個別事案への回答で一般的な法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある |
| `tax-answer` | `false` | `false` | `false` | 国税庁の参考解説資料で法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある |

### SPEC-NTA-INSPECT-PDF-META-017 DB の添付 PDF の記録が読めない文書は、PDF が無い文書として返す

DB にある文書の添付 PDF の記録が JSON として読めないときは、エラーにせず、添付 PDF が無い文書と同じ応答を返す。`attachedPdfs` は `[]` で、`next_actions` は付かない。`docType`・`docId`・`title`・`sourceUrl`・`legal_status` は付く。

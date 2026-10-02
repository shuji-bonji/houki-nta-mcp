# 差分: nta_inspect_pdf_meta（20261003-t4-response-shape）

`specs/current/nta_inspect_pdf_meta/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える

## MODIFIED

### SPEC-NTA-INSPECT-PDF-META-002 文書の添付 PDF の一覧を種別の順に返し、索引から消えた文書には印を付ける

文書がローカル DB にあるとき、応答は次のフィールドを持つ。

| フィールド            | 内容                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `docType` / `docId`   | 引数のとおり                                                                                               |
| `title` / `sourceUrl` | 文書の題名と、文書ページの URL                                                                             |
| `attachedPdfs`        | 添付 PDF の配列。要素は `title`・`url`・`sizeKb`（分かるときだけ）・`kind`・`read_strategy`・`layout_note` |
| `index_status` / `orphaned_at` / `notice` | 国税庁の索引から外れた文書（bulk download で外れたことを確認した日時が付いている文書）では、`index_status: "removed_from_index"`、`orphaned_at`（確認した日時）、`notice`（`nta_get_jimu_unei` の SPEC-NTA-GET-JIMU-UNEI-004 と同じ注記の文）。索引にある文書では、3 つとも `null` |
| `legal_status`        | 文書種別に応じた法的位置付け（`binds_citizens` / `binds_courts` / `binds_tax_office` と注）                |

`attachedPdfs` は `kind` の順に並べる。順は `comparison` → `attachment` → `qa-pdf` → `related` → `notice` → `unknown`。同じ `kind` の中では DB に入っている順のまま。

索引の印の形は、取得ツール（`nta_get_*` の json。SPEC-NTA-GET-JIMU-UNEI-004 など）と同じにする。PDF の URL は文書ページから外れていても残っていることがあるので、PDF を読む前に、文書そのものが索引から外れていることを知らせるためである。

例: 「別紙1 計算明細書」（`attachment`）と「新旧対照表」（`comparison`）がこの順で入っている改正通達では、応答の `attachedPdfs` は `comparison` の「新旧対照表」が先、`attachment` の「別紙1 計算明細書」が後になる。この改正通達が索引にあれば `index_status: null`・`orphaned_at: null`・`notice: null`、`2026-10-01T00:30:00Z` に索引から外れたことを確認していれば `index_status: "removed_from_index"`・`orphaned_at: "2026-10-01T00:30:00Z"` と注記の `notice`（v0.22.0 ではどちらの場合もこの 3 つのキーが無かった）。

### SPEC-NTA-INSPECT-PDF-META-010 save: true で PDF を保存し、saved[] に絶対パスを返す。保存する PDF が 0 件でも `saved: []` を返す

`save: true` のとき、`attachedPdfs` に入る各 PDF を国税庁サイトから取得して保存先に置き、`saved[]` を返す。`saved[]` の要素は `attachedPdfs` と同じ順で、`url`（`attachedPdfs[].url` と同じ値）・`path`（保存したファイルの絶対パス）・`bytes`（ファイルの大きさ）・`cached`（今回取得しなかったとき `true`）を持つ。保存先のパスは `<保存先>/<docType>/<docId>/<ファイル名>`。ファイル名は、その文書の添付 PDF の中で URL の最後のパス要素が他と重ならなければ最後のパス要素（拡張子が無ければ `.pdf` を付ける）、重なるときは SPEC-NTA-INSPECT-PDF-META-018 のとおり前のパス要素を付けたもの。

`save: true` で `attachedPdfs` が空のとき（文書に PDF が無い、`kind` で絞った結果が 0 件。SPEC-NTA-INSPECT-PDF-META-007）は、`saved: []` を返す。`save` を渡さないときは `saved` を付けない（保存を求めていない応答に保存の結果の欄を置かないため。proposal.md の「人が判断すること」を参照）。

例: `docType: "kaisei"`、`docId: "sample-003"`、URL が `https://…/a.pdf` の PDF は `<保存先>/kaisei/sample-003/a.pdf` に置かれ、`saved[]` に `{ url: "https://…/a.pdf", path: "<そのパス>", bytes: <大きさ>, cached: false }` が入る。`comparison` だけの文書に `{ kind: "qa-pdf", save: true }` を渡すと `attachedPdfs: []`・`saved: []`（v0.22.0 では `saved` のキーが無かった）。

# 差分: nta_get_bunshokaitou（20261004-db-location）

`specs/current/nta_get_bunshokaitou/spec.md` に対する差分です。

- `MODIFIED` は、見出しの行（題）も含めて、current の同じ ID の見出しと本文をこの差分の見出しと本文に置き換える
- 冒頭の「関連する Issue」の末尾に `、#138（DB の場所の見え方。0.25.0）` を足す

## MODIFIED

### SPEC-NTA-GET-BUNSHOKAITOU-002 DB に文書回答事例が 1 件も無いときは投入を案内する

ローカル DB に文書回答事例が 1 件も無い（DB が空、質疑応答事例など他の種別の文書しか入っていない、DB のファイルが無い・版の記録が無い・版が合わない）ときは、エラー `DOC_NOT_FOUND` を返す。この応答は次を持つ。

| フィールド | 内容 |
| --- | --- |
| `error` | `ローカル DB に文書回答事例が 1 件も無いため、docId="<渡した docId>" を取得できません` |
| `hint` | DB の状態ごとの文（SPEC-NTA-DB-SCHEMA-029。`<種別>` は `文書回答事例`、フラグは `--bulk-download-bunshokaitou`）。どの文も開こうとした DB のパスを含む |
| `next_actions` | 1 件。`action: "cli_bulk_download"`、`example.command` は `--bulk-download-bunshokaitou` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027）。版が新しい・読めない DB では入れない（SPEC-NTA-DB-SCHEMA-021） |
| `tool` | `nta_get_bunshokaitou` |

`available_doc_ids` は付けない（選ばせる文書が無い）。

例: 環境変数を付けずに起動し（ホームディレクトリが `/Users/bonji`）、改正通達だけを入れた DB で `{ docId: "shotoku/250416" }` を渡すと、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）に文書回答事例（doc_type="bunshokaitou"）が入っていません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-bunshokaitou` で投入してください。…`` で始まる（v0.24.x では `MCP サーバーが開いている DB（/Users/bonji/.cache/houki-nta-mcp/cache.db）に…` で始まり、コマンドは `houki-nta-mcp --bulk-download-bunshokaitou`）。

### SPEC-NTA-GET-BUNSHOKAITOU-003 文書はあるが docId が無いときは「見つかりません」と候補を返す

ローカル DB に文書回答事例はあるが、渡した `docId` の文書が無いときは、エラー `DOC_NOT_FOUND` を返す。「投入されていない」とは書かず、docId の誤りとして案内する。この応答は次を持つ。

| フィールド | 内容 |
| --- | --- |
| `error` | `文書回答事例 docId="<渡した docId>" は見つかりません` |
| `hint` | DB にある文書回答事例の件数（例: `DB の文書回答事例 1,841 件に、この docId はありません`）、`available_doc_ids` から選ぶか `nta_search_bunshokaitou` で探す案内、DB を投入した後に公開された文書は `` `<コマンド>` `` をもう一度実行すると取り込める旨。`<コマンド>` は `--bulk-download-bunshokaitou` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027） |
| `available_doc_ids` | DB にある文書回答事例の docId を発出日の新しい順に最大 30 件。要素は `docId`・`title`・`issuedAt`。他の種別（改正通達・質疑応答事例など）の docId は入らない |
| `next_actions` | 1 件。`{ action: "nta_search_bunshokaitou", reason: "キーワード検索で正しい docId を探せます" }` |
| `tool` | `nta_get_bunshokaitou` |

例: 環境変数を付けずに起動すると、`hint` の末尾は ``DB を投入した後に国税庁が公開した文書は、`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-bunshokaitou` をもう一度実行すると取り込めます``（v0.24.x では `houki-nta-mcp --bulk-download-bunshokaitou`）。

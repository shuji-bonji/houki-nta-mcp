# 機能: nta_get_bunshokaitou（文書回答事例を docId で 1 件取得する）

- 機能 ID: NTA
- 版: current
- 承認日:
- 起こした元: v0.21.0 の `src/tools/handlers.ts`（`handleNtaGetBunshokaitou`、`explainDocIdNotFound`、`renderDocumentMarkdown`）、`src/tools/definitions.ts`、`src/tools/tool-args.ts`、`src/services/db-search.ts`、`src/services/index-status.ts`、`src/services/pdf-meta.ts`、`src/constants.ts`、`src/errors.ts`、`src/tools/get-doc-not-found.test.ts`
- 関連する Issue: houki-nta-mcp #2（文書回答事例の `legal_status` の文言）、#23（文書系の bulk download の案内）、#30（索引から消えた文書の印）

この文書は「このツールは何をするか」を書きます。どう実装しているか（関数名・テーブル名）は書きません。

## アクター

- MCP クライアント（Claude などの LLM、または CLI から呼ぶ人）。`docId` を渡して、ローカル DB に入っている国税庁の文書回答事例 1 件の本文・発出日・添付 PDF の一覧を受け取る

## 入力

| 引数 | 必須 | 内容 |
|---|---|---|
| `docId` | 必須 | 文書 ID。本庁の事例は `税目/番号`（例: `shotoku/250416`）、国税局の事例は `局/税目/番号`（例: `tokyo/shotoku/260218`）。`nta_search_bunshokaitou` の結果の docId をそのまま渡す |
| `format` | 任意 | `markdown`（既定）または `json` |

`docId` を省く、文字列でない値を渡す、上の 2 つ以外の引数を渡す、のいずれもエラー `INVALID_ARGUMENT` になる（入力の検査はすべてのツールに共通で、このツールのテストは無い。未決 1）。

## できること

### SPEC-NTA-GET-BUNSHOKAITOU-001 ローカル DB にある文書はエラーにせず返す

`docId` の文書回答事例がローカル DB にある（`--bulk-download-bunshokaitou` で入れた）ときは、その内容を返す。応答に `code` は付かない。国税庁サイトには取りに行かない。

### SPEC-NTA-GET-BUNSHOKAITOU-002 DB に文書回答事例が 1 件も無いときは投入を案内する

ローカル DB に文書回答事例が 1 件も無い（DB が空、または質疑応答事例など他の種別の文書しか入っていない）ときは、エラー `DOC_NOT_FOUND` を返す。この応答は次を持つ。

| フィールド | 内容 |
|---|---|
| `error` | `ローカル DB に文書回答事例が 1 件も無いため、docId="<渡した docId>" を取得できません` |
| `hint` | MCP サーバーが開いている DB のパスと、`houki-nta-mcp --bulk-download-bunshokaitou` で投入する案内。投入したはずのときは環境変数 `HOUKI_NTA_DB_PATH` / `XDG_CACHE_HOME` が bulk download を実行した環境と同じかを確かめる案内 |
| `next_actions` | 1 件。`action: "cli_bulk_download"`、`example.command: "houki-nta-mcp --bulk-download-bunshokaitou"` |
| `tool` | `nta_get_bunshokaitou` |

`available_doc_ids` は付けない（選ばせる文書が無い）。

### SPEC-NTA-GET-BUNSHOKAITOU-003 文書はあるが docId が無いときは「見つかりません」と候補を返す

ローカル DB に文書回答事例はあるが、渡した `docId` の文書が無いときは、エラー `DOC_NOT_FOUND` を返す。「投入されていない」とは書かず、docId の誤りとして案内する。この応答は次を持つ。

| フィールド | 内容 |
|---|---|
| `error` | `文書回答事例 docId="<渡した docId>" は見つかりません` |
| `hint` | DB にある文書回答事例の件数（例: `DB の文書回答事例 1,841 件に、この docId はありません`）、`available_doc_ids` から選ぶか `nta_search_bunshokaitou` で探す案内、DB を投入した後に公開された文書は `houki-nta-mcp --bulk-download-bunshokaitou` をもう一度実行すると取り込める旨 |
| `available_doc_ids` | DB にある文書回答事例の docId を発出日の新しい順に最大 30 件。要素は `docId`・`title`・`issuedAt`。他の種別（改正通達・質疑応答事例など）の docId は入らない |
| `next_actions` | 1 件。`{ action: "nta_search_bunshokaitou", reason: "キーワード検索で正しい docId を探せます" }` |
| `tool` | `nta_get_bunshokaitou` |

## できないこと

- DB に無い文書を国税庁サイトから取ること（docId から個別ページの URL を組み立てるには税目フォルダの世代差を解く必要があるため。取り込むのは `--bulk-download-bunshokaitou`）。応答に `source: "live"` が現れることはない
- 題名やキーワードから文書を探すこと（探すのは `nta_search_bunshokaitou`）
- 添付 PDF の本文を読むこと（一覧と読み方を返すだけ。PDF の一覧だけが要るときは `nta_inspect_pdf_meta`）
- 本文を照会要旨・回答要旨などの節に分けて返すこと（本文は 1 続きの平文）
- 回答が今の法令・通達でも成り立つかを判定すること

## 未決

初版起こしで見つけた、意図か不具合かを人が決める項目です。決まったら「できること」に ID を振るか、`specs/changes/` の差分にします。

1. **`docId` の形を確かめない。** 必須で文字列であることは検査するが、空文字列や `税目/番号` の形でない値もそのまま DB に引きに行き、SPEC-NTA-GET-BUNSHOKAITOU-002 または 003 のエラーになる。形の検査を足すか。`INVALID_ARGUMENT` を返す入力の検査そのものも、このツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
2. **markdown（既定）の応答の形。** 見出し `# <題名>`、`- **種別**: 文書回答事例`・`- **発出日**`（あるときだけ）・`- **税目**`（あるときだけ）・`- **docId**`・`- **出典**`（国税庁ページの URL）・`- **取得**`（DB に入れた日時）の行、`## 宛先・発出者`（あるときだけ。引用の形）、`## 本文`、`## 添付 PDF (N 件)`（添付があるときだけ。種別・タイトル・サイズ・読み方・URL の表と、pdf-reader-mcp などで読む案内）、末尾の注（文書回答事例は個別事案への回答で一般的な法的拘束力はない旨）。このツールの応答としてのテストが無い（SPEC-NTA-GET-BUNSHOKAITOU-001 のテストは `code` が無いことしか見ない）。ID を振るのは受入テストを書いてから。
3. **json の応答の形。** `document`（`docType: "bunshokaitou"`・`docId`・`taxonomy`・`title`・`issuedAt`・`issuer`・`sourceUrl`・`fetchedAt`・`fullText`・`attachedPdfs`。`attachedPdfs` の要素は `title`・`url`・`sizeKb`・`kind`）、`legal_status`（`binds_citizens: false` / `binds_courts: false` / `binds_tax_office: false` と、個別事案への回答で一般的な法的拘束力はない旨の `note`）、`source: "db"`。`legal_status` の値の単体テスト（`src/constants.test.ts`）はあるが、このツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
4. **国税庁の索引から消えた文書の印。** DB から返した文書が索引から外れているとき、json では `index_status: "removed_from_index"`・`orphaned_at`・`notice`（過去の課税期間では意味を持つ場合があるが現在の取扱いは最新の通達で確かめる旨、出典 URL が 404 になることがある旨）が付き、markdown では `- **索引の状態**: removed_from_index（<確認日時> に確認）` の行と同じ注記の引用が付く。このツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
5. **`available_doc_ids` の並びと件数。** 発出日の新しい順（発出日の無い文書は後ろ）、同じ日付なら docId の降順、最大 30 件。テストは 1 件の DB でしか確かめていない（件数・順序の確認が無い）。ID を分けるか SPEC-NTA-GET-BUNSHOKAITOU-003 に含めるかを決めてから受入テストを書く。
6. **エラー `code` が 2 つの状況で同じ `DOC_NOT_FOUND`。** 「DB に 1 件も無い」（002）と「docId が無い」（003）を `code` では区別できず、`error` の文言・`available_doc_ids` の有無・`next_actions` の `action` で見分ける。`nta_search_bunshokaitou` の 0 件応答と同じ `code` でもある。v0.14.0 からの互換で `code` を変えない方針があるが、状況ごとに `code` を分けるかは意図として決める。

---
approved: 2026-10-09
pr: 157
implementation: none
targets: [db_schema, nta_inspect_pdf_meta]
---
# 変更: nta_inspect_pdf_meta の仕様から、inputSchema が受け付けない docType "qa-jirei" の行と例を外す（#156）

- 対象: `specs/current/nta_inspect_pdf_meta/spec.md` の SPEC-NTA-INSPECT-PDF-META-001（箇条書き 2 つと例）、`specs/current/db_schema/spec.md` の SPEC-NTA-DB-SCHEMA-029（ツールごとの表の `nta_inspect_pdf_meta` の行と、例の最後の箇条書き）
- 状態: 草案（`specs/current/` へはこの仕様 PR の中で反映する）
- 起こした日: 2026-10-09（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #156（nta_inspect_pdf_meta の inputSchema は docType: "qa-jirei" を受け付けないのに、仕様の表と例が qa-jirei を使っている）
- 決定の出典: #156 の「決めること」（仕様から qa-jirei の行と例を外すか）。この差分は外す案で起こし、承認を受ける（下の「人が判断すること」1）
- 前提: main `c5bbb43`（0.26.0 の取り込み済み）から切る

## なぜ変えるか

`tools/list` の応答で、`nta_inspect_pdf_meta` の `inputSchema.properties.docType.enum` は `kaisei`・`jimu-unei`・`bunshokaitou`・`tax-answer` の 4 つで、`description` は「質疑応答事例 (qa-jirei) は PDF を持たないため対象外」と書いている。MCP 経由で `docType: "qa-jirei"` を渡すと `INVALID_ARGUMENT`（`detail.issues[0].path` は `docType`）になる。これは受入テスト `src/tools/spec-20260927-argument-and-parse-errors.test.ts` の「SPEC-NTA-COMMON-ERRORS-003 nta_inspect_pdf_meta の応答: docType "qa-jirei"（enum に無い）は INVALID_ARGUMENT で path は docType」が確かめている。仕様の「入力」の表（`docType` の行）も「質疑応答事例（qa-jirei）は PDF を持たないので選べない」と書き、「できないこと」も qa-jirei の PDF を扱わないと書いている。

一方、次の文は `qa-jirei` を受け付ける前提で書かれている。利用者がこの文のとおりに呼ぶと、仕様が書く `DOC_NOT_FOUND` と `hint` ではなく `INVALID_ARGUMENT` が返る。

- SPEC-NTA-INSPECT-PDF-META-001 の箇条書き 2 つ（`qa-jirei` の種別とフラグ）と、例の後半（`{ docType: "qa-jirei", docId: "shohi/02/19" }`）
- SPEC-NTA-DB-SCHEMA-029 のツールごとの表の `nta_inspect_pdf_meta` の行（`qa-jirei` の種別とフラグ）と、例の最後の箇条書き（`nta_inspect_pdf_meta { docType: "qa-jirei", docId: "shohi/02/19" }`）

この差分は、これらの文を inputSchema の 4 つに合わせる。外した例の代わりには `tax-answer` の例を置く（値は下の「確かめた値」）。仕様 ID は足さず、変えない。

## 直す箇所

| #   | 場所                                                                                      | 今の文                                                                                                                                                                                                                                                                                                       | 直した後の文                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `nta_inspect_pdf_meta/spec.md` SPEC-NTA-INSPECT-PDF-META-001 の箇条書き 1 つ目            | SPEC-NTA-DB-SCHEMA-029 の表の文（`<種別>` と投入のフラグは `docType` で決める。`qa-jirei` は `質疑応答事例` と `--bulk-download-qa`）。                                                                                                                                                                      | SPEC-NTA-DB-SCHEMA-029 の表の文（`<種別>` と投入のフラグは `docType` で決める）。                                                                                                                                                                                                                                                                                       |
| 2   | 同 箇条書き 2 つ目の `<フラグ>` の列挙                                                    | …、`tax-answer` は `--bulk-download-tax-answer`、`qa-jirei` は `--bulk-download-qa`）。                                                                                                                                                                                                                      | …、`tax-answer` は `--bulk-download-tax-answer`）。                                                                                                                                                                                                                                                                                                                     |
| 3   | 同 例の後半                                                                               | 版 12 の DB に質疑応答事例 `shohi/02/19` が無いときに `{ docType: "qa-jirei", docId: "shohi/02/19" }` を渡すと、`hint` は `` `--bulk-download-qa` で投入済みか確認してください。docId が正しいかも `nta_search_*` で検証可能``（v0.24.x では `--bulk-download-qa-jirei` と書いていたが、このフラグは無い）。 | 版 12 の DB にタックスアンサー `6101` が無いときに `{ docType: "tax-answer", docId: "6101" }` を渡すと、`hint` は `` `--bulk-download-tax-answer` で投入済みか確認してください。docId が正しいかも `nta_search_*` で検証可能``。                                                                                                                                        |
| 4   | `db_schema/spec.md` SPEC-NTA-DB-SCHEMA-029 のツールごとの表の `nta_inspect_pdf_meta` の行 | `<種別>`: `docType` の種別（…、`tax-answer` はタックスアンサー、`qa-jirei` は質疑応答事例）。フラグ: `docType` の投入のフラグ（`qa-jirei` は `--bulk-download-qa`、ほかは `--bulk-download-<docType>`）                                                                                                      | `<種別>`: `docType` の種別（…、`tax-answer` はタックスアンサー）。フラグ: `docType` の投入のフラグ（`--bulk-download-<docType>`）                                                                                                                                                                                                                                       |
| 5   | 同 例の最後の箇条書き                                                                     | 質疑応答事例が 1 件も無い DB（版 12）で `nta_inspect_pdf_meta { docType: "qa-jirei", docId: "shohi/02/19" }` を呼ぶと、DB はあるので SPEC-NTA-INSPECT-PDF-META-001 の文。ファイルが無いときは ``…`--bulk-download-qa` で質疑応答事例を投入してください``                                                     | タックスアンサーが 1 件も無い DB（版 12）で `nta_inspect_pdf_meta { docType: "tax-answer", docId: "6101" }` を呼ぶと、DB はあるので SPEC-NTA-INSPECT-PDF-META-001 の文。ファイルが無いときは ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-tax-answer` でタックスアンサーを投入してください`` |

#3 で外す括弧書き「v0.24.x では `--bulk-download-qa-jirei` と書いていたが、このフラグは無い」は、MCP 経由では届かない呼び出しについての版の違いなので、代わりの文を置かない。`tax-answer` の `hint` は v0.24.x でも `--bulk-download-tax-answer` だった。

次の文は変えない。

- 「入力」の表の `docType` の行の「質疑応答事例（qa-jirei）は PDF を持たないので選べない」
- 「できないこと」の「質疑応答事例（qa-jirei）と基本通達の条項（`nta_get_tsutatsu` の対象）の PDF を扱うこと（`docType` に無い）」
- SPEC-NTA-INSPECT-PDF-META-001 の例の前半（`kaisei` の `0026003-067`）と、SPEC-NTA-DB-SCHEMA-029 のほかの行・例（`nta_search_qa` などの `qa-jirei` は、そのツールの種別なので正しい）
- 両ファイルの見出しの題と、ほかの仕様 ID の本文

## 変わる振る舞い

無い。MCP 経由の `nta_inspect_pdf_meta` は、今も `docType` を 4 つに限っている。

## 変わらない振る舞い

- `nta_inspect_pdf_meta` の `inputSchema`（`docType` の `enum` の 4 つと `description`）と、`qa-jirei` を渡したときの `INVALID_ARGUMENT`（SPEC-NTA-COMMON-ERRORS-003）
- SPEC-NTA-INSPECT-PDF-META-001 の `hint` の 2 つの文の形と、SPEC-NTA-DB-SCHEMA-029 の DB の状態ごとの文
- `nta_search_qa`・`nta_get_qa` の `--bulk-download-qa` と質疑応答事例の文
- 受入テストの期待値と、`spec-ids check` の結果

## 対象外

- テストと `src/`（下の「この差分の外で見つけたこと」1〜3）
- 0.26.0 の proposal.md（`specs/releases/v0.26.0/20261006-db-failure-paths/proposal.md`）。取り込み済みの記録なので書き換えない。その「publish の前の確認」5 は、`nta_inspect_pdf_meta`（`{"docType":"qa-jirei","docId":"shohi/02/19"}`）を MCP サーバーの stdio で呼んで、開けない DB の応答（`isError: true`、`hint` の先頭が `ローカル DB（/tmp/nta-026/…）を開けません。`、`retryable: false` など）を確かめると書いている。この引数は `inputSchema` の検査で止まり `INVALID_ARGUMENT` になるので、その確認のとおりの応答は返らない。0.26.0 の publish の前にこの確認をどう行ったか（引数を変えたか、`INVALID_ARGUMENT` を見て進めたか）は、この差分では確かめていない。次に同じ確認を書くときは `{"docType":"tax-answer","docId":"6101"}` などの 4 つの `docType` の例にする
- `specs/current/search_rules/spec.md` の文（下の「この差分の外で見つけたこと」4）

## 確かめた値

- `src/tools/definitions.ts` の `ntaInspectPdfMetaTool.inputSchema.properties.docType.enum` は `['kaisei', 'jimu-unei', 'bunshokaitou', 'tax-answer']`。`description` は「…質疑応答事例 (qa-jirei) は PDF を持たないため対象外」
- #3 の `hint`: `src/tools/handlers.ts` の `handleNtaInspectPdfMetaInner` は、DB にその文書が無いとき `` `${DOC_SEARCH_META[args.docType].flag}` で投入済みか確認してください。docId が正しいかも `nta_search_*` で検証可能`` を返す。`DOC_SEARCH_META['tax-answer'].flag` は `--bulk-download-tax-answer`。DB が使えるとき（ファイルがあり、版が合い、開ける）は、`explainDbState` はこの `hint` を変えない。`docType` によらない経路で、今の受入テスト（`spec-20261004-db-location.test.ts` の「SPEC-NTA-INSPECT-PDF-META-001 版 12 の DB に質疑応答事例 shohi/02/19 が無いときは…」）は同じ経路を `qa-jirei` で確かめている
- #5 のファイルが無いときの `hint`: 受入テスト `spec-20261004-db-location.test.ts` の「SPEC-NTA-DB-SCHEMA-029 nta_inspect_pdf_meta の docType="tax-answer": <種別> は タックスアンサー、フラグは --bulk-download-tax-answer」が、`{ docType: "tax-answer", docId: "6101" }` で ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-tax-answer` でタックスアンサーを投入してください`` を確かめている
- `6101` は、SPEC-NTA-DB-SCHEMA-030 の例（`nta_get_tax_answer { no: "6101" }`）と `specs/current/search_rules/spec.md` の `docId` の例（タックスアンサーは `6101`）でも使っている値

## 人が判断すること

1. **仕様を inputSchema に合わせる（qa-jirei の行と例を外す）こと。** #156 の「決めること」の案のとおり。もう 1 つの案は、`inputSchema` の `docType` の `enum` に `qa-jirei` を足して受け付けることで、その場合は仕様の文は今のままで、実装 PR（`inputSchema` の変更、`tools/list` の応答の変化）が要る。質疑応答事例は PDF を持たない（「入力」の表と「できないこと」）ので、受け付けても `attachedPdfs` は常に `[]` になり、利用者が得るものは無い。この差分は外す案で起こした
2. **外した例の代わりを `tax-answer` の `6101` にしたこと。** SPEC-NTA-INSPECT-PDF-META-001 の例の前半は `kaisei` の `0026003-067`（ファイルが無いとき）なので、後半（DB はあるが文書が無いとき）は別の `docType` にした。SPEC-NTA-DB-SCHEMA-029 の例も、受入テストが既に確かめている `tax-answer` の値にそろえた。`kaisei` にそろえるなら、#3 は `{ docType: "kaisei", docId: "0026003-067" }` で `--bulk-download-kaisei`、#5 は改正通達と `--bulk-download-kaisei` になる
3. **承認日。** この proposal.md の「承認日」に日付と PR 番号を書く。あわせて `specs/current/nta_inspect_pdf_meta/spec.md` と `specs/current/db_schema/spec.md` の承認日の行の末尾に「差分 `20261009-inspect-pdf-meta-qa-jirei` は YYYY-MM-DD（PR #N）」を書き足す（前例 `20261005-tax-answer-018-example` と同じ書き方）。次のコマンドで書き足せる

```sh
sed -i '' -E '/^- 承認日: /s/$/。差分 `20261009-inspect-pdf-meta-qa-jirei` は YYYY-MM-DD（PR #N）/' specs/current/nta_inspect_pdf_meta/spec.md specs/current/db_schema/spec.md
```

## この差分の外で見つけたこと

1. **受入テストが `qa-jirei` で `nta_inspect_pdf_meta` のハンドラーを直接呼んでいる。** 次の 3 か所は `handleNtaInspectPdfMeta({ docType: 'qa-jirei', docId: 'shohi/02/19' })` を呼ぶ。ハンドラーを直接呼ぶので `inputSchema` の検査を通らず、MCP 経由では返らない応答を確かめている。この差分の後は、テスト名の文（質疑応答事例と `--bulk-download-qa`）が仕様の文と合わない。テストの期待値は変わらず通るので、この差分では触らない。次の版の実装 PR（Test Designer）で `qa-jirei` の行を外すか、4 つの `docType` の値に置き換えるかを決める
   - `src/tools/spec-20261004-db-location.test.ts` の「SPEC-NTA-DB-SCHEMA-029 nta_inspect_pdf_meta: 質疑応答事例が 1 件も無い版 12 の DB では…」と、`inspectTypes` の `['qa-jirei', 'shohi/02/19', '質疑応答事例', '--bulk-download-qa']` の行
   - 同じファイルの「SPEC-NTA-INSPECT-PDF-META-001 版 12 の DB に質疑応答事例 shohi/02/19 が無いときは --bulk-download-qa…」
   - `src/tools/spec-20261006-db-failure-paths.test.ts` の開けない DB の表の `SPEC-NTA-INSPECT-PDF-META-001` の行

   `tsconfig.json` は `**/*.test.ts` を型検査から外しているので、`InspectPdfMetaArgs`（`docType` は 4 つの型）に無い `'qa-jirei'` を渡しても `tsc` は止めない

2. **`src/` の `qa-jirei` の扱い。** `nta_inspect_pdf_meta` に固有の `qa-jirei` の枝は無い。`DOC_SEARCH_META`（`src/tools/handlers.ts`）の `qa-jirei` の項は `nta_search_qa`・`nta_get_qa` と共有している。`LEGAL_STATUS_BY_DOCTYPE`（`src/constants.ts`）の `qa-jirei` の項は、使っている所が `nta_inspect_pdf_meta` の応答の `legal_status` だけなので、MCP 経由では届かない。`handleNtaInspectPdfMetaInner` の DOC_NOT_FOUND の箇所のコメント（「qa-jirei のフラグは --bulk-download-qa」）は、この差分の後は仕様に無い呼び出しを指す。届かない項とコメントを消すかは別に決める
3. **仕様の例と `tools/list` の `inputSchema` を突き合わせる確かめ方が無い。** 受入テストはハンドラーを直接呼ぶので、仕様の例の引数が `inputSchema` の検査を通るかは確かめていない。houki-hub#44（呼び出し例を同じ引数で流し、例と同じ応答が返るかを確かめるスクリプト）は `scripts/reference-examples/` の呼び出し例を MCP の stdio で流すので、そこに置いた例は `inputSchema` の検査を通る。ただし、対象は呼び出し例で、仕様（`specs/current/`）の例は含まない。仕様の例も確かめるなら、次のどちらかが考えられる。(a) 仕様の例の `{ … }` の引数を取り出し、`tools/list` の `inputSchema` で検査するスクリプトを houki-hub#44 に足す、(b) 受入テストの共通の呼び出しを、ハンドラーの直接呼び出しから `inputSchema` の検査を通す呼び出し（`spec-20260927-argument-and-parse-errors.test.ts` の `call`）に寄せる
4. **`specs/current/search_rules/spec.md` の `docId` の説明。** 検索結果の `docId` の行は「取得ツール（`nta_get_*`）や `nta_inspect_pdf_meta` にそのまま渡せる値。例: 質疑応答事例は `shohi/02/19`、タックスアンサーは `6101`」と書く。質疑応答事例の `docId` は `nta_get_qa` には渡せるが、`nta_inspect_pdf_meta` には渡せない（`docType` に `qa-jirei` が無い）。直すなら別の差分にする

## 取り込みのとき（Publisher）

- `specs/current/` へはこの仕様 PR の中で反映済み。次の版の実装 PR の最終コミットで、この差分のフォルダーを `specs/releases/<tag>/20261009-inspect-pdf-meta-qa-jirei/` へ移し、「状態」を「取り込み済み（`specs/current/` へは仕様 PR #N の中で反映。<tag> の実装 PR の最終コミットで `specs/releases/<tag>/` へ移した）」にする
- その実装 PR の本文に `Closes #156` を書く（前例: #146 は仕様 PR #148 に `Refs #146`、0.25.1 の実装 PR #151 に `Closes #146`）

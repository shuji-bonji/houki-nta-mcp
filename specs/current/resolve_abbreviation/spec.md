# 機能: resolve_abbreviation（略称・通称から辞書のエントリを 1 件解決する）

- 機能 ID: NTA
- 版: current
- 承認日:
- 起こした元: v0.21.0 の `src/tools/handlers.ts`（`handleResolveAbbreviation`）、`src/tools/definitions.ts`、`src/tools/tool-args.ts`、`src/tools/handlers.test.ts`、`src/server.test.ts`

この文書は「このツールは何をするか」を書きます。どう実装しているか（関数名・テーブル名）は書きません。

## アクター

- MCP クライアント（Claude などの LLM、または CLI から呼ぶ人）。`abbr` を渡して、その略称・通称が houki-abbreviations の辞書でどの法令・通達を指すか、そしてその本文を houki-nta-mcp で取れるか（管轄か）を受け取る

## 入力

| 引数 | 必須 | 内容 |
|---|---|---|
| `abbr` | 必須 | 略称・正式名称・別名（辞書の `aliases`）のどれか。例: `消基通` / `所基通` / `電帳法取通` / `消費税法基本通達`。前後の空白は無視する。完全一致で引く（部分一致はしない） |

`format` は無い。応答は常に JSON。

## できること

### SPEC-NTA-RESOLVE-ABBREVIATION-001 略称でも正式名称でも辞書のエントリを返す

`abbr` を houki-abbreviations の辞書で引き、見つかったエントリを応答の `resolved` に入れて返す。略称（`消基通`）でも正式名称（`消費税法基本通達`）でも同じエントリに解決される。応答の `abbr` には渡された値をそのまま返す。ローカル DB も国税庁サイトも引かない。

`resolved` は辞書のエントリそのままで、次のフィールドを持つ。

| フィールド | 内容 |
|---|---|
| `abbr` | 辞書に登録された略称。正式名称で引いたときもこれは略称（`消費税法基本通達` → `消基通`） |
| `formal` | 正式名称 |
| `law_id` | e-Gov の法令 ID。通達など e-Gov に無いものは `null` |
| `law_num` / `law_type` | 法令番号と法令種別。法令系のエントリにだけ付く |
| `domain` | 分野。例: `tax` |
| `category` | 種別。例: `kihon-tsutatsu`（基本通達）/ `kobetsu-tsutatsu`（個別通達）/ `law`（法律） |
| `source_mcp_hint` | 本文を持つ MCP の名前。例: `houki-nta` / `houki-egov` |
| `aliases` / `note` | 別名の一覧と備考。辞書にあるときだけ付く |

例: `abbr: "消基通"` の応答は `abbr: "消基通"`、`resolved.formal: "消費税法基本通達"`、`resolved.law_id: null`、`resolved.category: "kihon-tsutatsu"`、`resolved.source_mcp_hint: "houki-nta"`。

### SPEC-NTA-RESOLVE-ABBREVIATION-002 houki-nta の管轄のエントリには in_scope: true を返す

解決したエントリの `source_mcp_hint` が `houki-nta` のとき、応答に `in_scope: true` を付ける。`hint` は付けない。基本通達（`消基通` など）も個別通達（`電帳法取通` など）も同じ。

例: `abbr: "電帳法取通"` の応答は `resolved.category: "kobetsu-tsutatsu"`、`resolved.source_mcp_hint: "houki-nta"`、`in_scope: true` で、`hint` は無い。

### SPEC-NTA-RESOLVE-ABBREVIATION-003 管轄外のエントリには in_scope: false と誘導の hint を返す

解決したエントリの `source_mcp_hint` が `houki-nta` でないとき（法律・政令・省令など）は、`resolved` にエントリを入れたうえで `in_scope: false` を付け、`hint` に管轄先の MCP 名を書く。エラーにはしない。

例: `abbr: "消法"` の応答は `resolved.formal: "消費税法"`、`resolved.source_mcp_hint: "houki-egov"`、`in_scope: false`、`hint: "このエントリは houki-egov の管轄です。houki-egov-mcp で取得してください。"`。

### SPEC-NTA-RESOLVE-ABBREVIATION-004 辞書に無い名前には resolved: null を返す

`abbr` が辞書のどのエントリの略称・正式名称・別名とも一致しないときは、エラーにせず `resolved: null` と `note`（「辞書に該当なし。フル法令名でお試しください」）を返す。応答の `abbr` には渡された値をそのまま返す。`in_scope` と `hint` は付かない。

例: `abbr: "存在しない通達"` の応答は `{ abbr: "存在しない通達", resolved: null, note: "辞書に該当なし。フル法令名でお試しください" }`。

### SPEC-NTA-RESOLVE-ABBREVIATION-005 inputSchema に合わない引数は INVALID_ARGUMENT で止める

`abbr` が文字列でない、`abbr` が無い、inputSchema に無い引数がある、のいずれかのときは、辞書を引かずにエラー `INVALID_ARGUMENT` を返す（`isError: true`）。エラーには `tool: "resolve_abbreviation"`、`detail.issues`（各要素に `path` と `message`。`path` は引数名）、`hint`（tools/list の inputSchema を確かめる案内）、`next_actions`（`list_tools`）が付く。

例: `abbr: 123` を渡すと `code: "INVALID_ARGUMENT"`、`tool: "resolve_abbreviation"`、`detail.issues[0].path: "abbr"`。

## できないこと

- 部分一致やあいまい一致で探すこと（完全一致だけ。`消費税` のような通称は辞書の別名に登録されているときだけ引ける）
- 全角・半角の表記ゆれを吸収すること（`ＰＬ法` は辞書に無い扱いになる。未決 2）
- 解決した通達・法令の本文を返すこと（通達は `nta_get_tsutatsu`、法令は管轄先の MCP）
- 管轄外のエントリについて、管轄先の MCP の呼び出し方（`next_actions`）を返すこと（`hint` の文で MCP 名を案内するだけ）
- 1 回の呼び出しで複数の略称を解決すること
- 辞書に無い名前に対して、似た名前の候補を返すこと
- 辞書の版や更新日を返すこと

## 未決

初版起こしで見つけた、意図か不具合かを人が決める項目です。決まったら「できること」に ID を振るか、`specs/changes/` の差分にします。

1. **辞書に無い名前をエラーにしない。** このツールは `resolved: null` と `note` の通常応答（`code` 無し、`isError` 無し）を返すが、`nta_get_tsutatsu` は同じ状況でエラー `ABBREVIATION_NOT_FOUND` を返し、`next_actions` に `nta_search_tsutatsu` の案内を入れる。「辞書を引くだけのツールなので該当なしは正常」とみなして今の形を意図とするか、family の error contract に揃えるか。揃えるなら `specs/changes/` の差分になる。
2. **全角・半角の表記ゆれを吸収しない。** `ＰＬ法` や `消　法`（全角スペース）は辞書に無い扱いになる。辞書側には表記ゆれを吸収して引く選択肢があるが、このツールは使っていない。他のツールが `clause` の全角を半角に揃えている（`nta_get_tsutatsu`）のと比べて意図か。テストも無い。
3. **空文字・空白だけの `abbr`。** inputSchema は文字列であることしか確かめないので、`""` や `"  "` は SPEC-NTA-RESOLVE-ABBREVIATION-005 で止まらず、SPEC-NTA-RESOLVE-ABBREVIATION-004 の `resolved: null` になる。`INVALID_ARGUMENT` にするか。テストが無い。
4. **`hint` が案内する MCP 名。** `hint` は `${source_mcp_hint}-mcp` の形で組み立てるので、`houki-court` / `houki-saiketsu` / `houki-mhlw` / `houki-jaish` のエントリでは、まだ無い MCP 名（`houki-court-mcp` など）を案内する。また `nta_get_tsutatsu` の `OUT_OF_SCOPE` と違って `next_actions` を付けない。houki-egov 以外の管轄のエントリについてはテストも無い。ID を振るのは受入テストを書いてから。
5. **ツールの説明文の例。** tools/list の `abbr` の説明に例として `電帳法` を挙げているが、`電帳法` は法律（`houki-egov` の管轄）なので、このツールでは `in_scope: false` になる。管轄内の例（`電帳法取通`）に変えるか。
6. **別名（辞書の `aliases`）からの解決。** `電帳法取扱通達` や `消費税`（消費税法の別名）のように、辞書の `aliases` に登録された名前でも同じエントリに解決される。このツールの応答としてのテストが無い（略称と正式名称だけ）。ID を振るのは受入テストを書いてから。

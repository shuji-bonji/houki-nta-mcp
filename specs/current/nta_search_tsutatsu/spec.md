---
spec_id: NTA
approved: 2026-09-26
pr: 63
---
# 機能: nta_search_tsutatsu（基本通達の条項をキーワードで検索する）

- 版: current
- 起こした元: v0.21.0 の `src/tools/handlers.ts`（`searchTsutatsu`）、`src/tools/definitions.ts`、`src/tools/tool-args.ts`、`src/services/db-search.ts`、`src/services/relevance-scoring.ts`、`src/services/freshness.ts`、`src/constants.ts`、`src/errors.ts`、`src/tools/handlers.test.ts`、`src/server.test.ts`
- 関連する Issue: houki-nta-mcp #18（2 文字の語の補完）、#20（通達の応答に base_laws）、#21（通称の展開を 0 件のときだけにする）、#138（DB の場所の見え方。0.25.0）、#144（DB を開けないときの応答。0.26.0）

この文書は「このツールは何をするか」を書きます。どう実装しているか（関数名・テーブル名）は書きません。

## アクター

- MCP クライアント（Claude などの LLM、または CLI から呼ぶ人）。`keyword` を渡して、ローカル DB に入っている基本通達 4 種（消費税法基本通達・所得税基本通達・法人税基本通達・相続税法基本通達）の条項から、キーワードに合う条項の一覧を受け取る

## 入力

| 引数      | 必須 | 内容                                                                                                                                                                                                                                                          |
| --------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keyword` | 必須 | 検索キーワード。例: `"軽減税率"`、`"電子帳簿"`、`"棚卸資産"`。空白で区切ると全部の語を含む条項を探す。3 文字以上の語を推奨する。2 文字の語は本文の部分一致で補い、その旨を応答の `search_notes` に書く。略称・通称（`"消基通"`、`"インボイス"` など）も渡せる。空文字・空白だけは不可 |
| `limit`   | 任意 | 取得件数。既定 10。1 以上 50 以下の整数 |

検索の対象はローカル DB だけである。国税庁サイトには取りに行かない。DB に条項を入れるのは CLI の `--bulk-download`（通達 1 つ）または `--bulk-download-all`（基本通達 4 種）である。

## 処理の流れ

呼び出しを受けてから応答を返すまでに、何をどの順で確かめるかを示します。図の中の番号は「できること」の仕様 ID の末尾 3 桁です。

```mermaid
flowchart TD
  A["呼び出し（keyword・limit）"] --> B{"引数が inputSchema に合うか"}
  B -- いいえ --> E1["INVALID_ARGUMENT を返す（001）"]
  B -- はい --> C{"keyword が空白だけか（空文字は inputSchema の検査で止まる）"}
  C -- はい --> E2["INVALID_ARGUMENT を返す（002）"]
  C -- いいえ --> D{"ローカル DB に基本通達の条項があるか"}
  D -- 無い --> E3["TSUTATSU_NOT_FOUND と --bulk-download-all の案内を返す（003）"]
  D -- ある --> F{"2 文字の語を含むか"}
  F -- はい --> G["2 文字の語は本文と題名の部分一致で補い、search_notes に書く（006）"]
  F -- いいえ --> H["全部の語を含む条項を全文検索で探す（004）"]
  G --> I{"元の語で 0 件で、keyword が辞書の通称か"}
  H --> I
  I -- はい --> J["正式名を含む条項に広げて探し直し、search_notes に書く（008）"]
  I -- いいえ --> K{"合う条項があるか"}
  J --> K
  K -- ある --> L["keyword・count・hits・freshness・legal_status の応答（004・010）"]
  L --> M["通達ごとの base_laws_by_tsutatsu と next_actions を付ける（009）"]
  K -- 無い --> N["keyword・count: 0・hits: []・message・freshness・legal_status を返す。エラーにしない（005・010）"]
  M --> O["語が全部 3 文字以上で通称の展開も無ければ search_notes を付けない（007）"]
  N --> O
```

## できること

### SPEC-NTA-SEARCH-TSUTATSU-001 inputSchema に合わない引数では検索しない

`keyword` が無い、`inputSchema` に無い引数（`domain`、`type` など）がある、型が合わない、`limit` が 1 以上 50 以下の整数でない（SPEC-NTA-SEARCH-TSUTATSU-011）、`keyword` が空文字（SPEC-NTA-SEARCH-TSUTATSU-002）、のどれかのときは、エラー `INVALID_ARGUMENT` を返す。DB は引かない。応答には `tool: "nta_search_tsutatsu"`、`hint`（`tools/list` の inputSchema を確かめる案内）、`next_actions`（`action: "list_tools"`）、`detail.issues`（違反 1 件ごとの要素。各要素は `path`（引数名）と `message`（日本語の 1 文。SPEC-NTA-COMMON-ERRORS-011））が入る。

例: `{ keyword: "軽減税率", domain: "tax" }` → `code: "INVALID_ARGUMENT"`、`detail.issues[0].path` は `"domain"`。`{}` → `detail.issues` は `[{ path: "keyword", message: "必須の引数です" }]`。

### SPEC-NTA-SEARCH-TSUTATSU-002 keyword が空なら検索しない

`keyword` が空文字のときは、inputSchema の `minLength: 1` の検査（SPEC-NTA-COMMON-ERRORS-013）で止まり、`INVALID_ARGUMENT`（`tool: "nta_search_tsutatsu"`、`detail.issues: [{ path: "keyword", message: "空文字は指定できません" }]`）を返す。空白（半角スペース・全角スペース・タブ・改行）だけのときは、ツールの処理が DB を引く前に、SPEC-NTA-COMMON-ERRORS-014 の形の `INVALID_ARGUMENT`（`tool: "nta_search_tsutatsu"`、`error: "keyword が空です"`、`detail.issues: [{ path: "keyword", message: "空白だけは指定できません" }]`、`hint` に探したい語を渡すよう書く、`next_actions` に `list_tools`）を返す。どちらも DB は引かない。

例: `keyword: ""` は `detail.issues[0].message: "空文字は指定できません"`。`keyword: "   "` は `error: "keyword が空です"`・`detail.issues[0].path: "keyword"`。どちらも `code: "INVALID_ARGUMENT"`・`tool: "nta_search_tsutatsu"`（v0.21.3 は `error` の文だけで `detail.issues` が無かった）。

### SPEC-NTA-SEARCH-TSUTATSU-003 DB に条項が 1 件も無いときは、開こうとした DB のパスと、基本通達 4 種の bulk download を案内する

ローカル DB に基本通達の条項が 1 件も入っていないときは、エラー `TSUTATSU_NOT_FOUND`（`error` は「ローカル DB に検索対象がありません」）を返す。`next_actions` に `action: "cli_bulk_download"`（`example.command` は `--bulk-download-all` を付けた案内のコマンド。SPEC-NTA-DB-SCHEMA-027）を入れる。版が新しい・読めない DB と、開けない DB では入れない（SPEC-NTA-DB-SCHEMA-021・029）。開けない DB では `retryable: false` と `detail.cause` も付ける（SPEC-NTA-DB-SCHEMA-029。v0.25.x では SPEC-NTA-COMMON-ERRORS-006 の `INTERNAL_ERROR` だった）。

`hint` は DB の状態で決める（SPEC-NTA-DB-SCHEMA-029）。DB のファイルが無い・版の記録が無い・版が合わない・開けないときは 029 の表の文。DB は使えるが条項が 1 件も無いときは次の文にする。`<パス>` は開こうとした DB のパス（SPEC-NTA-DB-SCHEMA-028 の形）、`<--bulk-download-all のコマンド>` と `<--bulk-download のコマンド>` は案内のコマンド（027。後者は `--bulk-download --tsutatsu=<正式名>`）。

```
ローカル DB（<パス>）に基本通達の条項が入っていません。`<--bulk-download-all のコマンド>` を実行して、基本通達 4 種を投入してください。1 つの通達だけを先に入れるときは `<--bulk-download のコマンド>` でも投入できます
```

このツールは基本通達 4 種をまとめて検索し、ツールの説明文と `freshness.warning`（SPEC-NTA-SEARCH-RULES-017）は `--bulk-download-all` を案内している。DB が空のときの案内も同じフラグにする。

例: 環境変数を付けずに起動した MCP サーバー（ホームディレクトリが `/Users/bonji`）で、条項の無い版 12 の DB に `{ keyword: "役員" }` を渡すと、`code: "TSUTATSU_NOT_FOUND"`、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）に基本通達の条項が入っていません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-all` を実行して、基本通達 4 種を投入してください。1 つの通達だけを先に入れるときは `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download --tsutatsu=<正式名>` でも投入できます``、`next_actions[0].example.command` は `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-all`（v0.24.x では `hint` が ``初回は `houki-nta-mcp --bulk-download-all` を実行して…`` で DB のパスを含まず、`example.command` は `houki-nta-mcp --bulk-download-all`。v0.22.0 では `--bulk-download` で、既定では消費税法基本通達 1 つだけが入っていた）。DB のファイルが無いときは `hint` が ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-all` で基本通達を投入してください``。DB のファイルがフォルダーのときは、`hint` が ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）を開けません。`` で始まり、`retryable: false`、`next_actions` は無い。

### SPEC-NTA-SEARCH-TSUTATSU-004 キーワードに合う条項があれば count と hits を返す

キーワードに合う条項があるときは、次のフィールドを持つ応答を返す。

| フィールド | 内容 |
| --- | --- |
| `keyword` | 渡されたキーワード（前後の空白を除いたもの） |
| `count` | `hits` の件数 |
| `hits` | 条項の配列。要素は `tsutatsu`（正式名。例 `"法人税基本通達"`）・`abbr`（略称。例 `"法基通"`）・`clauseNumber`（例 `"9-2-1"`）・`title`・`snippet`（一致した語を `<b>…</b>` で囲んだ前後の抜粋）・`sourceUrl`・`score`（0.0〜1.5 の関連度）・`scoreReasons`（関連度の理由の文の配列） |
| `freshness` | DB に入れた日時の範囲と鮮度（`oldest_fetched_at` / `newest_fetched_at` / `staleness` / `days_since_oldest`。古いときは `warning`）と、引いた DB のパス `db_path`。基本通達 4 種をまとめて判定する。判定できる節が無いときも付け、取得日時の 4 つを `null` にする（SPEC-NTA-SEARCH-RULES-017・022） |
| `legal_status` | `binds_citizens: false` / `binds_courts: false` / `binds_tax_office: true` と注（通達は行政内部文書で、納税者・裁判所を直接拘束しない） |
| `base_laws_by_tsutatsu` / `next_actions` | SPEC-NTA-SEARCH-TSUTATSU-009 |
| `search_notes` | SPEC-NTA-SEARCH-TSUTATSU-006・008。注記が無ければ付かない |

複数の語を空白で区切って渡したときは、全部の語を含む条項だけを返す。

例: `{ keyword: "役員" }` で DB に「役員の範囲」の条項 9-2-1 があれば、`count` は 1、`hits[0].clauseNumber` は `"9-2-1"`、`hits[0].snippet` は `<b>役員</b>` を含み、環境変数を付けずに起動していれば `freshness.db_path` は `"~/.cache/houki-nta-mcp/cache.db"`（ホームディレクトリの下のとき。v0.24.x では `db_path` が無く、判定できる節が無いときは `freshness` のキーも無かった）。

### SPEC-NTA-SEARCH-TSUTATSU-005 キーワードに合う条項が無いときはエラーにせず、`count: 0` と `freshness`・`legal_status` を返す

DB に条項はあるがキーワードに合うものが無いときは、エラーにせず次を返す。

- `keyword`: 渡されたキーワード（前後の空白を除いたもの。SPEC-NTA-SEARCH-TSUTATSU-004 と同じ）
- `count`: `0`
- `hits`: `[]`
- `message`: `"<keyword>" にマッチする clause はありません`
- `freshness`: SPEC-NTA-SEARCH-TSUTATSU-004 と同じ範囲（DB にある通達の節すべて）で判定したもの
- `legal_status`: SPEC-NTA-SEARCH-TSUTATSU-010 と同じもの
- `search_notes`: 注記があるときだけ（SPEC-NTA-SEARCH-TSUTATSU-006・008）

`base_laws_by_tsutatsu` と `next_actions` は付けない（`hits` に現れた通達から作るもので、`hits` が空なら作れない。SPEC-NTA-SEARCH-TSUTATSU-009）。

例: 条項が 1 件以上ある DB で `{ keyword: "存在しない語句" }` を渡すと、`count: 0`、`hits: []`、`message` は `"存在しない語句" にマッチする clause はありません`、`freshness.staleness` と `legal_status.binds_tax_office: true` を持つ（v0.22.0 では `count`・`freshness`・`legal_status` が無かった）。

### SPEC-NTA-SEARCH-TSUTATSU-006 2 文字の語は本文の部分一致で補い、search_notes で知らせる

全文検索の索引には 3 文字以上の語しか乗らない。2 文字の語が含まれるときは、次のように補い、応答の `search_notes` にその旨の文を入れる。ヒットしたときも 0 件のときも入れる。

- 2 文字の語だけのとき: 本文と題名の部分一致で探す。`search_notes` の文は「3 文字未満のため FTS5 (trigram) では検索できません。代わりに本文とタイトルの部分一致 (LIKE) で検索しました」と、語を続けて 3 文字以上にして再検索する推奨を含む
- 2 文字の語と 3 文字以上の語が混ざるとき: 3 文字以上の語で全文検索したうえで、本文か題名に 2 文字の語を含むものに絞る。`search_notes` の文はその旨を含む

例: `{ keyword: "社宅" }` で合う条項が無いときは `hits: []`、`message` は「社宅」を含み、`search_notes[0]` は「3 文字未満」を含む。

### SPEC-NTA-SEARCH-TSUTATSU-007 3 文字以上の語だけなら search_notes を付けない

キーワードの語が全部 3 文字以上で、通称の展開（SPEC-NTA-SEARCH-TSUTATSU-008）も起きなかったときは、応答に `search_notes` を付けない。

例: `{ keyword: "経営に従事" }` → `count: 1`、`search_notes` は無い。

### SPEC-NTA-SEARCH-TSUTATSU-008 通称は、元の語で 0 件のときだけ法令名に広げ、search_notes で知らせる

`keyword` が houki-abbreviations の辞書に通称（`aliases`。例 `"インボイス"` → 消費税法）として登録されているときは、まず元の語だけで検索する。

- 元の語で 1 件以上あれば、広げずにその結果を返す。`search_notes` は付けない
- 元の語で 0 件なら、辞書の正式名（法令名）を含む条項に広げて検索し直す。広げて見つかったときは `search_notes` に「"<元の語>" を含む文書は見つかりませんでした。略称辞書で "<元の語>" は <正式名> の通称として登録されているため、"<正式名>" を含む文書に広げて検索しました。"<正式名>" という語が出てくるだけの文書も含まれます」の文を入れる

例: DB に「適格請求書発行事業者登録簿…」の条項 1-7-2 と「…（消費税法の小規模事業者に係る納税義務の免除）」の条項 1-4-1 があるとき、`{ keyword: "適格請求書発行事業者" }` は 1-7-2 だけを返して `search_notes` は無く、`{ keyword: "インボイス" }` は 1-4-1 を返して `search_notes[0]` に「"消費税法" を含む文書に広げて検索しました」を含む。

### SPEC-NTA-SEARCH-TSUTATSU-009 結果に現れた通達ごとに、解釈の対象になる法律と get_law への案内を付ける

`hits` に現れた通達について、応答に 1 回だけ次を付ける。`hits` の要素には付けない（法律との対応は通達単位の事実であり、条項単位ではないため）。

- `base_laws_by_tsutatsu`: 通達の正式名 → 解釈の対象になる法律・政令・省令の配列（法律 → 施行令 → 施行規則の順）。同じ通達は 1 回だけ、`hits` の出現順
- `next_actions`: 通達ごとに 1 件。`action: "delegate_to_mcp"`、`example` は `{ mcp: "houki-egov", tool: "get_law", law_name: <配列の先頭の法律名> }`

`hits` が空のときは、どちらも付けない。

例: 法人税基本通達 2 件と消費税法基本通達 1 件が当たったとき、`base_laws_by_tsutatsu` は `{ 法人税基本通達: ["法人税法", "法人税法施行令", "法人税法施行規則"], 消費税法基本通達: ["消費税法", "消費税法施行令", "消費税法施行規則"] }`、`next_actions` は `law_name` が `"法人税法"` と `"消費税法"` の 2 件。

### SPEC-NTA-SEARCH-TSUTATSU-010 `legal_status` は、ヒットの有無によらず付ける

DB に条項があり検索をしたときは、キーワードに合う条項があるとき（SPEC-NTA-SEARCH-TSUTATSU-004）も無いとき（SPEC-NTA-SEARCH-TSUTATSU-005）も、応答に `legal_status`（`binds_citizens: false` / `binds_courts: false` / `binds_tax_office: true` と、通達は行政内部文書で納税者・裁判所を直接は拘束しないが税務署員は職務として守る旨の `note`）を付ける。文書系 5 ツールが 0 件のときも `legal_status` を付けるのと同じにする。エラー（SPEC-NTA-SEARCH-TSUTATSU-001〜003）には付けない。

例: `{ keyword: "役員" }` で 1 件当たったときも、`{ keyword: "存在しない語句" }` で 0 件のときも、`legal_status.binds_tax_office` は `true`（v0.22.0 では 0 件のときに `legal_status` が無かった）。

### SPEC-NTA-SEARCH-TSUTATSU-011 `limit` は 1 以上 50 以下の整数で、範囲の外は `INVALID_ARGUMENT` にして丸めない

tools/list の inputSchema の `limit` は `type: "integer"`、`minimum: 1`、`maximum: 50` を持つ（SPEC-NTA-COMMON-ERRORS-012）。0・負の数・小数・51 以上・数値でない値を渡すと、inputSchema の検査で `INVALID_ARGUMENT`（`tool: "nta_search_tsutatsu"`、`detail.issues[0].path: "limit"`）を返し、DB を引かない。1 件や 50 件に丸めたり、切り捨てたりしない。既定の 10 件は変えない。

例: `{ keyword: "軽減税率", limit: 0 }` は `code: "INVALID_ARGUMENT"`、`detail.issues` は `[{ path: "limit", message: "1 以上で指定してください" }]` で、DB は引かない（v0.21.3 では 1 件に丸めていた）。`limit: 100` は `[{ path: "limit", message: "50 以下で指定してください" }]`（v0.21.3 では 50 件）。`limit: 2.5` と `limit: "10"` は `整数で指定してください`。`limit: 50` は検査を通り、最大 50 件を返す。

## できないこと

- 国税庁サイトを検索すること（対象はローカル DB に入れた条項だけ。DB に入れるのは CLI の `--bulk-download` / `--bulk-download-all`）
- 通達を 1 つに絞って検索すること（`keyword` に通達名を入れても、通達名を本文に含む条項を探すだけで、絞り込みにはならない）
- 基本通達 4 種以外の文書を検索すること（改正通達は `nta_search_kaisei_tsutatsu`、質疑応答事例は `nta_search_qa`、タックスアンサーは `nta_search_tax_answer`、事務運営指針は `nta_search_jimu_unei`、文書回答事例は `nta_search_bunshokaitou`）
- 条項の本文全体を返すこと（`snippet` は抜粋。本文は `nta_get_tsutatsu` で `clauseNumber` を渡して取る）
- 通達の条項と法律の条番号の対応を示すこと（`base_laws_by_tsutatsu` は法令名まで。条は付けない）
- 通達が今も有効かどうかを判定すること（改正の追跡は `nta_search_kaisei_tsutatsu` / `nta_get_kaisei_tsutatsu`）

## 未決

初版起こしで見つけた、意図か不具合かを人が決める項目です。決まったら「できること」に ID を振るか、`specs/changes/` の差分にします。

意図か不具合かの判断が要る項目は houki-nta-mcp の Issue に移し、ここには題と Issue の番号だけを残します。今の振る舞いのままでよくテストが無いだけの項目は、受入テストを書いてから「できること」に ID を振ります。

8. **`TSUTATSU_NOT_FOUND` の案内するフラグ。** → SPEC-NTA-SEARCH-TSUTATSU-003

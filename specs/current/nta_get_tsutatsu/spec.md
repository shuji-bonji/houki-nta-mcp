# 機能: nta_get_tsutatsu（基本通達の条項を 1 つ取得する）

- 機能 ID: NTA
- 版: current
- 承認日: 2026-09-22（初版。PR #49 のマージ）。差分 `20260924-tsutatsu-clause-forms` は 2026-09-24（PR #53 のマージ）
- 起こした元: v0.20.2 の `src/tools/handlers.ts`（`getTsutatsu`）、`src/tools/definitions.ts`、`src/tools/handlers.test.ts`
- 関連する判断: houki-hub `docs/DECISIONS.md`（2026-09-21 の行）
- 取り込んだ差分: `specs/releases/v0.20.3/20260924-tsutatsu-clause-forms/`（入力の `clause`。2026-09-24 JST）

この文書は「このツールは何をするか」を書きます。どう実装しているか（関数名・テーブル名）は書きません。

## アクター

- MCP クライアント（Claude などの LLM、または CLI から呼ぶ人）。`name` と `clause` を渡して、基本通達の条項 1 つの本文を受け取る

## 入力

| 引数 | 必須 | 内容 |
|---|---|---|
| `name` | 必須 | 通達名。略称（`消基通` / `所基通` / `法基通` / `相基通`）でも正式名（`消費税法基本通達` など）でもよい |
| `clause` | 実質必須（スキーマ上は任意） | 通達番号。形は通達ごとに違う（下の表）。DB から返すとき（SPEC-NTA-GET-TSUTATSU-004）は全角の数字・ハイフンでもよい |
| `format` | 任意 | `markdown`（既定）または `json` |

| 通達 | `clause` の形 | 例 |
|---|---|---|
| 消費税法基本通達 | 章-節-条 | `5-1-9` / `1-4-13の2` |
| 法人税基本通達 | 章-節-条（節に枝番号が付くことがある） | `1-1-1` / `1-3の2-1` |
| 所得税基本通達 | 条-項。複数の条に共通する通達は `条~条共-項` | `34-1` / `2-4の2` / `23~35共-6` |
| 相続税法基本通達 | 条-項。複数の条に共通する通達は `条・条共-項` | `3-1` / `1の3・1の4共-1` |

国税庁サイトから取るとき（SPEC-NTA-GET-TSUTATSU-006）に受け付けるのは「章-節-条」の形だけである（SPEC-NTA-GET-TSUTATSU-008）。

## できること

### SPEC-NTA-GET-TSUTATSU-001 通達名を略称辞書で解決する

`name` を houki-abbreviations の辞書で正式名に解決する。略称でも正式名でも同じ通達に解決される。辞書に無い名前のときは、エラー `ABBREVIATION_NOT_FOUND` を返し、`next_actions` に `nta_search_tsutatsu` で探す案内を入れる。

### SPEC-NTA-GET-TSUTATSU-002 houki-nta の管轄でない名前は取りに行かない

辞書にはあるが管轄が houki-nta でない名前（例: `消法` は houki-egov の管轄）のときは、エラー `OUT_OF_SCOPE` を返す。`hint` に管轄先の MCP 名を書き、`next_actions` にその MCP への案内を入れる。

### SPEC-NTA-GET-TSUTATSU-003 clause が無ければ何も取りに行かない

`clause` が無いときは、エラー `INVALID_ARGUMENT` を返す。`hint` に `5-1-9` のような書き方の例を入れる。

### SPEC-NTA-GET-TSUTATSU-004 ローカル DB にある条項は DB から返す

その通達と条項がローカル DB にあるときは、国税庁サイトに取りに行かずに DB の内容を返す。応答の `source` は `db`、`fetchedAt` は DB に入れたときの日時のまま（呼び出した時刻にしない）。`clause` の全角ハイフン・全角数字は半角に揃えてから DB を引く。

### SPEC-NTA-GET-TSUTATSU-005 DB に通達はあるが条項が無いときは、番号の候補を返す

その通達は DB にあるが指定の条項が無いときは、エラー `ARTICLE_NOT_FOUND` を返し、`available_clauses` にその通達の条項番号（最大 50 件）を入れる。この場合は国税庁サイトには取りに行かない。

### SPEC-NTA-GET-TSUTATSU-006 DB に無い基本通達 4 種は国税庁サイトから取る

通達が DB に無く、かつ次の 4 通達のどれかであれば、国税庁サイトの該当ページを取得して条項を返す。応答の `source` は `live`。

- 消費税法基本通達
- 所得税基本通達
- 法人税基本通達
- 相続税法基本通達

### SPEC-NTA-GET-TSUTATSU-007 DB に無く、ライブ取得にも対応していない通達は投入を案内する

通達が DB に無く、上の 4 通達でもないとき（例: `電帳法取通`）は、エラー `TSUTATSU_NOT_FOUND` を返す。`hint` に `--bulk-download` の実行を案内し、`supported_for_live` にライブ取得できる通達名の一覧、`next_actions` に bulk download の案内を入れる。

### SPEC-NTA-GET-TSUTATSU-008 ライブ取得では clause の形を「章-節-条」に限る

ライブ取得に進んだとき、`clause` が `章-節-条`（条は `13の2` のような枝番号を含んでよい）の形でなければ、エラー `INVALID_ARGUMENT` を返す。`hint` に、条-項の体系の通達は `--bulk-download` で DB に入れるよう書く。

### SPEC-NTA-GET-TSUTATSU-009 国税庁サイトから取れなかったときは再試行できるエラーにする

ページの取得に失敗したとき（404 など）は、エラー `SOURCE_API_ERROR` を返す。`retryable` は `true`、`detail.status` に HTTP ステータス、`next_actions` に時間をおいて再試行する案内を入れる。

### SPEC-NTA-GET-TSUTATSU-010 取得したページに条項が無いときは、ページ内の番号を返す

ページは取れたが指定の条項が無いときは、エラー `ARTICLE_NOT_FOUND` を返し、`available_clauses` にそのページにある条項番号をすべて入れる。

### SPEC-NTA-GET-TSUTATSU-011 markdown（既定）の応答

`format` を省くか `markdown` にしたとき、応答は次を含む文字列である。

- 見出し `## <条項番号>（<表題>）`
- 本文（段落のインデントは引用記号 `>` の深さで表す）
- `出典: <国税庁ページの URL>` と `取得: <取得日時>`
- 解釈の対象になる法律の行（SPEC-NTA-GET-TSUTATSU-013）
- 通達の法的位置付けの注（通達は行政内部文書で納税者・裁判所に直接の拘束力がないこと）

### SPEC-NTA-GET-TSUTATSU-012 json の応答

`format` を `json` にしたとき、応答は次のフィールドを持つ。

| フィールド | 内容 |
|---|---|
| `tsutatsu` | 正式名 |
| `clause.clauseNumber` / `clause.title` / `clause.paragraphs` / `clause.fullText` | 条項番号・表題・段落・本文 |
| `sourceUrl` / `fetchedAt` | 出典 URL と取得日時 |
| `source` | `db` または `live` |
| `legal_status` | `binds_citizens: false` / `binds_courts: false` / `binds_tax_office: true` と注 |

### SPEC-NTA-GET-TSUTATSU-013 解釈の対象になる法律と、その本文を読む案内を付ける

基本通達 4 種の応答には `base_laws`（法律 → 施行令 → 施行規則の順の正式名）を付け、`next_actions` に houki-egov-mcp の `get_law` で先頭の法律を読む案内を 1 件入れる。markdown では「解釈の対象になる法律: …」の行で示す。対応表に無い通達では付けない。

## できないこと

- 通達の条項と法律の条番号の対応を示すこと（`base_laws` は法令名まで。条は付けない）
- 条項本文の中の画像（算式の GIF）の内容を返すこと（alt テキストを `[画像: …]` として残す）
- ライブ取得で、章-節-条の体系でない通達（電帳法取通など）を取ること
- 通達が今も有効かどうかを判定すること（改正の追跡は `nta_search_kaisei_tsutatsu` / `nta_get_kaisei_tsutatsu`）

## 未決

初版起こしで見つけた、意図か不具合かを人が決める項目です。決まったら「できること」に ID を振るか、`specs/changes/` の差分にします。

1. **ライブ取得経路では `clause` の全角を半角に揃えない。** DB 経路（SPEC-NTA-GET-TSUTATSU-004）は揃えるが、ライブ経路の形式判定（SPEC-NTA-GET-TSUTATSU-008）とページ内の照合（SPEC-NTA-GET-TSUTATSU-010）は入力をそのまま使う。同じ `１－４－１` が、DB にあれば取れて、無ければ `INVALID_ARGUMENT` になる。不具合として扱うなら最初の差分案にする。
2. **ライブ取得した節の条項を DB に書き戻す動き**（次回から SPEC-NTA-GET-TSUTATSU-004 で返る）は、書き戻し自体のテスト（`src/services/db-writeback.test.ts`）はあるが、このツールの応答として「2 回目は取りに行かない」ことのテストが無い。ID を振るのは受入テストを書いてから。
3. **ページの解析に失敗したときの `INTERNAL_ERROR`**（国税庁ページの構造変更を疑う `hint` 付き）はテストが無い。ID を振るのは受入テストを書いてから。
4. **本文に画像があるときの `content_notes`**（json）と `> 注意:` の行（markdown）は、解析側のテストはあるがこのツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
5. **`available_clauses` の件数**が DB 経路（SPEC-NTA-GET-TSUTATSU-005）は最大 50 件、ライブ経路（SPEC-NTA-GET-TSUTATSU-010）はページ内の全件で違う。意図として認めるか、揃えるか。

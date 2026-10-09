---
spec_id: NTA
kind: common
approved: 2026-09-27
pr: 78
---
# 機能: search_rules（検索系ツールに共通するキーワードの扱いと結果の付記）

- 版: current
- 起こした元: v0.21.0 の `src/services/db-search.ts`、`src/services/text-normalize.ts`、`src/services/freshness.ts`、`src/services/index-status.ts`、`src/services/relevance-scoring.ts`、`src/tools/handlers.ts`（検索系 6 ツールのハンドラー）、各種別の取り込み処理（`src/services/*-bulk-downloader.ts`・`src/services/*-parser.ts`・`src/services/document-writeback.ts`）、`src/services/db-search.test.ts`、`src/services/text-normalize.test.ts`、`src/services/relevance-scoring.test.ts`、`src/services/index-status.test.ts`、`src/services/db-writeback.test.ts`、`src/services/kaisei-parser.test.ts`、`src/tools/handlers.test.ts`、`src/tools/index-status-response.test.ts`
- 関連する Issue: houki-nta-mcp #14（通称の展開）、#18（短い語の扱い）、#21（通称の展開を 0 件のときだけにする）、#27（全角英字の揃え方）、#30（索引から消えた文書の印）、#68（limit の丸め）、#69（空のキーワード）、#71（応答の形の不揃い）、#80（3 文字未満の略称）、#81（英字の大文字と小文字）、#139（freshness の範囲と索引から消えた文書）、#138（freshness.db_path。0.25.0）、#156（nta_inspect_pdf_meta に渡せる docId の種別。0.27.0）

この文書は、複数の検索ツールに共通するキーワードの扱いと、検索結果に付ける情報を書きます。どう実装しているか（関数名・テーブル名）は書きません。各ツール固有の引数・0 件のときの応答（`DOC_NOT_FOUND`・`available_taxonomies` など）は各ツールの spec.md に書きます。

## アクター

- MCP クライアント（Claude などの LLM、または CLI から呼ぶ人）。検索系ツールに `keyword` を渡し、キーワードに合う条項・文書の一覧と、検索のしかたについての注記（`search_notes`）・関連度（`score` / `scoreReasons`）・DB の取得時点と DB のパス（`freshness`）・索引の状態（`index_status`）を受け取る
- CLI の bulk download（`--bulk-download` など）。国税庁サイトから取った文字列を、検索のときと同じ揃え方で DB に入れる

## 対象

| ツール                       | 当てはまる場面                                                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nta_search_tsutatsu`        | 基本通達の条項の検索。キーワードの扱い・全角の揃え方・略称と通称の展開・関連度と並び順・`freshness` が当てはまる。条項番号の一致による加点はこのツールだけ。索引から消えた文書の印は当てはまらない（条項には印を持たない） |
| `nta_search_qa`              | 質疑応答事例の検索。索引から消えた文書の印を含め、条項番号の一致による加点以外のすべてが当てはまる                                                                                                                         |
| `nta_search_tax_answer`      | タックスアンサーの検索。`nta_search_qa` と同じ                                                                                                                                                                             |
| `nta_search_bunshokaitou`    | 文書回答事例の検索。`nta_search_qa` と同じ                                                                                                                                                                                 |
| `nta_search_jimu_unei`       | 事務運営指針の検索。`nta_search_qa` と同じ                                                                                                                                                                                 |
| `nta_search_kaisei_tsutatsu` | 改正通達の検索。`nta_search_qa` と同じ                                                                                                                                                                                     |

ツールによって応答の形が違う点（`nta_search_tsutatsu` は `hits`・`count`・0 件のときの `message`、文書系 5 ツールは `results`）がある。統一するかは → houki-nta-mcp #71

## 処理の流れ

検索系ツールが `keyword` を受けてから結果を返すまでに、共通の決まりをどの順で当てるかを示します。図の中の番号は「できること」の仕様 ID の末尾 3 桁です。各ツール固有の確かめ（DB が空か、税目の範囲など）は省きます。

```mermaid
flowchart TD
  A["keyword を受ける"] --> B["全角の数字・英字・記号・空白を揃え、英字を小文字にする（008）"]
  B --> C["空白で語に分ける。記号 \" * : ( ) は区切りとして扱う（001）"]
  C --> D["語の長さで分ける: 3 文字以上・2 文字・1 文字（002）"]
  D --> E["1 文字の語は検索条件から外す（005）"]
  D --> F{"keyword 全体が辞書の略称そのものか（houki-nta・houki-egov の管轄で、正式名が keyword と違う項目だけ。016）"}
  F -- はい --> G["元の語と正式名を、それぞれの長さで全文検索か部分一致で探し、結果を合わせる（009）"]
  F -- いいえ --> H{"3 文字以上の語があるか"}
  G --> K
  H -- ある --> I["3 文字以上の語を全部含むものを全文検索し、2 文字の語で絞り込む（002・004）。大文字と小文字を区別しない（021）"]
  H -- 無い --> J["2 文字の語を全部、本文か題名に含むものを部分一致で探す（003）。大文字と小文字を区別しない（021）"]
  I --> K{"0 件で、keyword 全体が辞書の通称か（houki-nta・houki-egov の管轄で、正式名が keyword と違う項目だけ。016）"}
  J --> K
  K -- はい --> L["正式名を含むものに広げて探し直す（010）"]
  K -- いいえ --> M["関連度 score と scoreReasons を付ける（012・013）"]
  L --> M
  M --> N["score の高い順に並べ、limit 件に絞る（014）"]
  N --> O["index_status・orphaned_at を付ける。索引から消えた文書は印と日時、索引にある文書は null（011）"]
  O --> P["search_notes に短い語・通称の展開・索引から消えた件数の文を入れる（006・010・011）"]
```

## できること

### SPEC-NTA-SEARCH-RULES-001 空白で区切った語をすべて含むものを探す（AND）

`keyword` を空白で語に分け、すべての語を含む条項・文書だけを返す。連続した空白や全角の空白も 1 つの区切りとして扱う。例: `"課税仕入 売上高"` と `"課税仕入　売上高"`（全角の空白）は、どちらも「課税仕入」と「売上高」の両方を含むものを探す。

- 全文検索の記法として意味を持つ記号 `"` `*` `:` `(` `)` は、語の一部にせず区切りとして扱う。例: `"消費税"*:()軽減税率` は「消費税」と「軽減税率」の 2 語として探す
- 2 文字の語が混ざるときも AND である。例: DB に「退職給与の打切支給（本文に「役員」を含む）」があるとき、`"退職給与 役員"` はその条項を返し、`"退職給与 社宅"` は 0 件になる

### SPEC-NTA-SEARCH-RULES-002 3 文字以上の語で全文検索し、3 文字未満の語は全文検索の条件に入れない

全文検索の索引は 3 文字ずつに区切って作られているため、3 文字未満の語は全文検索では当たらない。そこで語を長さで 3 つに分ける。

- 3 文字以上の語: 全文検索に使う
- 2 文字の語: 全文検索には使わず、部分一致で補う（SPEC-NTA-SEARCH-RULES-003・004）
- 1 文字の語: 検索条件から外す（SPEC-NTA-SEARCH-RULES-005）

例: `"役員 退職給与 a"` は、「退職給与」を全文検索に、「役員」を部分一致に使い、「a」を外す。`"役員"` や `"課税 売上"` のように 3 文字以上の語が無いときは、全文検索は行わない。

### SPEC-NTA-SEARCH-RULES-003 2 文字の語だけのときは本文と題名の部分一致で探す

3 文字以上の語が無く 2 文字の語があるときは、2 文字の語をすべて本文か題名に含むものを部分一致で探す。英字の大文字と小文字は区別しない（SPEC-NTA-SEARCH-RULES-021）。例: 「役員の範囲」「退職給与の打切支給（本文に「役員」を含む）」「棚卸資産の販売」の 3 条項があるとき、`"役員"` は前の 2 条項を返す。質疑応答事例などの文書系でも同じで、種別・税目の絞り込みも効く。

- `%` や `_` は部分一致の特別な記号として扱わず、文字そのものとして探す。例: `"%%"`・`"__"` はそれらの文字を含まない限り 0 件
- `snippet` は、本文で最初に見つかった 2 文字の語の前後を切り出し、その語を `<b>` で囲む。語の位置は大文字と小文字を区別せずに探し、囲む中身は本文の表記のまま。例: `… ああああ<b>役員</b>いいいい …`、`keyword` が `"qr"` で本文が `QRコード` なら `<b>QR</b>コード`。前後を切った側には `…` を付ける
- `scoreReasons` に `short token search (LIKE, no FTS rank): <語>` を足す。`<語>` の表記は SPEC-NTA-SEARCH-RULES-006 の `search_notes` と同じ
- `nta_search_tsutatsu` の応答では、この場合も `count` と `hits` を返し、`search_notes` を付ける（SPEC-NTA-SEARCH-RULES-006）

### SPEC-NTA-SEARCH-RULES-004 3 文字以上の語と 2 文字の語が混ざるときは、全文検索の結果を 2 文字の語で絞り込む

3 文字以上の語で全文検索した結果のうち、2 文字の語をすべて本文か題名に含むものだけを残す。含むかどうかは、英字の大文字と小文字を区別せずに比べる（SPEC-NTA-SEARCH-RULES-021）。例: `"退職給与 役員"` は、「退職給与」で当たった条項のうち「役員」を含むものだけを返す。`"QR コード"` は、「コード」で当たった文書のうち、本文か題名に `QR`（`qr`・`Qr` も同じ）を含むものを返す。`scoreReasons` に `short token filter (LIKE): <語>` を足す。`<語>` の表記は SPEC-NTA-SEARCH-RULES-006 の `search_notes` と同じ。

v0.23.0 までは、`keyword` を小文字に寄せた語（SPEC-NTA-SEARCH-RULES-008）と大文字のまま入っている本文（SPEC-NTA-SEARCH-RULES-007）を、大文字と小文字を区別して比べていたため、英字の 2 文字の語が大文字で書かれた文書が残らなかった（houki-nta-mcp #81）。

### SPEC-NTA-SEARCH-RULES-005 1 文字の語は検索条件から外す

1 文字の語は検索条件から外す。1 文字の語しか無いときは検索せず、結果は 0 件になる。例: `"a"` は 0 件、`"軽減税率 a"` は「軽減税率」だけで探す。

### SPEC-NTA-SEARCH-RULES-006 2 文字の語・1 文字の語を扱ったことを `search_notes` に書く

2 文字の語を部分一致で扱ったとき、1 文字の語を外したとき、3 文字未満の略称を広げたときは、応答の `search_notes`（文字列の配列）にその旨の文を入れる。結果が 0 件のときも付ける。検索系 6 ツールすべてで同じ文を使う。

文の中の `<語>` は、渡した `keyword` を SPEC-NTA-SEARCH-RULES-007 の揃え方で半角に揃えた表記で、英字の大文字と小文字は渡したままにする（小文字に寄せない）。例: `"DX 投資促進税制"` は `"DX"`、`"ＤＸ 投資促進税制"` は `"DX"`、`"dx 投資促進税制"` は `"dx"`（v0.23.0 では、どれも小文字に寄せた `"dx"` だった）。

- 2 文字の語だけのとき: `"<語>" は 3 文字未満のため FTS5 (trigram) では検索できません。代わりに本文とタイトルの部分一致 (LIKE) で検索しました。0 件でも「該当なし」とは限らないので、"<語>" に語を続けて 3 文字以上にした形での再検索を推奨します`
- 3 文字以上の語もあるとき: `"<語>" は 3 文字未満のため FTS5 (trigram) の索引に乗りません。3 文字以上の語で全文検索したうえで、本文に "<語>" を含むものに絞り込みました`
- 1 文字の語があるとき: `"<語>" は 1 文字のため検索条件から外しました`
- `keyword` 全体が 3 文字未満の略称で、正式名に広げたとき（SPEC-NTA-SEARCH-RULES-009）は、上の 3 つの文の代わりに次の文を 1 つ入れる。`<略称の探し方>` と `<正式名の探し方>` は、それぞれの語の長さで `部分一致 (LIKE)`（2 文字）・`全文検索`（3 文字以上）のどちらかになる
  - 略称が 2 文字のとき: `"<略称>" は 3 文字未満のため FTS5 (trigram) では検索できません。"<略称>" は本文とタイトルの部分一致 (LIKE) で、正式名 "<正式名>" は<正式名の探し方>で探し、どちらかを含むものを返しました`。例: `"消法" は 3 文字未満のため FTS5 (trigram) では検索できません。"消法" は本文とタイトルの部分一致 (LIKE) で、正式名 "消費税法" は全文検索で探し、どちらかを含むものを返しました`
  - 略称が 1 文字のとき: `"<略称>" は 1 文字のため検索条件から外し、正式名 "<正式名>" を<正式名の探し方>で探しました`。例: `"民" は 1 文字のため検索条件から外し、正式名 "民法" を部分一致 (LIKE) で探しました`
- 2 文字の語が複数あるときは `"<語1>" / "<語2>"` のように並べる
- 語がすべて 3 文字以上で、通称の展開（SPEC-NTA-SEARCH-RULES-010）も索引から消えた文書（SPEC-NTA-SEARCH-RULES-011）も無いときは、`search_notes` を付けない

v0.23.0 までは、3 文字未満の略称（例: `消法`）でも、実際には正式名だけを全文検索していたのに「部分一致 (LIKE) で検索しました」の文が入っていた（houki-nta-mcp #80）。

### SPEC-NTA-SEARCH-RULES-007 DB に入れる文字列は全角の数字・英字・記号・空白を揃える

国税庁サイトの文字列は半角と全角が混ざっているので、DB に入れる題名・本文を houki-abbreviations の `normalizeJpText`（0.7.0）で次のように揃える。

- 全角の数字・英字を半角にする。例: `１２３` → `123`、`ＮＩＳＡ` → `NISA`、`ｅ－Ｔａｘ` → `e-Tax`、`ＤＸ投資促進税制` → `DX投資促進税制`
- 全角のハイフン `－` と、ダッシュ類 `‐`（U+2010）`‑`（U+2011）`–`（U+2013）`—`（U+2014）`―`（U+2015）`−`（U+2212）を `-` にする。罫線 `─`（U+2500）と長音 `ー` は変えない。例: `1－4－13の2` → `1-4-13の2`、`課消２―11` → `課消2-11`、`データ` はそのまま
- 全角のチルダ `～` と波ダッシュ `〜` を `~` にする。例: `183〜193共-1` → `183~193共-1`
- 全角の空白を半角の空白にし、前後の空白を落とす。例: `第1章　通則` → `第1章 通則`
- 中黒 `・` と、「共」「の」「条」「項」「章」などの語は変えない。例: `1の3・1の4共-1` はそのまま
- 揃えた文字列にもう一度通しても変わらない

v0.21.3（houki-abbreviations 0.6.x）までは `－` だけを `-` にしていた。0.22.0 より前に取り込んだ行は、版 10 から 11 への移行で入れ直す（SPEC-NTA-DB-SCHEMA-019）。

例: 本文 `本文 with 全角ハイフン－と全角チルダ～が混入` は `全角ハイフン-と`・`全角チルダ~が` を含む形で入る。改正通達の本文の `課消２－11` も `課消２―11` も `課消2-11` として入る。

### SPEC-NTA-SEARCH-RULES-008 キーワードも DB と同じ揃え方をしてから探す

`keyword` にも SPEC-NTA-SEARCH-RULES-007 と同じ揃え方をしてから語に分ける。加えて英字は小文字に寄せ、連続した空白は 1 つにする。例: `"1－4－13　通則"` は `1-4-13 通則` として、`"ＮＩＳＡ"` は `nisa` として探す。全角の空白も語の区切りになる（SPEC-NTA-SEARCH-RULES-001）。

### SPEC-NTA-SEARCH-RULES-009 `keyword` が辞書の略称そのものなら、常に元の語と正式名のどちらかを含むものを探す

`keyword` 全体が略称辞書（houki-abbreviations）の略称そのもの（例: `消基通`・`消法`）のときは、元の語と正式名（例: `消費税法基本通達`・`消費税法`）のどちらかを含むものを探す。元の語で当たるかどうかにかかわらず、常に広げる。

元の語と正式名は、それぞれ語の長さで探し方を決め（SPEC-NTA-SEARCH-RULES-002）、両方の結果を合わせる。同じ文書が両方で当たっても 1 件として返す。

| 語の長さ | 探し方 |
|---|---|
| 3 文字以上 | 全文検索 |
| 2 文字 | 本文と題名の部分一致（SPEC-NTA-SEARCH-RULES-003 と同じ。英字の大文字と小文字は区別しない） |
| 1 文字 | 使わない（SPEC-NTA-SEARCH-RULES-005） |

例:

| `keyword` | 元の語 | 正式名 |
|---|---|---|
| `消基通` | 「消基通」を全文検索 | 「消費税法基本通達」を全文検索 |
| `消法` | 「消法」を部分一致 | 「消費税法」を全文検索 |
| `破` | 使わない | 「破産法」を全文検索 |
| `民` | 使わない | 「民法」を部分一致 |

- 略称と正式名は同じものを指すので、広げたこと自体は `search_notes` に書かない。3 文字未満の略称のときだけ、探し方を SPEC-NTA-SEARCH-RULES-006 の文で書く
- 正式名で当たった要素の `scoreReasons` に `abbreviation expanded: <略称> → <正式名>` を足す。元の語を部分一致で探して当たった要素には `short token search (LIKE, no FTS rank): <略称>` を足す。両方で当たった要素には両方を足す
- 部分一致だけで当たった要素は全文検索の順位を持たないので、`score` は 2 文字の語だけのとき（SPEC-NTA-SEARCH-RULES-003）と同じ決め方にする。並びは SPEC-NTA-SEARCH-RULES-014 のとおり `score` の順
- 例: 本文に「消費税法」がある質疑応答事例 A と、本文に「消法」だけがある事例 B があるとき、`"消法"` は A と B の両方を返す（v0.23.0 では A だけだった。houki-nta-mcp #80）
- 例: 本文に「消費税法基本通達」はあるが「消基通」は無い条項も、`"消基通"` で当たる
- 辞書に無い語（例: `使用人兼務役員`）は広げない
- 通称（SPEC-NTA-SEARCH-RULES-010）は、元の語が 3 文字未満でもこの ID に当たらない（元の語で 0 件のときだけ正式名に広げる）

### SPEC-NTA-SEARCH-RULES-010 通称は、元の語で 0 件のときだけ正式名に広げ、`search_notes` に書く

`keyword` 全体が略称辞書の通称（例: `インボイス`・`適格請求書発行事業者` は `消費税法` の通称）のときは、まず元の語だけで探す。

- 元の語で当たるときは広げない。正式名だけを含む文書は混ざらない。例: `"適格請求書発行事業者"` は、その語を含む条項・事例だけを返し、「消費税法」だけを含むものは返さない。`search_notes` も付けない
- 元の語で 0 件のときは、正式名を含むものに広げて探し直す。例: `"インボイス"` は「消費税法」を含む条項・事例を返す。このとき `search_notes` に `"<通称>" を含む文書は見つかりませんでした。略称辞書で "<通称>" は <正式名> の通称として登録されているため、"<正式名>" を含む文書に広げて検索しました。"<正式名>" という語が出てくるだけの文書も含まれます` を入れ、`scoreReasons` に `abbreviation expanded: <通称> → <正式名>` を足す
- 法令名（houki-egov の管轄の項目。例: `消費税法`）への通称も広げる

### SPEC-NTA-SEARCH-RULES-011 国税庁の索引から消えた文書は除外せず、印と件数の文を付ける

文書系 5 ツールは、国税庁の索引から消えたと bulk download が判定した文書も検索結果から除かずに返す。過去の課税期間の判断では意味を持つことがあるためである。

- その要素の `index_status` を `"removed_from_index"`、`orphaned_at` を索引から消えたことを最初に確認した日時にする。索引にある文書では、`index_status` と `orphaned_at` を `null` にする（キーは無くならない）
- `search_notes` に `検索結果 <N> 件のうち <M> 件は国税庁の索引から外れています（`index_status: "removed_from_index"`）。` に続けて、過去の課税期間では意味を持つ場合があるが現在の取扱いは最新の通達で確かめること、出典 URL は 404 になることがある旨の文を入れる。例: 2 件のうち 1 件が消えた文書なら `2 件のうち 1 件` を含む
- `nta_search_tsutatsu` には当てはまらない

例: 索引から消えた事務運営指針 1 件と索引にある 1 件が当たったとき、前者の要素は `index_status: "removed_from_index"`・`orphaned_at: "2026-10-01T00:30:00Z"`、後者の要素は `index_status: null`・`orphaned_at: null`（v0.22.0 では後者にどちらのキーも無かった）。

### SPEC-NTA-SEARCH-RULES-012 関連度 `score` は種別の重みを掛けた 0〜1.5 の数で、`scoreReasons` に種別を書く

各要素の `score` は、全文検索の順位から作った 0〜1 の値に、文書の種別の重みを掛けて作る。

- 全文検索の順位が強いほど 1 に近づき、当たりが無い（順位 0）ときや順位が数でないときは 0 にする
- 種別の重みは法的な拘束力の階層の順で、通達（基本通達の条項）が最も大きい 1.0、以下 改正通達 > 文書回答事例 > 事務運営指針 > 質疑応答事例 > タックスアンサー。同じ順位なら重みの大きい種別の `score` が高い
- `score` は 1.5 を超えない
- `scoreReasons`（文字列の配列）に `doc_type=<種別> weight <重み>` を入れる。例: `doc_type=tsutatsu weight 1.00`。部分一致・略称の展開をしたときはその理由の文が続く（SPEC-NTA-SEARCH-RULES-003・004・009・010）

### SPEC-NTA-SEARCH-RULES-013 `nta_search_tsutatsu` では、キーワードの条項番号と一致する条項の `score` を上げる

`keyword` に条項番号の形（例: `5-1-9`、所得税基本通達のような 2 段の `2-4`、`1-4-13の2`）が含まれ、条項の番号と一致するときは `score` に加点し、`scoreReasons` に `clause exact match` を入れる。全角の数字・ハイフンで書いた番号（例: `５-１-９`）も半角に直して比べる。番号が一致しない条項や、`keyword` に番号が無いときは加点しない。例: `"5-1-9 請求対価"` では条項 5-1-9 が 1 位に来る。文書系 5 ツールには当てはまらない。

### SPEC-NTA-SEARCH-RULES-014 結果は `score` の高い順に並べ、同点は全文検索の順位の順にする

結果は `score` の降順に並べる。`score` が同じときは全文検索の順位の強い順に並べる。そのうえで `limit` 件を返す。

### SPEC-NTA-SEARCH-RULES-015 文書系 5 ツールは、ヒットしたときに `results` と `keyword`・`freshness`・`legal_status` を返し、`results` の要素のキーは種別によらず同じにする

文書系 5 ツール（`nta_search_qa`・`nta_search_tax_answer`・`nta_search_kaisei_tsutatsu`・`nta_search_jimu_unei`・`nta_search_bunshokaitou`）は、キーワードに合う文書が 1 件以上あるとき、エラーにせず次を返す。

- `keyword`: 渡した `keyword`
- `results`: 合った文書の配列。`score` の高い順（SPEC-NTA-SEARCH-RULES-014）で、最大 `limit` 件。各要素は次のフィールドを持つ。値の無いフィールドは `null` にし、キーは無くさない

| フィールド | 内容 |
|---|---|
| `docType` | 種別。`qa-jirei` / `tax-answer` / `kaisei` / `jimu-unei` / `bunshokaitou` |
| `docId` | 文書 ID。例: 質疑応答事例は `shohi/02/19`、タックスアンサーは `6101`。取得ツール（`nta_get_*`）にそのまま渡せる値。`nta_inspect_pdf_meta` の `docId` に渡せるのは、`docType` が `kaisei`・`jimu-unei`・`bunshokaitou`・`tax-answer` の 4 種別の文書だけ（質疑応答事例は PDF を持たず、`nta_inspect_pdf_meta` の `docType` に `qa-jirei` が無い） |
| `taxonomy` | DB に入っている税目の値 |
| `title` | 題名 |
| `issuedAt` | 発出日（`YYYY-MM-DD`）。改正通達・事務運営指針・文書回答事例は DB の発出日で、DB に無ければ `null`。質疑応答事例は日付を持たないので常に `null`。タックスアンサーは発出日を持たないので常に `null`（記事の日付は `basisDate`） |
| `basisDate` | タックスアンサーは、記事の「法令時点」（例: `令和7年4月1日現在法令等`）から読んだ日付（`YYYY-MM-DD`）。読めなければ `null`。発出日ではない。ほかの 4 種別は常に `null`（キーは持つ） |
| `sourceUrl` | 国税庁ページの URL |
| `snippet` | 本文の抜粋。合った語を `<b>` で囲む。例: `<b>源泉徴収</b>の事務について …` |
| `score` / `scoreReasons` | 関連度とその理由（SPEC-NTA-SEARCH-RULES-012） |
| `index_status` / `orphaned_at` | 国税庁の索引から消えた文書では `"removed_from_index"` と確認した日時。索引にある文書ではどちらも `null`（SPEC-NTA-SEARCH-RULES-011） |

- `freshness`: その種別の文書の取得時点の範囲。税目で絞ったときはその範囲（`nta_search_bunshokaitou` は別表記を含む）
- `search_notes`: 短い語・通称の展開・索引から消えた文書・税目の別表記の注記があるときだけ付く
- `legal_status`: 種別ごとの資料の位置付け。次の表のとおり

| ツール | `binds_citizens` | `binds_courts` | `binds_tax_office` | `note` の要点 |
|---|---|---|---|---|
| `nta_search_qa` / `nta_search_tax_answer` | `false` | `false` | `false` | 国税庁の参考解説資料で法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある |
| `nta_search_kaisei_tsutatsu` | `false` | `false` | `true` | 通達は行政内部文書で納税者・裁判所を直接は拘束しないが、税務署員は職務として守る（最高裁 昭和43.12.24） |
| `nta_search_jimu_unei` | `false` | `false` | `true` | 通達・事務運営指針は行政内部文書で納税者・裁判所を直接は拘束しないが、税務署員は職務として守る（最高裁 昭和43.12.24）。文は `nta_get_jimu_unei` の json と同じ（SPEC-NTA-SEARCH-JIMU-UNEI-002） |
| `nta_search_bunshokaitou` | `false` | `false` | `false` | 個別事案への回答で一般的な法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある |

タックスアンサーの日付を `issuedAt` に入れないのは、記事の日付が「その日の法令で書いた」という法令時点で、発出日とは意味が違うためである。名前は `nta_get_qa` の `qa.basisDate`（注記から読んだ作成時点の日付、`YYYY-MM-DD`）と同じにした。

例: 質疑応答事例が 2 件ある DB で `nta_search_qa` に `{ keyword: "源泉徴収" }` を渡すと、`results` の各要素は `docType: "qa-jirei"` と上の表のフィールド（`issuedAt: null`・`basisDate: null`、索引にある文書なら `index_status: null`・`orphaned_at: null`）を持ち、`scoreReasons` の先頭は `doc_type=qa weight 0.70` になる。法令時点が `令和7年4月1日現在法令等` のタックスアンサーが当たると、その要素は `issuedAt: null`・`basisDate: "2025-04-01"` を持つ（v0.22.0 では `nta_search_qa` と `nta_search_tax_answer` の要素に `issuedAt` が無く、`basisDate` も無かった）。

### SPEC-NTA-SEARCH-RULES-016 略称・通称を広げるのは houki-nta と houki-egov の管轄の項目だけで、正式名が `keyword` と同じなら広げない

SPEC-NTA-SEARCH-RULES-009・010 で `keyword` を正式名に広げるのは、略称辞書の項目の管轄（`source_mcp_hint`）が `houki-nta` か `houki-egov` のときだけである。

- 管轄がほかの MCP（`houki-court`・`houki-saiketsu` など）の項目に当たったときは広げず、元の語だけで探す。`scoreReasons` に `abbreviation expanded:` は入らず、`search_notes` に通称の展開の文も入らない
- 辞書の正式名が `keyword` と同じ文字列のとき（例: `酒税法`。辞書の略称と正式名がどちらも `酒税法`）は広げない。`scoreReasons` に `abbreviation expanded:` は入らない

### SPEC-NTA-SEARCH-RULES-017 `freshness` は DB の取得時点の範囲と段階と DB のパスを返し、古いときだけ `warning` を付ける。文書系 5 ツールでは国税庁の索引から消えた文書を範囲に入れない

検索系 6 ツールが応答に付ける `freshness` は、次のフィールドを持つオブジェクトである。

| フィールド | 内容 |
|---|---|
| `oldest_fetched_at` / `newest_fetched_at` | 判定した範囲で最も古い取得日時と最も新しい取得日時（ISO 8601）。範囲に文書が無ければ `null` |
| `days_since_oldest` | 最も古い取得日時から呼び出した時点までの日数。範囲に文書が無ければ `null` |
| `staleness` | `days_since_oldest` が 7 日未満なら `fresh`、30 日未満なら `stale`、それ以上なら `outdated`。範囲に文書が無ければ `null` |
| `db_path` | 引いた DB のパス（SPEC-NTA-SEARCH-RULES-022、SPEC-NTA-DB-SCHEMA-028） |
| `warning` | `staleness` が `outdated` のときだけ付く。``一部ドキュメントが <日数> 日前のデータです。最新化するには `<コマンド>` を実行してください``。`<コマンド>` は下の表のフラグを付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027） |

判定する範囲と、`warning` のコマンドに付けるフラグは次のとおり。文書系 5 ツールの範囲は、どれも国税庁の索引にある文書だけである（下の箇条書き）。

| ツール | 範囲 | フラグ |
|---|---|---|
| `nta_search_tsutatsu` | DB にある通達の節すべて（通達ごとには分けない） | `--bulk-download-all` |
| `nta_search_qa` | 索引にある質疑応答事例。`topic` を渡したときはその税目 | `--bulk-download-qa` |
| `nta_search_tax_answer` | 索引にあるタックスアンサー全体 | `--bulk-download-tax-answer` |
| `nta_search_kaisei_tsutatsu` | 索引にある改正通達。`taxonomy` を渡したときはその税目 | `--bulk-download-kaisei` |
| `nta_search_jimu_unei` | 索引にある事務運営指針。`taxonomy` を渡したときはその税目 | `--bulk-download-jimu-unei` |
| `nta_search_bunshokaitou` | 索引にある文書回答事例。`taxonomy` を渡したときはその税目と別表記 | `--bulk-download-bunshokaitou` |

- 文書系 5 ツールは、国税庁の索引から消えたと bulk download が判定した文書（SPEC-NTA-SEARCH-RULES-011 の `orphaned_at` が付いた文書）を範囲に入れない。bulk download は索引から消えた文書を取り直さないので、その取得日時は投入をやり直しても新しくならない。範囲に入れると `staleness` が `fresh` に戻らず、`warning` が案内するコマンドを実行しても直らない
- 範囲から外すのは `freshness` の計算だけである。検索結果からは除かない（SPEC-NTA-SEARCH-RULES-011）。各ツールの spec.md と SPEC-NTA-SEARCH-RULES-015 が `freshness` の範囲を「全体」「その税目」と書くときも、索引から消えた文書を除いた範囲を指す。0 件の応答（各ツールの spec.md の 0 件の項）でも同じ
- 索引にあるかどうかは、呼び出した時点の DB の印で決める。後の bulk download で索引に戻り、印が外れた文書は範囲に入る
- 索引にあるが取得に失敗して取得日時が古いままの文書は、範囲に入る（取り直せる文書なので、古いことを `staleness` で示す）
- `nta_search_tsutatsu` の範囲（通達の節）は索引から消えた印を持たないので、この規則は当てはまらない
- 範囲の中の索引から消えた文書の件数などは `freshness` に足さない。索引から消えた文書が検索結果に入ったときは、その要素の `index_status`・`orphaned_at` と `search_notes` の文（SPEC-NTA-SEARCH-RULES-011）で分かる

範囲に文書が 1 件も無いときも `freshness` を付け、取得日時の 4 つを `null` にし、`warning` は付けない（SPEC-NTA-SEARCH-RULES-022）。文書系 5 ツールでは、範囲に索引にある文書が 1 件も無いとき（その種別の文書がすべて索引から消えたとき、税目で絞った範囲の文書がすべて索引から消えたときを含む）も同じである。このときも検索は行い、索引から消えた文書が当たればそれを返す。0 件の応答で範囲がどう変わるかは、各ツールの spec.md に書く。

例 1: 取得日時が `2026-01-01T00:00:00Z` と `2026-09-25T00:00:00Z` の質疑応答事例（どちらも索引にある）がある DB で、2026-09-27 に、環境変数を付けずに起動した MCP サーバーの `nta_search_qa` を呼ぶと、`oldest_fetched_at` は `2026-01-01T00:00:00Z`、`staleness` は `outdated` で、`warning` は ``一部ドキュメントが 269 日前のデータです。最新化するには `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` を実行してください`` になる（v0.24.x では `` `--bulk-download-qa` `` とフラグだけだった）。`HOUKI_NTA_DB_PATH=/tmp/x/cache.db` で起動したときは `` `HOUKI_NTA_DB_PATH='/tmp/x/cache.db' npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` ``。

例 2（タックスアンサー No.2882 の形、houki-nta-mcp #139）: タックスアンサーが次の 3 行の DB で `nta_search_tax_answer` を呼ぶ。

| `doc_id` | `fetched_at` | `orphaned_at` |
|---|---|---|
| `2882` | `2026-09-07T21:06:49.516Z` | `2026-10-04T02:11:37.431Z` |
| `1131` | `2026-10-04T03:00:00Z` | なし |
| `6101` | `2026-10-04T03:51:17.445Z` | なし |

| 呼んだ時点（UTC） | `oldest_fetched_at` | `newest_fetched_at` | `days_since_oldest` | `staleness` | `warning` |
|---|---|---|---|---|---|
| `2026-10-04T05:00:00Z` | `2026-10-04T03:00:00Z` | `2026-10-04T03:51:17.445Z` | 0 | `fresh` | 無し |
| `2026-10-08T00:00:00Z` | `2026-10-04T03:00:00Z` | `2026-10-04T03:51:17.445Z` | 3 | `fresh` | 無し |

v0.24.0 では、`oldest_fetched_at` が `2026-09-07T21:06:49.516Z` になり、`2026-10-04T05:00:00Z` では `days_since_oldest: 26`・`stale`、`2026-10-08T00:00:00Z` では `days_since_oldest: 30`・`outdated` と `--bulk-download-tax-answer` の `warning` だった。No.2882 がキーワードに当たれば、検索結果には今までどおり入り、その要素は `index_status: "removed_from_index"`・`orphaned_at: "2026-10-04T02:11:37.431Z"` を持つ。

例 3（ほかの 4 種別）: 種別ごとに、索引にある文書（取得日時 `2026-10-04T03:30:00Z`）と、索引から消えた文書（取得日時 `2026-09-01T00:00:00Z`、`orphaned_at` `2026-10-04T03:40:00Z`）が 1 件ずつ同じ税目 `shotoku` にある DB で、`2026-10-04T05:00:00Z` に呼ぶと、次のどれでも `oldest_fetched_at` と `newest_fetched_at` は `2026-10-04T03:30:00Z`、`staleness` は `fresh` になる（v0.24.0 では `oldest_fetched_at` が `2026-09-01T00:00:00Z`、`days_since_oldest: 33`、`outdated`）。

| ツール | 引数 |
|---|---|
| `nta_search_qa` | `topic` を省く / `topic: "shotoku"` |
| `nta_search_kaisei_tsutatsu` | `taxonomy` を省く / `taxonomy: "shotoku"` |
| `nta_search_jimu_unei` | `taxonomy` を省く / `taxonomy: "shotoku"` |
| `nta_search_bunshokaitou` | `taxonomy` を省く / `taxonomy: "shotoku"` |

例 4（範囲に索引にある文書が無い）: 改正通達が、税目 `hojin` の索引から消えた 1 件と、税目 `shohi` の索引にある 1 件だけの DB で、`nta_search_kaisei_tsutatsu` に `taxonomy: "hojin"` と `hojin` の文書に当たる `keyword` を渡すと、その文書を `index_status: "removed_from_index"` 付きで返し、`freshness` は取得日時の 4 つが `null` で `db_path` だけが値を持つ（v0.24.x では `freshness` を付けなかった）。`taxonomy` を省けば、範囲は `shohi` の 1 件で、取得日時の 4 つに値が入る。

### SPEC-NTA-SEARCH-RULES-018 `taxonomy` は列挙で検査せず、DB に無い値のときは `available_taxonomies` で正しい値を返す

`nta_search_bunshokaitou` / `nta_search_jimu_unei` / `nta_search_kaisei_tsutatsu` の `taxonomy` は、tools/list の inputSchema に `enum` を書かず、どの文字列でも受け付ける。税目フォルダは国税庁サイトの構成で増えるので、一覧を inputSchema に固定しない。DB のその種別の文書にその値の税目が無いときは、エラーにせず `results: []` と、DB にある税目の一覧 `available_taxonomies` を返す（SPEC-NTA-SEARCH-BUNSHOKAITOU-002、SPEC-NTA-SEARCH-KAISEI-TSUTATSU-002、SPEC-NTA-SEARCH-JIMU-UNEI-005）。3 ツールの inputSchema の `taxonomy` の `description` には、例の値に加えて「DB に無い値のときは `available_taxonomies` で正しい値を返す」と書く。

例: tools/list の `nta_search_kaisei_tsutatsu` の inputSchema の `properties.taxonomy` に `enum` は無く、`description` に `available_taxonomies` の語が入る。`{ keyword: "改正", taxonomy: "bogus" }` は `INVALID_ARGUMENT` ではなく、`results: []` と `available_taxonomies` の応答になる。

### SPEC-NTA-SEARCH-RULES-019 略称辞書を引く文字列と文書の識別子は、半角に揃えてから照合する

次の 2 つの入口は、どのツールでも同じ規則（全角英数字を半角に、ダッシュ類 `－` `‐` `‑` `–` `—` `―` `−` を `-` に、全角チルダ `～` `〜` を `~` に、全角空白を半角空白にし、前後の空白を除く。罫線 `─` と長音 `ー` は変えない。大文字と小文字は区別する）で揃えてから使う。

1. 略称辞書（houki-abbreviations）を引く文字列: `resolve_abbreviation` の `abbr`（SPEC-NTA-RESOLVE-ABBREVIATION-008）、`nta_get_tsutatsu` の `name`（SPEC-NTA-GET-TSUTATSU-018）、検索 6 ツールの `keyword` の略称・通称の展開（SPEC-NTA-SEARCH-RULES-009・010・016）。`resolveAbbreviation(name, { normalize: true })` で引く
2. 文書の識別子: `nta_get_qa` の `category` / `id`（SPEC-NTA-GET-QA-016）、`nta_get_tax_answer` の `no`（SPEC-NTA-GET-TAX-ANSWER-015）、`nta_get_kaisei_tsutatsu` / `nta_get_jimu_unei` / `nta_get_bunshokaitou` / `nta_inspect_pdf_meta` の `docId`（各 011・020）。`normalizeJpText` を通してから、T1 の形の検査（SPEC-NTA-COMMON-ERRORS-015）に進む。`nta_get_tsutatsu` の `clause`（SPEC-NTA-GET-TSUTATSU-004・008）も同じ規則

応答に返す引数の値（`keyword`、`abbr` など）は渡した値のまま。houki-egov-mcp の T3（SPEC-EGOV-RESOLVE-ABBREVIATION-011 など）と同じ範囲である。

例: `nta_search_qa` に `keyword: "ＰＬ法"` を渡すと、略称辞書の `PL法`（`製造物責任法`）に当たり、SPEC-NTA-SEARCH-RULES-016 の管轄の規則で展開するかどうかを決める（v0.21.3 では辞書に無い扱いで展開しなかった）。応答の `keyword` は `"ＰＬ法"` のまま。

### SPEC-NTA-SEARCH-RULES-020 `nta_search_tsutatsu` の `hits`・`message` と、文書系 5 ツールの `results`・`hint` の名前は、今のまま別にする

`nta_search_tsutatsu` はヒットの配列を `hits`、0 件のときの説明を `message` で返し、文書系 5 ツール（SPEC-NTA-SEARCH-RULES-015）はヒットの配列を `results`、0 件のときの説明を `hint` で返す。この名前の違いは意図であり、どちらかに付け替えない。

- 付け替えると、今の名前のフィールドを消すことになる（houki-hub の計画書 5.1「フィールドを消す変更は入れない」に反する）
- 片方の名前を足して両方を返すと、同じ値が 2 つのフィールドに入り、どちらを読むかが利用者によって分かれる

`nta_search_tsutatsu` のヒットは通達の条項（`tsutatsu`・`clauseNumber` を持つ）で、文書系のヒットは文書（`docType`・`docId` を持つ）であり、要素の形も違う。名前を揃えるときは、別の版で、CHANGELOG の「互換性」の節と minor の公開を伴う差分にする。

例: `nta_search_tsutatsu` に `{ keyword: "役員" }` を渡すと配列は `hits`、`nta_search_qa` に `{ keyword: "源泉徴収" }` を渡すと配列は `results`。どちらの応答にも、もう一方の名前のフィールドは無い。

### SPEC-NTA-SEARCH-RULES-021 英字の大文字と小文字は、どの探し方でも区別しない

`keyword` の英字は、全文検索・2 文字の語の部分一致（SPEC-NTA-SEARCH-RULES-003）・全文検索の結果の 2 文字の語による絞り込み（SPEC-NTA-SEARCH-RULES-004）・略称の元の語の部分一致（SPEC-NTA-SEARCH-RULES-009）のどれでも、大文字と小文字を区別せずに本文と題名に当てる。区別しないのは半角の英字（`A`〜`Z` と `a`〜`z`）だけで、全角の英字は SPEC-NTA-SEARCH-RULES-007・008 で半角に揃えてから比べる。

- どの探し方で当たったかによって、同じ `keyword` の結果が変わらない。例: 本文に「DX 投資促進税制」がある文書は、`"DX 投資促進税制"`・`"dx 投資促進税制"`・`"ＤＸ 投資促進税制"` のどれでも当たる
- `snippet` の `<b>` で囲む箇所も、大文字と小文字を区別せずに探した位置にする。囲む中身は本文の表記のまま（例: `keyword` が `"dx"` でも `<b>DX</b>`）

例: 2026-10-03 JST に houki-nta-dev（手元のビルド、0.23.0）の `nta_search_tax_answer` で、`{ keyword: "QRコード" }` はタックスアンサー 1119（本文に「QRコード付控除証明書」）と 9209 を返したが、`{ keyword: "QR コード" }` は `results: []` だった（`search_notes` は `"qr" は 3 文字未満のため…本文に "qr" を含むものに絞り込みました`）。この ID の後は、`"QR コード"` も 1119 と 9209 を返す。

### SPEC-NTA-SEARCH-RULES-022 検索 6 ツールの成功の応答は `freshness` を常に持ち、`db_path` に引いた DB のパスを入れる

検索 6 ツール（`nta_search_tsutatsu`・`nta_search_qa`・`nta_search_tax_answer`・`nta_search_kaisei_tsutatsu`・`nta_search_jimu_unei`・`nta_search_bunshokaitou`）がエラーでない応答を返すときは、ヒットの有無と 0 件の理由（各ツールの spec.md の 0 件の項）によらず、`freshness` を置く。`freshness` は常に次のキーを持つオブジェクトにする（`warning` は SPEC-NTA-SEARCH-RULES-017 のとおり `outdated` のときだけ付く）。

| 場面 | `db_path` | `oldest_fetched_at` / `newest_fetched_at` / `days_since_oldest` / `staleness` |
| --- | --- | --- |
| 範囲（SPEC-NTA-SEARCH-RULES-017）に文書がある | 引いた DB のパス（SPEC-NTA-DB-SCHEMA-028 の形） | SPEC-NTA-SEARCH-RULES-017 の値 |
| 範囲に文書が無い（文書系 5 ツールでは、範囲の文書がすべて国税庁の索引から消えたときを含む） | 引いた DB のパス | 4 つとも `null` |

エラーの応答（`DOC_NOT_FOUND`・`TSUTATSU_NOT_FOUND`・`INVALID_ARGUMENT`・`INTERNAL_ERROR`）には `freshness` を置かない。DB を引けなかったときの DB のパスは `hint` に入る（SPEC-NTA-DB-SCHEMA-029、021 の注 2）。検索 6 ツールがエラーでない応答を返すのは DB を引いたときだけなので、`db_path` は `null` にならない。

例: ホームディレクトリが `/Users/bonji`、DB の場所の設定が `既定` で、質疑応答事例の取得日時が 2026-10-04 の DB で `nta_search_qa { keyword: "源泉徴収" }` を呼ぶと、`freshness` は `{ oldest_fetched_at: "2026-10-04T03:51:26.746Z", newest_fetched_at: "2026-10-04T04:26:15.744Z", staleness: "fresh", days_since_oldest: 0, db_path: "~/.cache/houki-nta-mcp/cache.db" }`。`HOUKI_NTA_DB_PATH=/tmp/x/cache.db` で起動すると `db_path: "/tmp/x/cache.db"`。SPEC-NTA-SEARCH-RULES-017 の例 4 の `taxonomy: "hojin"` の呼び出しでは `freshness` は `{ oldest_fetched_at: null, newest_fetched_at: null, staleness: null, days_since_oldest: null, db_path: "~/.cache/houki-nta-mcp/cache.db" }`（v0.24.x では `freshness` のキーが無かった）。

## できないこと

- 表記の揺れ（ひらがなとカタカナ、送り仮名、漢数字と算用数字）を揃えること（揃えるのは全角と半角だけ）
- 語の並び順や近さを条件にすること（語の AND だけ。フレーズや OR は指定できない）
- 3 文字未満の語を全文検索の順位で並べること（部分一致で当たったものは順位を持たない）
- 文の一部に含まれる略称・通称を広げること（`keyword` 全体が辞書の項目と一致するときだけ）
- 国税庁の索引から消えた文書を検索結果から除くこと

## 未決

初版起こしで見つけた、意図か不具合かを人が決める項目です。決まったら「できること」に ID を振るか、`specs/changes/` の差分にします。

意図か不具合かの判断が要る項目は houki-nta-mcp の Issue に移し、ここには題と Issue の番号だけを残します。今の振る舞いのままでよくテストが無いだけの項目は、受入テストを書いてから「できること」に ID を振ります。

3. **`keyword` の前後の空白の扱いの違い。** `nta_search_tsutatsu` は `keyword` の前後の空白を落として応答に返すが、文書系は受けた `keyword` をそのまま返す。テストが無い。ID を振るのは受入テストを書いてから。
7. **DB に入れるときの揃え方（SPEC-NTA-SEARCH-RULES-007）の証拠。** 取り込みの処理は種別ごとにあり、揃えた形で入ることを確かめるテストは基本通達の条項（書き戻し）と改正通達の本文にしか無い。質疑応答事例・タックスアンサー・文書回答事例・事務運営指針は、揃える処理を通ることをコードで確かめたが、テストが無い。ID を振るのは受入テストを書いてから（種別ごとの受入テストを足すか）。
11. **種別の重みと条項番号の加点の値。** 今の重みは 通達 1.0 / 改正通達 0.95 / 文書回答事例 0.9 / 事務運営指針 0.85 / 質疑応答事例 0.7 / タックスアンサー 0.6、条項番号の一致の加点は 0.5。テストが確かめているのは重みの順序と通達の 1.0、加点すると `score` が上がることだけである。値そのものを仕様にするか。
12. **部分一致だけで当たったものの `score`。** 2 文字の語だけのとき（SPEC-NTA-SEARCH-RULES-003）は全文検索の順位が無いので、全件に同じ仮の順位を与え、`score` は種別の重み × 約 0.09 の同じ値になる。並びは DB に入れた順になる。この値と並びを確かめるテストが無い。ID を振るのは受入テストを書いてから。

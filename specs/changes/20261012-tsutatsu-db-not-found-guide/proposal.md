---
approved: 2026-10-12
pr: 165
implementation: required
targets: [db_schema, nta_get_tsutatsu]
---

# 変更: `nta_get_tsutatsu` の DB の経路の `ARTICLE_NOT_FOUND` の案内を国税庁サイトの経路とそろえ、`available_clauses` の打ち切りを応答で示す（nta #164）

- 対象: `nta_get_tsutatsu` / `db_schema` の `specs/current/<dir>/spec.md`
- 実装の変更の補足: 下の「実装の変更」
- 状態: 草案
- 起こした日: 2026-10-12（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #164（`nta_get_tsutatsu` の `ARTICLE_NOT_FOUND`（DB の経路）の `hint` が案内コマンドの形（027）に合わず、`next_actions` と `available_clauses` の打ち切りの印が無い）
- 出発点: #164 の「期待する形（案）」。0.27.0 の差分 `20261009-db-folder-access-and-tsutatsu-guide` の「この差分の外で見つけたこと」1 で、4 通達以外の通達の条項が DB に残っているときの `hint` を別の Issue にすると書いた項目も、この差分で扱う（005 の (b)）
- 差分の書き方: 見出しの単位（MODIFIED 005・010・027、ADDED 019）。ID の無い節は変えない
- 前提: main の `388353f`（版 0.27.0。`[Unreleased]` に spec-ids 0.4.0 への切り替えがある）から切った。2026-10-12 JST に `git ls-remote https://github.com/shuji-bonji/houki-nta-mcp refs/heads/main` で origin の main と同じ `388353f9…` であることを確かめた。`specs/changes/` は空だった
- 版: 0.27.1（patch。`code`・`error` は変えず、`hint` の文を変え、`next_actions` と `available_clauses_total` を足す。応答のフィールドを消す・名前を変える変更は無い。下の「人が判断すること」5）。DB のスキーマの版は 12 のまま

## なぜ変えるか

`nta_get_tsutatsu` の `ARTICLE_NOT_FOUND` には 2 つの経路がある。国税庁サイトの経路（SPEC-NTA-GET-TSUTATSU-010。候補ページのどれにも条項が無い）は、`hint` に番号の形の確認・`nta_search_tsutatsu` での検索・SPEC-NTA-DB-SCHEMA-027 の形の `--bulk-download --tsutatsu="<正式名>"` のコマンドを書き、`next_actions` に `nta_search_tsutatsu` と `cli_bulk_download` の 2 件を入れる。DB の経路（SPEC-NTA-GET-TSUTATSU-005。bulk download 済みの通達に条項が無い）は、`hint` が `別の clause 番号を試すか、\`--bulk-download\` で再取得してください（最新の改正反映用）` で、`next_actions`が無い。同じ`code` なのに、読み手（LLM）が次に取れる手が経路で違う。

さらに、この `hint` の `--bulk-download` はフラグだけで、`--tsutatsu=<正式名>` が要ることも、DB の場所の設定（`HOUKI_NTA_DB_PATH` など）を前に付けることも書いていない。SPEC-NTA-DB-SCHEMA-027 は、この文を「フラグだけを書いた文」として案内のコマンドの形の外に置いていた（つまり、今の `hint` は仕様の文のとおりで、仕様の側が 010 と食い違っていた）。

`available_clauses` は 005・010 とも最大 50 件と決めているが、50 件で切れたことを示す項目が応答に無い。51 件以上ある通達では、読み手は一覧が全件なのか途中までなのかを応答から判別できない。

## 今の動き（v0.27.0）

2026-10-12 JST に、main `388353f` の `src/tools/handlers.ts` の `getTsutatsu`（`hasAnyClause(db, …) && (!rootUrl || isBulkCompleted(…))` の枝）と `renderLiveResult`（`case 'not_found'`）、`src/services/db-search.ts` の `listAvailableClauses`、`src/services/tsutatsu-live.ts` の `describeClauseForm` を読んだ。#164 の再現（`{ name: "消基通", clause: "99-9-9" }` で `hint` が上の文、`available_clauses` が 50 件、`next_actions` 無し）は Issue の本文のとおりで、この差分では実行していない。

| 場面                                                                                              | `hint`                                                                                                                                                                                  | `next_actions`                             | 打ち切りの印 |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------ |
| 005 (a) bulk download 済みの基本通達 4 種に条項が無い                                             | `別の clause 番号を試すか、\`--bulk-download\` で再取得してください（最新の改正反映用）`                                                                                                | 無い                                       | 無い         |
| 005 (b) 4 通達以外の通達の条項が DB にあり、求めた条項が無い（0.23.x 以前の DB に残っている場合） | 同上（`--bulk-download` は 4 通達以外を受け付けないので、実行できない投入を案内している）                                                                                               | 無い                                       | 無い         |
| 010 候補ページのどれにも条項が無い                                                                | `<正式名>の番号の形は …。番号の形を確かめてください。\`nta_search_tsutatsu\` で条項を検索するか、\`<027 の形のコマンド>\` で全節を DB に入れると、国税庁サイトに取りに行かずに引けます` | `nta_search_tsutatsu`・`cli_bulk_download` | 無い         |

`available_clauses` の切り出しは、005 が SQL の `LIMIT 50`（`listAvailableClauses`）、010 が `live.availableClauses.slice(0, 50)`。どちらも元の件数を応答に出していない。

## 変えた後の動き

1. **005 の `hint` と `next_actions` を 010 と同じ組み立てにする（GET-TSUTATSU-005、DB-SCHEMA-027）。** (a) 基本通達 4 種では、`hint` に `<正式名>の番号の形は <形>（例: …）。番号の形を確かめてください。\`nta_search_tsutatsu\` で条項を検索するか、\`<コマンド>\` で全節を取り直すと、DB に投入した後の改正を反映できます` を書き、`<コマンド>`は 027 の形で`--bulk-download --tsutatsu="<正式名>"` を付けたもの。`next_actions`は`nta_search_tsutatsu`と`cli_bulk_download` の 2 件。(b) 基本通達 4 種以外では、投入できないので（SPEC-NTA-CLI-BULK-DOWNLOAD-011）、`hint`は`この通達（<正式名>）は国税庁サイトから取れず、投入のフラグ（--bulk-download の --tsutatsu）でも DB に入れられません（入れられるのは基本通達 4 種だけです）。DB にある条項は available_clauses のとおりです。\`nta_search_tsutatsu\` で条項を検索してください`、`next_actions`は`nta_search_tsutatsu` の 1 件
2. **027 の「この形にしない」から 005 の `hint` を外し、「当てはまる箇所」の表に 005 を足す（DB-SCHEMA-027）。** 振る舞いは 1 で変わる。027 は箇所の一覧を直すだけ
3. **`available_clauses_total` を 005・010 の両方に付ける（GET-TSUTATSU-019、ADDED）。** 一覧の元になった条項の総数（005 は DB にあるその通達の条項の数、010 は取得した候補ページにある条項の数）。`available_clauses` を返すときは常に付ける（T4: フィールドは足すだけで、場面で有無を変えない）
4. **総数が 50 を超えるときは `hint` の末尾に `available_clauses は先頭 50 件です（全 <総数> 件）` を足す（GET-TSUTATSU-019）。** 50 以下のときは書かない。005・010 とも同じ
5. **010 の文に 019 と 027 への参照を足す（GET-TSUTATSU-010）。** 振る舞いは変えない

## 変わる仕様 ID

| 種類     | 仕様 ID                                                |
| -------- | ------------------------------------------------------ |
| ADDED    | SPEC-NTA-GET-TSUTATSU-019                              |
| MODIFIED | SPEC-NTA-GET-TSUTATSU-005・010、SPEC-NTA-DB-SCHEMA-027 |
| REMOVED  | なし                                                   |

ADDED 1、MODIFIED 3、REMOVED 0。新しい ID は `npx spec-ids next specs/current/nta_get_tsutatsu/spec.md` で取った（2026-10-12 JST、`SPEC-NTA-GET-TSUTATSU-019`）。

Issue の「期待する形（案）」との対応:

| Issue の案                                                                                                                                                  | この差分の答え                                                                     | 仕様 ID                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------- |
| 005 に `hint` と `next_actions` を決める文を足す。内容は 010 と揃え、コマンドは 027 の形にする                                                              | そのとおり。4 通達以外（(b)）は投入できないので `cli_bulk_download` を入れない     | GET-TSUTATSU-005、DB-SCHEMA-027 |
| `available_clauses` が上限で切れたことを示す項目（`available_clauses_truncated: true` か `available_clauses_total`）を足すか、`hint` に「先頭 50 件」と書く | `available_clauses_total`（常に付ける）と、50 件を超えたときだけ `hint` の文。両方 | GET-TSUTATSU-019                |

## 変わらない振る舞い

- 005 の `code`（`ARTICLE_NOT_FOUND`）・`error`（`clause "<入力>" は DB 内の "<正式名>" に見つかりません`）・`available_clauses` の並び（DB に入れた順）と上限（50 件）・国税庁サイトに取りに行かないこと
- 005 と 006 の分かれ方（bulk download 済みかどうか。`tsutatsu.bulk_completed_at`）
- 010 の `code`・`error`・`available_clauses`・`searched_urls`・DB を開けないときの `cli_bulk_download` の省き方
- 007（ライブ取得に対応していない通達で DB に条項が 1 件も無い）の応答
- `next_actions[]` の `cli_bulk_download` の `reason`（`ローカル DB に未投入のため bulk download が必要`。`src/errors.ts` の `NEXT_ACTIONS.bulkDownload`）。005 (a) では DB に投入済みなので文が場面に合わないが、`reason` の文は 010 を含む全箇所で共通で、この差分では変えない（下の「この差分の外で見つけたこと」1）
- tools/list のツールの説明（`bulk download（--bulk-download-all）済みの通達はエラー ARTICLE_NOT_FOUND` のまま）

## 互換性（0.27.1 の CHANGELOG に書くもの）

| 場面                                                              | 0.27.0                                                                                                                  | 0.27.1                                                                                                                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bulk download 済みの基本通達 4 種に求めた条項が無い（005 (a)）    | `hint` は `別の clause 番号を試すか、\`--bulk-download\` で再取得してください（最新の改正反映用）`、`next_actions` 無し | `hint` は番号の形・`nta_search_tsutatsu`・027 の形の `--bulk-download --tsutatsu="<正式名>"` のコマンド、`next_actions` は `nta_search_tsutatsu` と `cli_bulk_download` の 2 件 |
| 4 通達以外の通達の条項が DB にあり、求めた条項が無い（005 (b)）   | 同上（実行できない投入を案内）                                                                                          | `hint` は「国税庁サイトから取れず投入もできない」こと、`next_actions` は `nta_search_tsutatsu` の 1 件                                                                          |
| `ARTICLE_NOT_FOUND` で `available_clauses` を返すとき（005・010） | `available_clauses_total` 無し、50 件で切れても印が無い                                                                 | `available_clauses_total` に総数。50 件を超えたときは `hint` の末尾に `available_clauses は先頭 50 件です（全 N 件）`                                                           |

CHANGELOG の文の案:

```markdown
### Fixed

- `nta_get_tsutatsu` で、bulk download 済みの通達に求めた条項が無いとき（`ARTICLE_NOT_FOUND`、DB の経路）の `hint` と `next_actions` を、国税庁サイトの経路（候補ページのどれにも条項が無いとき）と同じ組み立てにしました（#164）。`hint` にはその通達の番号の形と `nta_search_tsutatsu` での検索、`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download --tsutatsu="<正式名>"`（DB の場所を環境変数で決めているときはその変数を前に付けた形）を書き、`next_actions` に `nta_search_tsutatsu` と `cli_bulk_download` の 2 件を入れます。0.27.0 までは `hint` がフラグだけ（`--bulk-download`）で、`next_actions` がありませんでした。基本通達 4 種以外の通達の条項が DB に残っているときは、投入できないので `hint` にその旨を書き、`next_actions` は `nta_search_tsutatsu` の 1 件です
- `nta_get_tsutatsu` の `ARTICLE_NOT_FOUND` で `available_clauses`（最大 50 件）を返すとき、一覧の元になった条項の総数を `available_clauses_total` に付け、50 件を超えたときは `hint` の末尾に `available_clauses は先頭 50 件です（全 N 件）` と書くようにしました（#164）。0.27.0 までは、一覧が全件か途中までかを応答から読み取れませんでした
```

houki-research-skill で関係する箇所（2026-10-12 JST に `skills/houki-research-skill` で `grep -rn "available_clauses\|ARTICLE_NOT_FOUND" --include=*.md`（CHANGELOG を除く）で探した）: `available_clauses` を書いた箇所は無い。`docs/ERROR-HANDLING.md` 80 行目（`next_actions` の `action` で投入が要るかを見分ける）は、005 (a) が `cli_bulk_download` を持つようになっても「投入が必要」ではなく「取り直すと改正を反映できる」場面なので、Skill の追随で「`available_clauses` が付いていれば投入は済んでいる（`available_doc_ids` と同じ扱い）」の一文を足すかを決める（下の「この差分の外で見つけたこと」2）。

## 呼び出し例への影響

houki-hub の `scripts/reference-examples/houki-nta/ja/nta_get_tsutatsu.md`（2026-10-12 JST）の 51 行目は、国税庁サイトの経路の `ARTICLE_NOT_FOUND`（`available_clauses`・`searched_urls`）だけを書いている。DB の経路の例は無い。`available_clauses_total` を足すかは hub の追随で決める。tools/list の `description` は変えないので、`site/docs/reference/mcp/houki-nta.md` の作り直しは要らない。

## 実装 PR で直す文書

| #   | 場所                                                                               | 直すこと                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CHANGELOG 0.27.1                                                                   | 上の「互換性」の文。`Fixed` に #164。`Closes #164` は実装 PR の本文に書く                                                                                                                                               |
| 2   | README の `nta_get_tsutatsu` の節                                                  | `ARTICLE_NOT_FOUND` の `available_clauses` に触れている文があれば `available_clauses_total` を足す（2026-10-12 JST の grep では README に `ARTICLE_NOT_FOUND`・`available_clauses` の記述は無かった。無ければ変えない） |
| 3   | houki-research-skill（別の PR）                                                    | 上の Skill の段落                                                                                                                                                                                                       |
| 4   | houki-hub `scripts/reference-examples/houki-nta/ja/nta_get_tsutatsu.md`（別の PR） | 上の「呼び出し例への影響」                                                                                                                                                                                              |

## 実装の変更

- `src/services/db-search.ts`: その通達の条項の総数を返す関数を足す（`SELECT COUNT(*) FROM clause c JOIN tsutatsu t … WHERE t.formal_name = ?`）。`listAvailableClauses` は変えない
- `src/tools/handlers.ts` の `getTsutatsu` の 005 の枝: `rootUrl` があるとき（基本通達 4 種、(a)）は `TSUTATSU_TOC_STYLES[resolved.formal]` の番号の形（`describeClauseForm`）と、`guideCommand(\`--bulk-download --tsutatsu="${resolved.formal}"\`, location)`のコマンドで`hint` を組み立て、`next_actions`に`NEXT_ACTIONS.searchTsutatsu(args.clause)`と`NEXT_ACTIONS.bulkDownload(command)`。`rootUrl`が無いとき（(b)）は投入できない旨の`hint`と`NEXT_ACTIONS.searchTsutatsu(args.clause)` の 1 件。`available_clauses_total`に総数、総数が`AVAILABLE_CLAUSES_LIMIT`を超えたら`hint` の末尾に打ち切りの文。`location`は同じ関数の中で`toolLocation(options.dbPath)`から取ったもの（010 の`renderLiveResult` に渡しているものと同じ）
- `src/tools/handlers.ts` の `renderLiveResult` の `case 'not_found'`: `available_clauses_total: live.availableClauses.length` を足し、総数が上限を超えたら `hints` に打ち切りの文を足す（`skippedByLimit` の文の後）
- 打ち切りの文の組み立ては 1 か所にまとめる（005・010 で同じ文）
- 受入テスト（Test Designer）。新しいファイル `src/tools/spec-20261012-tsutatsu-db-not-found-guide.test.ts`:
  - 005 (a): 消基通を bulk download 済みの印付きで DB に入れ（`handlers.test.ts` の `seedShohi` と同じ作り）、`clause: "99-9-9"` で `code`、`hint` の番号の形（`章-節-条`）・`nta_search_tsutatsu`・`--bulk-download --tsutatsu="消費税法基本通達"`・027 の形（`HOUKI_NTA_DB_PATH=` で始まり `npx -y @shuji-bonji/houki-nta-mcp@latest` を含む）、`next_actions` の `action` が `['nta_search_tsutatsu', 'cli_bulk_download']`、`example.command` が `hint` のコマンドと同じ、`fetch` を呼ばないこと
  - 005 (b): `電帳法取通` の条項を `writeBackLiveSection` で DB に入れ（`spec-20260927-fetch-paths.test.ts` と同じ作り）、`hint` に `取り込め` ではなく「国税庁サイトから取れず」「投入のフラグ」「基本通達 4 種」「nta_search_tsutatsu」を含み `--bulk-download --tsutatsu` を含まないこと、`next_actions` が `['nta_search_tsutatsu']`
  - 019（005）: 60 件で `available_clauses` 50 件・`available_clauses_total` 60・`hint` の末尾が `available_clauses は先頭 50 件です（全 60 件）`。3 件で `available_clauses` 3 件・`available_clauses_total` 3・`hint` に `先頭 50 件` を含まない
  - 019（010）: `spec-20261003-t4-response-shape.test.ts` の「取得したページに条項が 80 件あり…」のテストに `available_clauses_total` が 80 と `hint` の末尾の文の期待値を足し、テスト名に 019 を並べる
- 既存のテストで期待値を直すもの（2026-10-12 JST に `grep -rn "SPEC-NTA-GET-TSUTATSU-005\|SPEC-NTA-GET-TSUTATSU-010" src tests --include=*.ts` で探した）: 無い。`handlers.test.ts` の 005 の 4 件は `code`・`available_clauses`・`fetch` の有無だけを見ており、`get-tsutatsu-live-toc.test.ts` と `spec-20261006-db-failure-paths.test.ts` の 010 の `hint`・`next_actions` の期待値は変わらない

## publish の前の確認

計画書の契約の確認（変えたツールの例を流す）に加えて、shuji の Mac で次を確かめる。公開版の DB（`~/.cache/houki-nta-mcp/cache.db`）は読むだけで、書く操作はしない。

1. 受入テストが `npm test` で通り、`npm run check` が通る。作業コピーで `npm run build` する
2. 公開版の DB（消基通が bulk download 済み）を `HOUKI_NTA_DB_PATH` で指して、0.26.0 の proposal.md の「publish の前の確認」5 の `call.sh` と同じ作りで `nta_get_tsutatsu`（`{"name":"消基通","clause":"99-9-9","format":"json"}`）を呼び、`code: "ARTICLE_NOT_FOUND"`、`hint` が `消費税法基本通達の番号の形は 章-節-条（例: 5-1-9 / 1-4-13の2）。` で始まり `HOUKI_NTA_DB_PATH="$HOME/.cache/houki-nta-mcp/cache.db" npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download --tsutatsu="消費税法基本通達"` を含み、末尾が `available_clauses は先頭 50 件です（全 <N> 件）` であること、`next_actions` が 2 件、`available_clauses` が 50 件、`available_clauses_total` が `N`（`sqlite3 ~/.cache/houki-nta-mcp/cache.db "SELECT COUNT(*) FROM clause c JOIN tsutatsu t ON t.id=c.tsutatsu_id WHERE t.formal_name='消費税法基本通達'"` と同じ）であることを確かめる
3. `hint` の `cli_bulk_download` のコマンドを、`/tmp/nta-0271/cache.db` を指す `HOUKI_NTA_DB_PATH` に替えて実行し（`--bulk-download --tsutatsu="消費税法基本通達"`）、引数の誤りで止まらずに投入が始まることを確かめる（1 節取れたところで `Ctrl-C` でよい）。`rm -rf /tmp/nta-0271` で片付ける
4. 結果を実装 PR の本文に書く

## 取り込みのとき（Publisher）

- MODIFIED の見出し（005・010・027）を、見出しの行（題）も含めて、各 `specs/current/<dir>/spec.md` の同じ ID の節と置き換える。ADDED の 019 を `nta_get_tsutatsu` の「できること」の末尾（018 の後）に足す。各差分の spec.md の冒頭に書いた「関連する Issue」への追記も行う
- current の spec.md の front matter と本文には、この差分の承認を書き足さない（AGENTS.md の「承認の記録」）
- この差分のフォルダーを `specs/releases/v0.27.1/20261012-tsutatsu-db-not-found-guide/` へ移し（`git mv`）、この proposal.md の「状態」を「取り込み済み（v0.27.1）」にする
- 移した後、`specs/changes/` が空（`.gitkeep` だけ）であること、`npx spec-ids check` と `npx spec-ids pr-scope` が通ること、`npx spec-ids history nta_get_tsutatsu` にこの差分が v0.27.1 で出ることを確かめる
- CHANGELOG の 0.27.1 に閉じる Issue（#164）を書く

## 人が判断すること

1. **005 (a) の `hint` の文。** 010 の文（`…で全節を DB に入れると、国税庁サイトに取りに行かずに引けます`）は「DB に無い」場面の文で、005 (a) は全節が DB にある場面なので、後半を `…で全節を取り直すと、DB に投入した後の改正を反映できます` にした。前半（番号の形の確認、`nta_search_tsutatsu`）は 010 と同じ。案は (A) この文 / (B) 010 と完全に同じ文（場面に合わない）。**勧める: A**
2. **005 (b)（4 通達以外の通達の条項が DB に残っているとき）の扱い。** 0.24.0 以降の `--tsutatsu` は 4 通達以外を受け付けないので、この DB を作る経路は 0.23.x 以前の投入だけで、当たる利用者は少ない。案は (A) この差分で `hint` を投入できない文にし、`next_actions` を `nta_search_tsutatsu` の 1 件にする（007 と同じ考え方） / (B) 変えない（実行できない投入の案内が残る）。0.27.0 の差分で「別の Issue にする」と書いた項目だが、005 の文を書き換える機会なので同じ差分に入れた。**勧める: A**
3. **打ち切りの示し方（019）。** 案は (A) `available_clauses_total`（総数。常に付ける）と、50 件を超えたときだけ `hint` の文 / (B) `available_clauses_truncated: true | false` / (C) `hint` の文だけ。A は、読み手が切れたかどうかだけでなく何件あるかも分かり、T4（値が無いフィールドは `null`、場面で有無を変えない）に沿って常に数値を置ける。B は真偽だけで件数が分からない。C は機械で読めない。**勧める: A**
4. **`available_clauses_total` を返すエラーの範囲。** `available_clauses` を返す 005・010 だけ。`available_clauses` の無いエラーには付けない（`null` も置かない。`available_clauses` と対で付けるフィールドなので、片方だけ `null` で置くと「一覧が無いのに総数が `null`」になり、読み手に意味を持たない）。**勧める: このまま**
5. **版。** 0.27.1（patch）。`code`・`error`・既存フィールドの型は変えず、`hint` の文を変え、`next_actions` と `available_clauses_total` を足す。0.21.3（`kind` の補い）と同じ扱い。`hint` の文を機械で読んでいる呼び出し側は想定しない（`hint` は人と LLM が読む文）。案は (A) 0.27.1 / (B) 0.28.0（minor。`next_actions` が付くようになるのを振る舞いの変更と見る）。**勧める: A**
6. **`next_actions[]` の `cli_bulk_download` の `reason`（`ローカル DB に未投入のため bulk download が必要`）。** 005 (a) では DB に投入済みで、場面に合わない。`reason` の文は全箇所で共通（`src/errors.ts`）なので、この差分では変えず、「この差分の外で見つけたこと」1 にした。案は (A) この差分では変えない / (B) `NEXT_ACTIONS.bulkDownload` に `reason` を渡せるようにして 005 (a) だけ `DB に投入した後の改正を取り直せます` にする。B は実装の小さな変更で済むが、`reason` の文は仕様 ID に書いていないので、仕様の文を足す場所（COMMON-ERRORS か 005）を決める必要がある。**勧める: A（別の Issue）**
7. **承認日と PR 番号。** この proposal.md の front matter の `approved:`（`YYYY-MM-DD`、JST）と `pr:`（`#` を付けない番号）を、shuji がマージの前にこのブランチで書く

## 確かめた値

| 何を                     | 結果                                                                                                                                        | いつ・どうやって                                                           | 使った仕様 ID      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------ |
| 起点                     | main `388353f`、origin の main と同じ。`specs/changes/` は空                                                                                | 2026-10-12 JST、`git ls-remote` と `ls specs/changes/`                     | —                  |
| Issue #164 の本文        | 「期待する形（案）」は上の表のとおり。再現は v0.27.0（dev 版と plugin 版）                                                                  | 2026-10-12 JST、GitHub API                                                 | 変わる仕様 ID      |
| 今の 005 の枝            | `hint` はフラグだけの文、`next_actions` 無し、`available_clauses` は `listAvailableClauses(db, formal, 50)`                                 | `src/tools/handlers.ts` を読んだ                                           | GET-TSUTATSU-005   |
| 今の 010 の枝            | `hint` は番号の形・`nta_search_tsutatsu`・`guideCommand` のコマンド、`next_actions` 2 件、`slice(0, 50)`                                    | `src/tools/handlers.ts` の `renderLiveResult` を読んだ                     | GET-TSUTATSU-010   |
| 027 の「この形にしない」 | 005 の `hint` を「フラグだけを書いた文」として除外している                                                                                  | `specs/current/db_schema/spec.md` を読んだ                                 | DB-SCHEMA-027      |
| 新しい ID                | `SPEC-NTA-GET-TSUTATSU-019`                                                                                                                 | 2026-10-12 JST、`npx spec-ids next specs/current/nta_get_tsutatsu/spec.md` | —                  |
| 既存のテスト             | 005 を名前に持つテストは `handlers.test.ts` に 5 件、`spec-20260927-fetch-paths.test.ts` に 1 件。`hint`・`next_actions` の期待値は持たない | 2026-10-12 JST、grep                                                       | 実装の変更         |
| houki-research-skill     | `available_clauses` の記述は無い                                                                                                            | 2026-10-12 JST、grep                                                       | 互換性             |
| houki-hub の呼び出し例   | `nta_get_tsutatsu.md` 51 行目に国税庁サイトの経路の `available_clauses` の記述                                                              | 2026-10-12 JST、grep                                                       | 呼び出し例への影響 |

## 確かめていない点

1. #164 の再現（`{ name: "消基通", clause: "99-9-9" }`）を実機で流していない（Issue の本文とコードから書いた）。publish の前の確認 2 で確かめる
2. 005 (b) の DB（0.23.x 以前に 4 通達以外を投入したもの）が実際に残っている利用者がいるか
3. 公開版の DB の消基通の条項の総数（publish の前の確認 2 で `sqlite3` で数える）

## この差分の外で見つけたこと

1. **`NEXT_ACTIONS.bulkDownload` の `reason`。** 全箇所で `ローカル DB に未投入のため bulk download が必要` だが、005 (a) は投入済みの通達を取り直す場面で、文が合わない。`reason` の文を仕様に書く場所を決めてから直す（人が判断すること 6）
2. **houki-research-skill の投入の要否の見分け方。** `docs/ERROR-HANDLING.md` 80 行目は `cli_bulk_download` があれば投入が必要、`available_doc_ids` があれば投入済み、と書いている。0.27.1 の 005 (a) は `cli_bulk_download` と `available_clauses` の両方を持つので、`available_clauses` も `available_doc_ids` と同じく「投入は済んでいる」印として足すかを Skill の追随で決める
3. **`describeClauseForm` の文の二重の句点。** 005 (a) と 010 の `hint` は `番号の形は …（例: …）。番号の形を確かめてください` と、文を `。` でつなぐ。`hint` の末尾に打ち切りの文を足すときも同じ `。` でつなぐので、新しい問題ではない

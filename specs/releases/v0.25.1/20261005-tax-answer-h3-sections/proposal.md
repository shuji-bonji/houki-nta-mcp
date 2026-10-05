# 変更: `nta_get_tax_answer` の `sections` で、ページの小見出し h3 も節にし、節ごとに見出しの段（`level`）を返す（nta #147）

- 対象: `specs/current/nta_get_tax_answer/spec.md`（SPEC-NTA-GET-TAX-ANSWER-007・008 を MODIFIED、019 を ADDED）
- 実装の変更: 要（下の「実装の変更」）
- 承認日: 2026-10-05（PR #149）
- 状態: 取り込み済み（v0.25.1。草案は 2026-10-05 JST に案 A から案 B へ組み替えた。下の「組み替えの経緯」）
- 起こした日: 2026-10-05（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #147（`nta_get_tax_answer` の `sections` が、国税庁のページの小見出し h3 を落とし、「概要」の 1 節にまとめてしまう）
- 決定の出典: houki-hub `docs/notes/2026-10-04-plan-stage6-and-followups.md` の「段階 3 の契約の確認の結果」（段階 3c の案と Q15「nta 0.25.1 で先に直す」）と「残りの順序」の 1、`docs/notes/2026-10-05-regression-check-egov-0.20.0-nta-0.25.0.md` の「見つかったこと」1
- 前提: main（`156acfd`、#146 の仕様 PR #148 のマージ後。2026-10-05 JST に `git ls-remote https://github.com/shuji-bonji/houki-nta-mcp refs/heads/main` で origin の main と同じことを確かめた）から切った。`specs/changes/` にはこの差分のほかに `20261005-tax-answer-018-example`（#146、「実装の変更: 不要」、`specs/current/` へは反映済み）だけがある
- 版: 0.25.1（patch）。応答のフィールドは、`taxAnswer.sections` の要素に `level` を足すだけ（T4 の「足すだけ」）。消す・名前を変えるフィールドは無い。DB のスキーマの版は 12 のまま

## なぜ変えるか

`nta_get_tax_answer` は、タックスアンサーのページを見出しごとの節（`taxAnswer.sections`）に分けて返す。節を切る見出しは h2 だけで、h3 は見出しとして読まない。そのため、h3 の見出しの文字列は応答に入らず、h3 の下の段落は直前の h2 の節に続けて入る。

2026-10-05 JST の契約の確認で、No.6101 の `sections` が 7 つから 3 つ（`概要`・`根拠法令等`・`関連リンク`）に減っていた。国税庁が 2026-09-15 にページを更新し（`last-modified: Tue, 15 Sep 2026 08:58:03 GMT`）、「消費税の負担者」などの 4 つの見出しを h2 から h3 に変えたためである（テストの fixture に 2026-05-01 に保存したページでは h2 だった。下の「確かめた値」）。

ただし、h3 を落としているのは No.6101 だけではない。2026-10-05 JST に国税庁の索引の記事から 15 件おきに 50 件のページを見ると、44 件が本文に h3 を持っていた。`last-modified` が 2025-10-22 のページ（No.5436 など）にも h3 があり、2026-05-01 に保存した fixture の No.4102 にも h3 があった。No.6101 は、見出しの形が変わったことで目に見えただけで、ほかの多くの記事では以前から小見出しの文字列が落ちていたと考えられる。

小見出しの境目が分からないと、「申告・納付」の節だけを引用する、といった使い方ができない。No.6101 の `概要` には 26 段落が入り、どこからどこまでが何の話かを読み手が本文から推し量ることになる。

## 今の動き（v0.25.0）

- `src/services/tax-answer-parser.ts` の `extractSections()` は、本文（`div.imp-cnt#bodyArea`）の `h2` を順に見て、次の `h2` までの兄弟要素のうち `p`・`div`・`li` の文字列を段落として集める。`h3` は区切りにも段落にもならない（`h3` の文字列は捨てられ、`h3` の後の `p` は直前の `h2` の節に入る）
- 段落が 0 件の節は作らない。「対象税目」の節は `taxCategory` にし、「サイトマップ」「お問い合わせ先」で始まる見出しは節にしない
- `parseTaxAnswer()` は、`nta_get_tax_answer` の国税庁サイトの経路（`src/tools/handlers.ts`）、`--bulk-download-tax-answer`（`src/services/tax-answer-bulk-downloader.ts`）、`--health-check` のタックスアンサーの代表ページ（`src/services/health-check.ts`）の 3 か所から呼ばれる
- DB の行の `structured_json` はこの結果をそのまま持ち、`full_text` は `buildTaxAnswerFullText()` が `sections` から `【<見出し>】\n<段落>` を連ねて作る。どちらも h3 の見出しの文字列を持たない
- markdown の応答（`src/services/tax-answer-render.ts`）は `sections` の各要素を `## <見出し>` と段落にする

## 変えた後の動き

1. **h2 と h3 のどちらでも節を切る（019）。** 節の段落は、その見出しから次の h2 か h3 の前まで。h3 の段落は上の h2 の節に入らない
2. **`sections` は 1 つの配列のまま、要素に `level` を足す（019・008）。** 見出しがページに現れる順に並べ、h3 の節を h2 の節の中に入れ子にしない。要素のキーは `heading`・`paragraphs`・`level` の 3 つ。`level` は h2 の節が `2`、h3 の節が `3`。h3 の節の親は、配列の中でその前にある最も近い `level: 2` の節
3. **h2 の次の見出しが h3 のときは、その h2 の節を `paragraphs: []` で作る（019）。** 段落が 0 件の節は作らないという今の規則の例外。h2 の見出しの文字列（「手続き」「計算方法・計算式」など）を残すためである。h2 の直後に段落があるとき（No.6101 の「概要」）は今のまま
4. **markdown では h2 の節を `## `、h3 の節を `### ` で書く（007）。** 段落の無い h2 の節は `## <見出し>` の行だけになる
5. **見出しの除外は h3 にも効かせる（019）。** 「サイトマップ」「お問い合わせ先」で始まる h3 も節にしない。h4 以下は今のまま読まない
6. **DB の行の本文（`full_text`）にも h3 の見出しが入る。** `buildTaxAnswerFullText()` は `sections` から作るので、関数を変えずに `【消費税の負担者】` のような行が入る（`level` は本文に入れない）。検索ツールの結果が変わりうる（下の「検索への影響」）
7. **取り込み済みの DB の行は `level: 2` を補って返し、節の分け方は入れ直すまで v0.25.0 のまま（019 の最後の箇条書き）。** 0.25.0 までのパーサーは h2 でしか節を作らないので、`level` の無い節はすべて h2 の節であり、`2` を補うのは事実に合う。入れ直しは `--bulk-download-tax-answer --refresh` を案内する（人が判断すること 4）

### 組み替えの経緯（2026-10-05 JST）

最初の草案（コミット `45e6fab`、PR #149）は Issue の案 A（`sections` を平らに並べ、段を示すキーを足さない）だった。shuji から「h2 と h3 を一緒にしてよいのか」と問われ、次の 2 点から案 B に組み替えた。

- 案 A では、h3 がどの h2 の下の小見出しかが応答に残らない。No.1222 の `対象者` は `対象者または対象物` の下、`申告先等` は `手続き` の下にあるが、見出しの文字列だけでは何についての話か分からない。段落の無い h2 の節も、並びの順だけで「下に h3 が続く」ことを伝えることになる
- 最初の草案は案 B を「既存の DB の行には `level` が無く、入れ直すまで `level` の無い要素と混ざる」として退けたが、これは誤りだった。0.25.0 までのパーサーは h2 でしか節を作らないので、既存の行の節に `level: 2` を補えば事実と合う

### 検索への影響（仕様 ID は変えない）

`nta_search_tax_answer` と `search_rules` の仕様は、DB の本文に何を入れるか（`full_text` の作り方）を約束していない（`specs/current/nta_search_tax_answer/spec.md`・`specs/current/search_rules/spec.md` を `full_text`・`【`・`見出し`・`sections` で探して、該当なし）。そのため仕様 ID は MODIFIED しない。入れ直した行では次が変わりうる。

- h3 の見出しの語で当たるようになる（例: `"消費税の負担者"` で No.6101 が当たる。v0.25.0 では、本文に同じ語が無い記事は当たらない）
- `snippet` に `【<h3 の見出し>】` が入ることがある
- `score`（FTS5 の bm25 から計算）は本文が長くなるので少し変わる。順が入れ替わることがある

## 変わる仕様 ID

| 種類     | 仕様 ID                                                  |
| -------- | -------------------------------------------------------- |
| ADDED    | SPEC-NTA-GET-TAX-ANSWER-019                              |
| MODIFIED | SPEC-NTA-GET-TAX-ANSWER-007、SPEC-NTA-GET-TAX-ANSWER-008 |
| REMOVED  | なし                                                     |

ADDED 1、MODIFIED 2、REMOVED 0。触る dir は `nta_get_tax_answer` だけ。新しい ID は `npx spec-ids next nta_get_tax_answer` で取った（`SPEC-NTA-GET-TAX-ANSWER-019`）。

| ID  | 何を変えるか                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 007 | 「ページの見出し（h2）ごとの節」を「節（019）ごと」にし、`level` 2 の節を `## `、3 の節を `### ` で書くこと、段落の無い節の出し方を足す。法令時点の例を令和 8 年に、例に No.6101 の 7 行を足す |
| 008 | `taxAnswer.sections` の行に、分け方は 019、キーは `heading`・`paragraphs`・`level` の 3 つ、`paragraphs` が空になるのは 019 の h2 の節だけ、を書く。例に v0.25.0 には `level` が無かったことを足す。ほかの行は変えない |
| 019 | 節の切り方・並べ方・`level` の値と親の見分け方・空の h2 の節・除外・経路をまたいで同じこと・取り込み済みの行に `level: 2` を補うこと。例は No.6101・No.1222 の実測、h3 の無いページ、0.25.0 で入れた行 |

Issue の「直し方（案）」との対応: 案 B（h3 も節にし、`sections[].level` に 2 / 3 を足す）。案 A・C と入れ子の案は人が判断すること 1。

## 変わらない振る舞い

- `level` を足すほかの、応答のフィールドの名前と形（T4）。`taxAnswer` の各キー、`sections[]` の要素の `heading`・`paragraphs`、`source`・`index_status`・`orphaned_at`・`notice`・`legal_status`。code も変えない
- h3 の無いページの節の分け方（019 の例 3）。今の fixture `tests/fixtures/www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm`（見出しがすべて h2）での応答は、各節に `level: 2` が付くほかは v0.25.0 と同じ
- 題名・`effectiveDate`・`basisDate`・`taxCategory`・`sourceUrl`・`fetchedAt` の読み方
- URL の決め方（003・016）、DB を先に引くこと（004）、書き戻し（006）、節の構造を持たない行の取り直し（010）、エラー（001・012〜014・017）、ログ（018）
- 段落にする要素（`p`・`div`・`li` の兄弟要素）、空白の整え方
- DB のスキーマ（版 12）。`structured_json` は JSON の文字列なので、節に `level` が入っても列は変わらない。`content_hash` は `title` と `full_text` から計算する（`computeDocumentHash`）ので、`level` を足しただけでは変わらない
- 取り込みの処理の流れ（条件付き取得、304 と同内容の扱い、索引から消えた印）
- 通達・質疑応答事例など、ほかの種別のパーサー

## 互換性（0.25.1 の CHANGELOG の「互換性」の節に書くもの）

| 場面                                             | 0.25.0                                                  | 0.25.1                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| json の `taxAnswer.sections` の要素 | `heading`・`paragraphs` | `heading`・`paragraphs`・`level`（h2 は `2`、h3 は `3`）。キーを足すだけ |
| h3 の小見出しのあるページを国税庁サイトから取る  | h3 の見出しの文字列が落ち、その段落は上の h2 の節に続く | h3 ごとに節ができる（`sections` の要素が増える）                                                                   |
| h2 の直後に h3 が続くページ                      | h2 の節に、下の h3 の段落がすべて入る                   | h2 の節は `paragraphs: []`、段落は各 h3 の節に入る                                                                 |
| markdown の応答 | h2 の `## ` だけ | h2 の節は `## `、h3 の節は `### ` |
| 0.25.0 以前に DB に入れた行 | — | 各節に `level: 2` を補って返す。節の分け方は入れ直すまで 0.25.0 のまま |
| 検索ツールの結果（入れ直した行）                 | —                                                       | h3 の見出しの語で当たる、`snippet`・`score` が変わることがある                                                     |
| `--bulk-download-tax-answer --refresh` の 1 回目 | —                                                       | 多くの記事の本文が変わるので、`⚠ health warning:` の「構造変質の疑い」（更新された文書が 50% を超える）が 1 回出る |
| h3 の無いページ | — | 節の分け方は変わらない。各節に `level: 2` が付く |

CHANGELOG と README に書く案内の文（案）:

> 0.25.1 から、`nta_get_tax_answer` はタックスアンサーのページの小見出し（h3）も節として返し、`taxAnswer.sections` の各要素に見出しの段 `level`（h2 は `2`、h3 は `3`）を付けます。markdown では h3 の節を `### ` で書きます。0.25.0 までは小見出しの文字列が落ち、その段落が上の見出しの節に続けて入っていました。取り込み済みの DB の行は、次のコマンドで入れ直すまで以前の分け方のまま返ります（`level` はすべて `2`）。国税庁のページが変わっていない記事は、`--refresh` を付けないと取り直されません。
>
> ```bash
> npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-tax-answer --refresh
> ```
>
> 約 750 件を 1 件ずつ取るので、15 分ほどかかります。多くの記事の本文が変わるため、終わりに「構造変質の疑い」の `⚠ health warning:` が 1 回出ますが、この入れ直しでは想定どおりです。

## 実装 PR で直す文書

動きを変えない行で、仕様 ID を作らないもの。

| #   | 場所                                                                                                      | 直すこと                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | CHANGELOG 0.25.1 | `Fixed` に #147、`Added` に `sections[].level`。上の「互換性」の表と案内の文。#146（仕様の文だけ）も `Docs` などに 1 行 |
| 2   | README のタックスアンサーの節、またはローカル DB の更新の節                                               | 上の案内の文（入れ直しのコマンド）を 1 段落                                                                     |
| 3   | `llms.txt` の `nta_get_tax_answer` の行 | 節が h2 と h3 の見出しごとで、`level` で段が分かることを 1 文 |
| 4   | `src/types/tax-answer.ts` の `TaxAnswerSection` と `TaxAnswer.sections` の JSDoc | 「h2 見出し」「h2 単位で分割」を「h2・h3 の見出し」にし、`level` の意味、入れ子にしないこと、空の `paragraphs` があることを書く（型そのものの変更は「実装の変更」） |
| 5   | `src/services/tax-answer-parser.ts` の冒頭のコメント（想定する HTML 構造）と `extractSections()` の JSDoc、`tax-answer-render.ts` の JSDoc | h3 の例、`level`、空の h2 の節の規則を書く |
| 6   | houki-hub `scripts/reference-examples/houki-nta/ja/nta_get_tax_answer.md`                                 | publish の後に 0.25.1 の実測で差し替える（v0.24.0 の実測のまま保留中）。houki-hub のブランチで行う              |
| 7   | houki-hub `docs/notes/2026-10-04-plan-stage6-and-followups.md`                                            | 段階 3c の行に「済（日付・PR 番号・コミット）」                                                                 |

tools/list の `description` と `--help` の文は変えない（`src/tools/definitions.ts` に h2 や節の分け方の記述は無い）。

## 実装の変更

- `src/types/tax-answer.ts`: `TaxAnswerSection` に `level: 2 | 3` を足す
- `extractSections()`（`src/services/tax-answer-parser.ts`）
  - 本文の `h2, h3` を文書の順に見る（`$body.find('h2, h3')`）。2026-10-05 JST の No.6101 では、h2 と h3 はどちらも `div#bodyArea` の直下の兄弟で、ページの横の欄の h3（`class="sidenavi-title"`）は本文の外にある
  - 段落を集める走査は、次の `h2` か `h3` で止める
  - 各節に `level`（`h2` は `2`、`h3` は `3`）を入れる
  - 「サイトマップ」「お問い合わせ先」で始まる見出しの除外を h3 にも効かせる
  - 段落が 0 件の節は作らない。ただし h2 で、走査が次の `h3` で止まったときは `{ heading, paragraphs: [], level: 2 }` を作る
- DB から返す経路（`src/tools/handlers.ts` の `structured_json` を読む箇所、今は 1866 行付近の `StoredTaxAnswerStructure`）: 節に `level` が無ければ `2` を補う。json の応答（1925 行付近の `sections: taxAnswer.sections`）と markdown の応答の両方が補った値を使うよう、読んだ直後に補う
- `renderTaxAnswerMarkdown()`（`src/services/tax-answer-render.ts`）: `level` が `3` の節は `### `、それ以外は `## `
- 取り込み（bulk downloader）と書き戻し（handlers）は `parseTaxAnswer()` の結果をそのまま `structured_json` に入れるので、`level` も入る。変える箇所は無い
- `buildTaxAnswerFullText()` は変えない（`level` を本文に入れない）。health-check も変えない
- `--refresh` を付けない投入で、200 が返り本文が同じ（`content_hash` が同じ）記事は、`fetched_at` などだけを書き換え、`structured_json` は書き換えない（`updateDocumentMetaOnly`）。h3 の無い記事ではこの経路で `level` の無い行が残るが、DB から返すときに `2` を補うので応答は正しい
- DB のスキーマ、移行は足さない
- 受入テストの fixture: 2026-10-05 JST の No.6101（h3 あり）と No.1222（h2 の直後に h3）のページを新しく保存する案。既存の `..._shohi_6101.htm`（h2 だけ）は 019 の例 3 に使えるので残す。既存の `..._sozoku_4102.htm`（h3 あり、2026-05-01 保存）はどのテストからも使われていない。fixture をどう取るかは Test Designer が決める

## publish の前の確認

計画書 5.2 のとおり、0.25.1 は応答のフィールドを変えないので、47 例すべてではなく、タックスアンサーの 2 ツールの例を流す。shuji の Mac で行う。取り込みの処理（パーサー）を変えるので、CONTRIBUTING.md の「ローカル DB を使う開発」のとおり、公開版の `cache.db` とは別の DB で試す。

1. 受入テスト（019 の例 1〜4、007・008 の `sections` の行）が `npm test` で通り、`npx spec-ids check` と `npm run check` が通る
2. 公開版の DB で、入れ直す前の値を出しておく（読むだけ。下の「shuji に Mac で実行してもらう SQL」の 1〜3）
3. 公開版の DB を開発用に写す: `sqlite3 ~/.cache/houki-nta-mcp/cache.db ".backup '$HOME/.cache/houki-nta-mcp/cache.dev.db'"`。以後、シェルと houki-nta-dev（Claude Desktop の手元のビルドを指す MCP）の `env` の両方で `HOUKI_NTA_DB_PATH` を `cache.dev.db` の絶対パスにし、`node dist/index.js --status` の 2 行目が `cache.dev.db` であることを確かめる
4. 作業コピーで `npm run build` し、入れ直す前の `cache.dev.db` に向けた houki-nta-dev で、houki-hub `scripts/reference-examples/houki-nta/ja/nta_get_tax_answer.md` の例（No.6101）を流す。DB の行は 0.25.0 で作ったものなので、`sections` は 3 つのまま（019 の最後の箇条書き）であることを確かめる 各節に `level: 2` が付くことも確かめる（019 の例 4）
5. `node dist/index.js --bulk-download-tax-answer --refresh`（約 15 分）。終わりの `完了:` の行の `更新:` の件数と、`⚠ health warning:` の「構造変質の疑い」が出たかを記録する
6. 同じ例をもう一度流し、`source: "db"` で `sections` が 7 つ（`概要`（`level` 2）・`消費税の負担者`・`課税のしくみ`・`申告・納付`・`納税事務の負担軽減措置等`（以上 4 つは `level` 3）・`根拠法令等`・`関連リンク`（`level` 2））に戻ることを確かめる。markdown の例があれば、`## ` の行が 3 つ、`### ` の行が 4 つになることも確かめる
7. 国税庁サイトの経路: `cache.dev.db` で `DELETE FROM document WHERE doc_type = 'tax-answer' AND doc_id = '6101';` を実行してから `{ no: "6101", format: "json" }` を呼び、`source: "live"` で 7 つ、もう一度呼んで `source: "db"` で 7 つ（006）を確かめる
8. houki-hub `scripts/reference-examples/houki-nta/ja/nta_search_tax_answer.md` の例（医療費控除）を、`cache.dev.db` の houki-nta-dev と、公開版の DB の plugin（0.25.0）で同じ引数で呼び、`results` の件数・`docId`・順・`score`・`snippet` を比べる。違いがあれば例ごとに書く（入れ直した行の `full_text` が変わるので、`score` と `snippet` は変わりうる。「変えた後の動き」6）
9. `cache.dev.db` で下の SQL の 1〜3 をもう一度流す。1 は No.6101 を返し、2 の `sections` は入れ直す前の 2685 より増え、`no_structured` は 1 のまま（文書 ID が空の行。`--refresh` でも作り直さない）、3 は 6101 が 7・1222 が 12・4102 が 5 になる（019 の例 1・例 2 と、「確かめた値」のパーサーの写しの 4102 の値）
10. 結果（日時・SQL の結果・比べた例の数・health warning の有無）を実装 PR の本文に書く。呼び出し例の差し替えは publish の後に houki-hub で行う（「実装 PR で直す文書」6）

### shuji に Mac で実行してもらう SQL

公開版の DB（`~/.cache/houki-nta-mcp/cache.db`）に対して、MCP サーバーと CLI を止めずに実行できる（どれも `SELECT` だけで、行は変えない）。`sqlite3 ~/.cache/houki-nta-mcp/cache.db` で開く。`-readonly` は付けない: この DB は WAL モード（`src/db/schema.ts` の `PRAGMA journal_mode = WAL`）で、DB を開いているプロセスが無く `cache.db-shm` が無いときは、読み取り専用の接続が `-shm` を作れず `unable to open database file (14)` になる（2026-10-05 JST に shuji の Mac で起きた）

```sql
-- 1. Issue の確かめ方: full_text に小見出しの文字列が残っているか（0 件なら落ちている）
SELECT doc_id, fetched_at FROM document
WHERE doc_type = 'tax-answer' AND full_text LIKE '%消費税の負担者%';

-- 2. タックスアンサーの行の数、sections の合計、構造の記録が無い行、索引から消えた行
SELECT COUNT(*) AS rows,
       SUM(json_array_length(structured_json, '$.sections')) AS sections,
       SUM(structured_json IS NULL) AS no_structured,
       SUM(orphaned_at IS NOT NULL) AS orphaned
FROM document WHERE doc_type = 'tax-answer';

-- 3. 例に使う 3 記事の今の行（節の数と、条件付き取得に使う値）
SELECT doc_id, fetched_at, last_modified, etag,
       json_array_length(structured_json, '$.sections') AS sections
FROM document
WHERE doc_type = 'tax-answer' AND doc_id IN ('6101', '1222', '4102');
```

2026-10-05 JST の結果は「確かめた値」の「shuji の DB（入れ直す前）」の行に書いた。

## 取り込みのとき（Publisher）

- `specs/current/nta_get_tax_answer/spec.md` の SPEC-NTA-GET-TAX-ANSWER-007・008 を、見出しの行（題）も含めて差分の見出しと本文に置き換え、019 を「できること」の末尾（018 の後）に足す
- 差分の spec.md の冒頭の指示のとおり、「関連する Issue」に `#147` を足す
- `specs/current/nta_get_tax_answer/spec.md` の承認日の行に「差分 `20261005-tax-answer-h3-sections` は YYYY-MM-DD（PR #N）」を足す
- この差分のフォルダーを `specs/releases/v0.25.1/20261005-tax-answer-h3-sections/` へ移し（`git mv`）、この proposal.md の「状態」を取り込み済みにする
- **#146 の差分 `specs/changes/20261005-tax-answer-018-example/` も、同じ実装 PR の最終コミットで `specs/releases/v0.25.1/20261005-tax-answer-018-example/` へ移す。** その proposal.md の「状態」を「取り込み済み（`specs/current/` へは仕様 PR #148 の中で反映。v0.25.1 の実装 PR の最終コミットで `specs/releases/v0.25.1/` へ移した）」にする（その proposal.md の「取り込みのとき」のとおり）
- 取り込みの後、`specs/changes/` には `.gitkeep` だけが残ることを確かめる
- `Closes #147` は実装 PR の本文に書く。#146 は仕様 PR #148 で閉じていなければ、実装 PR の本文に `Closes #146` を足す
- 計画書の段階 3c の行に「済（日付・PR 番号・コミット）」を書く

## 人が判断すること

1. **直し方は Issue の案 B（019・008）。** h3 も節の区切りにし、`sections` は 1 つの配列のまま、要素に `level`（2 / 3）を足す。代わりの案: 案 A（段を示すキーを足さない）は h3 がどの h2 の下かが応答に残らない（「組み替えの経緯」）。案 C（h3 の文字列を `paragraphs` の 1 段落として入れる）は見出しと本文の段落を区別できない。入れ子（h2 の節に `subsections` を足し、h3 の節をその中に入れる）は、h3 の本文が h2 の `paragraphs` から消えるので、今 `paragraphs` だけを読んでいる利用者には内容が欠けて見える。**勧める: B**
2. **h2 の次の見出しが h3 のときは、その h2 の節を `paragraphs: []` で作る（019）。** 2026-10-05 JST に見た 50 件のうち 20 件にこの形があった（`手続き` 7・`計算方法・計算式` 7・`概要` 6・`対象者または対象物` 5・`具体例` 1・`対象期間` 1）。代わりの案は (b) 今の規則のまま作らない（v0.25.0 で返していた「手続き」などの h2 の見出しが新たに消える）、(c) h3 の見出しに h2 をつなげる（例: `手続き／申告等の方法`。ページに無い文字列を作り、`heading` の値の意味が要素によって変わる）。(a) は `paragraphs` が空の要素を返すようになるが、008 の今の文は空を禁じていない。**勧める: (a) 空の節を作る**
3. **markdown の h3 の節は `### `（007）。** `level` があるので、DB から返す記事でも国税庁サイトから取った記事でも同じ markdown になる。今の 007 の例 `## 課税のしくみ` は、No.6101 では h3 なので `### 課税のしくみ` に変わる（007 の例を置き換えた）。**勧める: `### `**
4. **取り込み済みの DB の行は、`--bulk-download-tax-answer --refresh` を CHANGELOG と README で案内する（入れ直しの案内）。** `--refresh` の無い投入では直らない: 取り込みの処理は、前回の `last_modified` / `etag` で条件付き取得をし、304 なら `fetched_at` だけを書き換えてパースしない（`tax-answer-bulk-downloader.ts` の `if (fetched.notModified)`）。No.6101 は 2026-10-05 JST に `If-None-Match` と `If-Modified-Since` のどちらにも 304 を返した。`--refresh` を付けると条件付き取得を使わず、全件をパースし直して書き込む（SPEC-NTA-CLI-REFRESH-002、`forceReload` で `state` が `null` になり、同内容の比較も飛ばす）。代わりの案:
   - (版の記録) パーサーの版を DB に記録し、古い版の行を 010 と同じく取り直す。スキーマの版を上げることになり（版 13）、0.23.x 以前で開くと全テーブルを消す問題（CONTRIBUTING.md の表）も絡むので patch では重い
   - (見分けて取り直す) `nta_get_tax_answer` が DB の行を返すときに、h3 を落とした形かを見分けて取り直す。DB の行には h3 の位置が残っていない（h3 の段落は上の h2 の節に入っている）ので、行だけからは見分けられない。見分けるには、`structured_json` に分け方の印（例: `"sectionRule": 2`）を足し、印の無い行を 010 と同じく取り直す形になる（印の案）。スキーマの版は上げずに済むが、直るのは `nta_get_tax_answer` で呼んだ記事だけで、検索の本文（`full_text`）は直らない。最初の呼び出しが国税庁サイトへ行くことになる（`source: "live"`）
   - **勧める: 入れ直しの案内。** 1 回の入れ直しで取得と検索の両方が直る。印の案は、利用者が入れ直さない場合の保険として 0.26.0 で検討する余地がある
5. **検索ツールの仕様 ID は MODIFIED しない。** `nta_search_tax_answer` と `search_rules` は `full_text` の作り方を約束していない（「変えた後の動き」の「検索への影響」）。h3 の見出しの語で当たることを仕様にするなら、search_rules に ID を足す差分が別に要る（受入テストも要る）。**勧める: MODIFIED しない。CHANGELOG の互換性に書くだけにする**
6. **`--health-check` のタックスアンサーの代表ページの確かめ方に、節の数の検査を足すか。** 今は No.6101 をパースして `title` が取れれば `ok`。足す案は「`sections` が 4 つ以上」（h2 と h3 のどちらで書かれても通り、小見出しの文字列が落ちると `fail` になる）。ただし、`--health-check` の動きと表示は cli_health_check の「未決」1（仕様 ID もテストも無い）で、足すなら ADDED の ID とテストが要り、0.25.1 の範囲が広がる。また、今回の劣化は契約の確認（呼び出し例の流し直し）で見つかっており、h3 を以前から持っていた多くの記事の欠けは、この検査では見つからない（No.6101 の h2 から h3 への変化だけを捕まえる）。**勧める: 0.25.1 では足さない。** 代わりに、cli_health_check の未決 1 を受入テストにするときに一緒に決める（Issue にするかを shuji が決める）
7. **版は 0.25.1（patch）。** フィールドを足すのは、これまでは minor にしていた（0.25.0 の `freshness.db_path`）。ただし今回の `level` は、h3 の節を足すことで失われる親子関係を補うためのもので、不具合の直し方の一部である。足すだけなので今の利用者は壊れない。代わりの案は 0.26.0（minor）にして #144・#145 とまとめる（今も小見出しの欠けた内容を返している期間が延びる）。**勧める: 0.25.1。** CHANGELOG の `Added` に `level` を書く
8. **019 を新しく立て、007・008 は 019 を指す形にする。** 代わりの案は 008 の `sections` の行に規則を全部書く（ID は増えないが、markdown（007）と json（008）で同じ規則を 2 回書くことになり、テストも 2 か所に分かれる）。**勧める: 019 を立てる**
9. **`level` の値は HTML の見出しの段（2 / 3）にする（019）。** 代わりの案は、記事の中の相対的な段（1 / 2）や、名前を `depth`・`headingLevel` にすること。ページの h2・h3 とそのまま対応し、h4 を読むようにしたときも `4` を足すだけで済む。**勧める: `level` で 2 / 3**
10. **承認日。** この proposal.md の「- 承認日:」は 2026-10-05（PR #149）と書かれているが、案 A の草案に対するもの。案 B の内容で承認するときに日付を確かめ直す（shuji がマージの前に）

## 確かめた値

| 何を                                              | 結果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | いつ・どうやって                                                                                                                                                           | 使った仕様 ID                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| No.6101 の今のページ                              | 200、`last-modified: Tue, 15 Sep 2026 08:58:03 GMT`、`etag: "485e-65b81bf927820"`。本文（`div.imp-cnt#bodyArea`）の見出しの順は h2 `対象税目` → h2 `概要` → h3 `消費税の負担者`・`課税のしくみ`・`申告・納付`・`納税事務の負担軽減措置等` → h2 `根拠法令等`・`関連リンク`・`お問い合わせ先`。h2 と h3 はどれも `div#bodyArea` の直下。横の欄の h3（`class="sidenavi-title"`）は本文の外                                                                                                                                                                                                                                                                                           | 2026-10-05 10:11 JST（01:11 +00:00）、Cowork の VM から `curl` で取り、houki-nta-mcp の `node_modules/cheerio` で `#bodyArea` の `h2, h3` と親要素を列挙した               | 019 の例 1                                      |
| No.6101 の条件付き取得                            | `If-None-Match: "485e-65b81bf927820"` も `If-Modified-Since: Tue, 15 Sep 2026 08:58:03 GMT` も 304                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 2026-10-05 10:15 JST、VM から `curl`                                                                                                                                       | 人が判断すること 4                              |
| 以前の No.6101                                    | `tests/fixtures/www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm`（コミット `1453cc0`、2026-05-01）の見出しは、`消費税の負担者` など 4 つも h2 で、h3 は無い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 上と同じ方法で fixture を列挙した                                                                                                                                          | なぜ変えるか、019 の例 3                        |
| 以前から h3 があったページ                        | `tests/fixtures/www.nta.go.jp_taxes_shiraberu_taxanswer_sozoku_4102.htm`（同じく 2026-05-01）に h3 が 2 つ（`基礎控除額と正味の遺産額`・`相続税の納税義務者と課税財産`、h2 `概要` の下）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 上と同じ方法                                                                                                                                                               | なぜ変えるか                                    |
| h3 を持つ記事の割合（標本）                       | 索引（`/taxes/shiraberu/taxanswer/code/`）の記事 749 件から 15 件おきに 50 件を取ると、本文に h3 があるのは 44 件、h2 の次の見出しが h3 の節があるのは 20 件、h4 は 0 件、`#bodyArea` の直下でない h3 は 0 件。h3 のある 44 件には `last-modified` が 2025-10-22 のページ（hojin/5360・5436・5501・5656・5763）も含む                                                                                                                                                                                                                                                                                                                                                             | 2026-10-05 10:12〜10:13 JST、VM から 1.1 秒あけて取得し、cheerio で数えた                                                                                                  | 人が判断すること 2、なぜ変えるか                |
| v0.25.0 と変えた後の節（パーサーの写し）             | No.6101: v0.25.0 は `概要`（26）・`根拠法令等`（1）・`関連リンク`（8）、変えた後は 019 の例 1 の 7 つ。No.1222: 019 の例 2 のとおり。fixture の 4102: v0.25.0 は `概要`（15）・`根拠法令等`（1）・`関連リンク`（16）、変えた後は `概要`（4）・`基礎控除額と正味の遺産額`（6）・`相続税の納税義務者と課税財産`（5）・`根拠法令等`（1）・`関連リンク`（16）。fixture の 6101（h2 だけ）: 両方とも同じ 7 つ                                                                                                                                                                                                                                                                                | `extractSections()` と `cleanText()` を JavaScript に写した使い捨てのスクリプト（h2 だけ / h2・h3 と空の h2 の規則。写しは案 A のときに作ったもので `level` を出さないが、節の分け方は案 B と同じ）で、上の HTML を解析した。実装そのものは動かしていない | 019 の例 1〜3                                   |
| `parseTaxAnswer()` を呼ぶ箇所                     | `src/tools/handlers.ts`（国税庁サイトの経路）、`src/services/tax-answer-bulk-downloader.ts`、`src/services/health-check.ts` の 3 か所                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | main `156acfd` を grep した                                                                                                                                                | 019 の経路の箇条書き                            |
| `full_text` の作り方                              | `buildTaxAnswerFullText()` は `sections` から `【<見出し>】\n<段落>` を連ねる。取り込みと書き戻しで共有                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | main `156acfd` の `src/services/tax-answer-parser.ts` を読んだ                                                                                                             | 変えた後の動き 6                                |
| 投入の 304 の扱いと `--refresh`                   | 304 なら `fetched_at` だけを書き換えてパースしない。`--refresh`（`forceReload`）では前回の状態を読まず、全件を書き込む。「更新された文書」は投入の前後の `content_hash` の差で数え、50% を超えると「構造変質の疑い」                                                                                                                                                                                                                                                                                                                                                                                                                                                              | main `156acfd` の `src/services/tax-answer-bulk-downloader.ts`・`document-conditional-fetch.ts`・`bulk-aggregation.ts`・`health-thresholds.ts` を読んだ                    | 人が判断すること 4、互換性                      |
| 検索の仕様が `full_text` の作り方を約束しているか | していない（`specs/current/nta_search_tax_answer/spec.md`・`search_rules/spec.md` に `full_text`・`【`・`sections`・`見出し` の約束は無い）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | main `156acfd` の `specs/current/` を grep した                                                                                                                            | 人が判断すること 5                              |
| shuji の DB（入れ直す前）                         | 1: 0 件（No.6101 の `full_text` に「消費税の負担者」が無い）。2: `rows` 750・`sections` 2685・`no_structured` 1・`orphaned` 1。3: 1222 は `fetched_at` `2026-10-04T03:37:42.070Z`・`last_modified` `Wed, 09 Sep 2026 01:00:12 GMT`・`sections` 7、4102 は `2026-10-04T03:43:40.684Z`・`Mon, 07 Sep 2026 08:30:08 GMT`・3、6101 は `2026-10-04T03:47:44.159Z`・`Tue, 15 Sep 2026 08:58:03 GMT`（`etag` `"485e-65b81bf927820"`）・3。3 記事の `sections` は、パーサーの写しの v0.25.0 の値（1222 は 7、4102 は 3、6101 は 3）と同じ。6101 の `last_modified` と `etag` は、2026-10-05 JST に国税庁サイトが返した値と同じなので、`--refresh` の無い投入では 304 になり入れ直されない | 2026-10-05 JST、shuji が Mac の `~/.cache/houki-nta-mcp/cache.db`（0.25.0 で 2026-10-04 に取り込んだもの）で「shuji に Mac で実行してもらう SQL」の 1〜3 を実行した        | 019、人が判断すること 4、publish の前の確認の 9 |
| 既存のテストへの影響 | `sections` を確かめる既存のテストは、件数が 1 以上（`handlers.test.ts`）と、国税庁サイトから取ったときと DB から返したときで件数が同じ（`get-db-first.test.ts`）だけで、どちらも h2 だけの 6101 の fixture を使う。`sections` を `toEqual` などで丸ごと比べるテストは無い。`spec-20261003-t4-response-shape.test.ts` は `level` の無い節（`{ heading: '概要', paragraphs: [...] }`）を DB に入れており、019 の例 4（`level: 2` を補う）の形そのものになっている。どれも案 B で落ちない見込み | `src/**/*.test.ts` を `sections`・`heading`・`4102`・`parseTaxAnswer` で grep した。テストは流していない | 実装 PR、019 の例 4 |
| `npx spec-ids check` と `pr-scope`                | spec-ids: `current: 22 files, 273 IDs / changes: 1 files, 3 IDs`、`tests: 64 files, 273 IDs`、`OK`（exit 0）。pr-scope: 承認日と PR 番号が無いことだけを報告（exit 1。人がマージの前に書く）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 2026-10-05 JST、このブランチで `npx spec-ids check` と `BASE_REF=main HEAD_REF=spec/20261005-tax-answer-h3-sections node .github/scripts/check-pr-scope.mjs`               | —                                               |

## 確かめていない点

- 750 件すべてのうち h3 を持つ記事の数（標本 50 件で 44 件）。入れ直した後に SQL の 2 の `sections` の合計（入れ直す前 2685、1 記事あたり約 3.6）がどれだけ増えるかで、間接に分かる
- `--bulk-download-tax-answer --refresh` の所要時間（約 750 件 × 1.1 秒からの見込みで約 14 分）と、`⚠ health warning:` が実際に出るか
- h3 の後に `ul` / `ol` / `table` が直接続くページで、段落が欠けるか（今の走査は兄弟の `p`・`div`・`li` だけを集め、`ul` の中の `li` は集めない。h2 の節でも同じで、この差分では変えない）
- 入れ直した後の `nta_search_tax_answer` の `score` と順の実際の変わり方
- 受入テスト・既存のテストを流していない（Steward はテストを書かない）

## この差分の外で見つけたこと

- 小見出しの文字列の欠けは No.6101 だけでなく、標本では 9 割近い記事で以前から起きていた。2026-09 までの呼び出し例は、No.6101 がたまたま h2 で書かれていたので、欠けが見えなかった。呼び出し例にもう 1 件（h3 を以前から持つ記事。例: No.4102 か No.1222）を足すと、次から同じ欠けを見つけやすい（houki-hub 側で決める）
- `--health-check` の代表ページの検査は「パースが例外を出さず題名が取れる」だけで、見出しの欠けは捕まえない（人が判断すること 6）

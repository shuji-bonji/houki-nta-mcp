# 変更: DB に入れる値と保存するファイル名の扱いを直す（#73）

- 対象: `specs/current/nta_get_tax_answer/spec.md`、`specs/current/nta_get_kaisei_tsutatsu/spec.md`、`specs/current/nta_inspect_pdf_meta/spec.md`、`specs/current/nta_get_jimu_unei/spec.md`、`specs/current/nta_get_bunshokaitou/spec.md`
- 実装の変更: 要
- 承認日: 2026-09-30（PR #104）
- 状態: 取り込み済み。実装は v0.21.3、`specs/current/` への取り込みは 2026-09-30（JST、v0.21.3 の後の取り込みコミット）
- 起こした日: 2026-09-30（JST）
- 起こした役: Spec Steward
- 関連: houki-nta-mcp #73（DB に入れる値と保存するファイル名の扱い）、#29（取得ツールの DB の使い方）、#36（`save: true`）、#44（「別紙 N」を新旧対照表として扱う）、#74（未決を Issue に移した仕様 PR）

## なぜ変えるか

#73 に挙がった 3 件を、コードとテストと国税庁サイトの実ページで調べた。3 件とも、応答が一見正しく見えるまま、DB の行か保存したファイルが求めたものと違う状態になる。意図として残す理由が無いので、不具合として直す。

1. **`nta_get_tax_answer` の `taxAnswer.no` をページの見出しから読む。** 見出しが `No.<番号> <題名>` の形でないとき、`no` は空文字になり、国税庁サイトから取った記事を DB に書き戻す行の文書 ID も空文字、税目も無しになる。空の文書 ID の行は、同じ番号をもう一度求めても引けない（毎回国税庁サイトへ取りに行く）うえ、`nta_search_tax_answer` の結果に `docId: ""` として現れる。bulk download は索引の URL から番号を取って文書 ID にしているので、同じ記事でも入口によって行の鍵が変わることになる。呼び出しは引数の `no` で番号を受け取り、その番号でページの URL を組み立てているので、番号の出どころは引数でよい。
2. **`nta_get_kaisei_tsutatsu` が `kind` の無い添付 PDF に `kind` を補わない。** v0.6.0 までに入れた行の添付 PDF は `kind` を持たない。`nta_inspect_pdf_meta` は題名から `kind` を決めて返す（SPEC-NTA-INSPECT-PDF-META-003）が、`nta_get_kaisei_tsutatsu` は「別紙 N」の付け替え（SPEC-NTA-GET-KAISEI-TSUTATSU-007）だけを行い、`kind` の無い PDF は json では `kind` が無いまま、markdown では「その他」の行になる。同じ文書を 2 つのツールで見ると種別が食い違う。SPEC-NTA-GET-KAISEI-TSUTATSU-006 は `document.attachedPdfs` の要素が `kind` を持つと書いている。
3. **`nta_inspect_pdf_meta` の保存ファイル名を URL の最後のパス要素だけで決める。** 同じ文書の添付 PDF に、最後のパス要素が同じで途中のディレクトリが違う URL（`…/0026003-067/pdf/01.pdf` と `…/0026003-068/pdf/01.pdf` など。国税庁サイトの改正通達の PDF は `<docId>/pdf/01.pdf` の形が多い）があると、2 つ目は保存先に同じパスのファイルがあるため取得されず、1 つ目のファイルを `cached: true` で返す。`saved[].url` は 2 つ目の URL なのに `path` の中身は 1 つ目の PDF で、利用者（LLM）には見分けがつかない。

## 変わる振る舞い

- `nta_get_tax_answer`: `taxAnswer.no` は引数の `no`（前後の空白を除いたもの）になる。ページの見出しに `No.` が無くても、応答の番号・markdown の見出し・DB に書き戻す行の文書 ID と税目は `no` から決まる。DB から返すときも、行に記録された番号が空なら `no` で埋める（008 MODIFIED、011 ADDED）
- `nta_get_kaisei_tsutatsu`: `kind` の無い添付 PDF は、題名から `kind` を決めて返す。判定は SPEC-NTA-INSPECT-PDF-META-003 と同じ。「別紙 N」の付け替え（007）はその後に行う。json では全要素に `kind` が付き、markdown の表と `### 読み方` では「その他」ではなく決めた種別になる。DB は書き換えない（005・006 MODIFIED、008 ADDED）
- `nta_get_jimu_unei`・`nta_get_bunshokaitou`: `kind` の無い添付 PDF は、`nta_get_kaisei_tsutatsu` と同じく題名から `kind` を決めて返す（「別紙 N」の付け替えは行わない）。json では全要素に `kind` が付き、markdown の表と `### 読み方` では決めた種別になる（jimu-unei 007 MODIFIED、008 ADDED / bunshokaitou 005・006 MODIFIED、008 ADDED。2026-09-30 の判断 3 で追加）
- `nta_inspect_pdf_meta`: 保存ファイル名は、その文書の添付 PDF 全体（`kind` で絞る前）の中で最後のパス要素が他と重ならなければ最後のパス要素のまま、重なるときは重ならなくなるまで前のパス要素を `_` でつないで付ける。同じ URL は絞り方によらず同じファイル名になる（010 MODIFIED、`## 入力` の保存先の説明、018 ADDED）

## 変わらない振る舞い

- `nta_get_tax_answer` の引数の検査、DB を先に引くこと、書き戻し、索引から外れた印（001〜007、009、010）
- 見出しが `No.<番号> <題名>` の形のページでは、応答は今までと同じ（引数の `no` と見出しの番号が同じため）
- `nta_get_kaisei_tsutatsu` の 001〜004、007 と、`kind` を持つ添付 PDF の応答
- `nta_inspect_pdf_meta` の 001〜009、011〜017。最後のパス要素が文書の中で重ならない PDF の保存先（010 の例のとおり）。既に保存したファイルはそのまま使われる（013）
- DB のスキーマ（db_schema の spec.md）。3 件とも DB の行を書き換えずに応答で直すか、書き戻すときに正しい値を入れるかで済む

## 既存の DB の行の扱い

| 状態                                                                     | 起きる条件                                                                                                | 扱い                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `structured_json` の `no` が空のタックスアンサーの行（文書 ID は正しい） | bulk download で、見出しに `No.` の無いページを取り込んだとき                                             | 応答のときに引数の `no` で埋める（011）。移行も `--refresh` も要らない                                                                                                                                                                                                                                         |
| 文書 ID が空のタックスアンサーの行                                       | v0.16.0 以降の `nta_get_tax_answer` が、見出しに `No.` の無いページを国税庁サイトから取って書き戻したとき | この差分では直さない。2026-09-30 に確かめた範囲では国税庁サイトのタックスアンサーの見出しはすべて `No.<番号> <題名>` の形で、この行ができる条件は今の国税庁サイトでは満たされない。もしあれば `sqlite3` で `DELETE FROM document WHERE doc_type = 'tax-answer' AND doc_id = ''` で消せる（人が判断すること 2） |
| `kind` の無い添付 PDF を持つ改正通達の行                                 | v0.6.0 までの bulk download                                                                               | 応答のときに題名から決める（008）。`--refresh` は本文が同じ行の `attached_pdfs_json` を書き換えないので直らないが、直す必要も無い                                                                                                                                                                              |

## 足す仕様 ID（ADDED、5 件）

| 仕様 ID                          | 内容                                                                    | 元の未決                        |
| -------------------------------- | ----------------------------------------------------------------------- | ------------------------------- |
| SPEC-NTA-GET-TAX-ANSWER-011      | 記事番号は引数の `no` で決め、応答と DB の行に空の番号を入れない        | nta_get_tax_answer 9            |
| SPEC-NTA-GET-KAISEI-TSUTATSU-008 | `kind` の無い添付 PDF は題名から `kind` を決めて返す                    | nta_get_kaisei_tsutatsu 5       |
| SPEC-NTA-INSPECT-PDF-META-018    | 同じ文書の中で最後のパス要素が同じ URL は、前のパス要素を付けて区別する | nta_inspect_pdf_meta 6          |
| SPEC-NTA-GET-JIMU-UNEI-008       | `kind` の無い添付 PDF は題名から `kind` を決めて返す                    | （未決には無い。判断 3 で追加） |
| SPEC-NTA-GET-BUNSHOKAITOU-008    | `kind` の無い添付 PDF は題名から `kind` を決めて返す                    | （同上）                        |

## 変える仕様 ID（MODIFIED、7 件）

| 仕様 ID                          | 変えるところ                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| SPEC-NTA-GET-TAX-ANSWER-008      | `taxAnswer.no` の説明を「ページの見出しから読んだもの」から「引数の `no`」にする                                  |
| SPEC-NTA-GET-KAISEI-TSUTATSU-005 | 添付 PDF の表の種別を「008 で補い、007 で付け替えた後のもの」にする                                               |
| SPEC-NTA-GET-KAISEI-TSUTATSU-006 | `document.attachedPdfs` の `kind` を「008 で補い、007 で付け替えた後のもの。全要素に付く」にする                  |
| SPEC-NTA-INSPECT-PDF-META-010    | 保存先のパスの最後を「ファイル名（018）」にし、最後のパス要素は他と重ならないときの形にする                       |
| SPEC-NTA-GET-JIMU-UNEI-007       | `document.attachedPdfs` の `kind` を「全要素に付く（008 で補う）」にし、markdown の表の種別も補った後のものにする |
| SPEC-NTA-GET-BUNSHOKAITOU-005    | 添付 PDF の節の種別を「008 で補った後のもの」にする                                                               |
| SPEC-NTA-GET-BUNSHOKAITOU-006    | `document.attachedPdfs` の `kind` を「全要素に付く（008 で補う）」にする                                          |

`nta_inspect_pdf_meta` の `## 入力` の節も、保存先の説明の 1 文を同じように変える。

## 取り込みのときに消す「未決」

| spec.md                 | 消す未決の番号 |
| ----------------------- | -------------- |
| nta_get_tax_answer      | 9              |
| nta_get_kaisei_tsutatsu | 5              |
| nta_inspect_pdf_meta    | 6              |

## 対象外

- bulk download（`--bulk-download-tax-answer`）が `structured_json` に入れる番号。文書 ID は索引の URL から取っているので、行の鍵は正しい
- 保存した PDF の更新・削除（`nta_inspect_pdf_meta` の「できないこと」のまま）
- 応答の名前の違い（→ houki-nta-mcp #71）

## 取り込みのとき（Publisher）

- ADDED の見出しを、各 `specs/current/<dir>/spec.md` の「できること」の末尾に足す
- MODIFIED の見出しの節を丸ごと置き換える。`nta_inspect_pdf_meta` の `## 入力` の節も置き換える
- 上の表の「未決」の項目を消す。残った項目の番号は変えない
- 「処理の流れ」の図: `nta_get_tax_answer` の「取った記事を DB に入れる（006）」に 011 を足す。`nta_get_kaisei_tsutatsu` の「別紙 N」のノード（007）の前に「kind の無い PDF は題名から kind を決める（008）」を入れる。`nta_inspect_pdf_meta` の「保存先に同じパスのファイルがあるか」の前に「ファイル名を決める（018）」を入れる
- 変わった各 `spec.md` の承認日の行に「差分 `20260930-nta-73-db-values` は YYYY-MM-DD（PR #N）」を足す
- 各 `spec.md` の「起こした元」の版は変えない（取り込みの版は承認日の行で分かる）

## 人が判断すること

1. **承認日。** proposal.md に承認日と PR 番号を書く。
2. **文書 ID が空のタックスアンサーの行を、スキーマの版を上げる移行で消すか。** この差分では消さない。今の国税庁サイトではこの行ができる条件が無く、版を上げると、その DB を v0.21.2 以前で開いたときに全テーブルが作り直される（db_schema の未決 2）ため、患部より大きい影響になる。消す移行が要ると決めたら、db_schema の差分を別に出す。
3. **`nta_get_jimu_unei`・`nta_get_bunshokaitou` にも 008 と同じ補いを入れるか。** → 入れる（2026-09-30 決定）。この差分に 2 つの spec.md の差分を足した。
4. **018 の区切り文字 `_` と「前のパス要素を足す」順。** `pdf_01.pdf` でまだ重なれば `0026003-067_pdf_01.pdf` になる。ホストだけが違う URL は区別しない（同じ文書の添付 PDF は同じホストにあるため）。

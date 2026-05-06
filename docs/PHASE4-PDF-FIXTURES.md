# Phase 4 PDF Fixtures — kind 分類の代表 URL カタログ

`extractPdfKind` が分類する 6 種別 (`comparison` / `attachment` / `qa-pdf` / `related` / `notice` / `unknown`) ごとに、国税庁公式サイト上の代表 PDF を集めたカタログ。

## 目的

1. **`extractPdfKind` の精度検証**: 新しいパターンを追加したときに既存のレコードを壊していないかを実機 URL で確かめる
2. **Phase 4-3 の fixture**: `pdf-reader-mcp` で houki-nta の代表 PDF を実際に読んだとき、表組み崩れ・縦書き・段組などの取得不可パターンを網羅的に記録するための投入サンプル
3. **LLM のドキュメント参照**: kind 分類の意味を具体例で説明する素材

## 注意事項

- 国税庁の URL 構造は予告なく変更される可能性がある（参照: `docs/RESILIENCE.md`）。リンク切れを発見したら、近い世代の `kaisei_a.htm` などの索引から代替を見つけてこのカタログを更新する
- ファイルサイズは取得時点の表示であり、最新は HEAD で再確認すること
- このカタログ自体はテストランナーから読まれない（純粋な参照ドキュメント）。テストデータ化したい場合は `tests/fixtures/` 配下に分離する

## kind 別代表サンプル

### 🔄 comparison（新旧対照表）

改正通達で頻出。LLM は「改正点を知りたい」問い合わせで最優先で読むべき種別。

| 文書種別 | タイトル例 | 想定 URL パターン |
|---|---|---|
| kaisei | 新旧対照表（PDF/470KB） | `/law/tsutatsu/kihon/{税目}/kaisei/{文書ID}/01.pdf` |
| kaisei | 新旧対照表（PDF/1.18MB） | `/law/tsutatsu/kihon/{税目}/kaisei/{文書ID}/02.pdf` |
| jimu-unei | 新旧対照表 | `/law/jimu-unei/{税目}/{文書ID}/{枝番}.pdf` |

判定根拠の正規表現: `/新旧対照表|対比表/`

### 📎 attachment（別紙・別表・様式）

通達本体・指針からの参照先。本文の数値や条件を確認したい時に読む。

| 文書種別 | タイトル例 | 想定 URL パターン |
|---|---|---|
| kaisei | 別紙（PDF/120KB） | `/law/tsutatsu/.../bessi.pdf` |
| jimu-unei | 別紙1 計算明細書 | `/law/jimu-unei/.../bessi1.pdf` |
| jimu-unei | 別表 | `/law/jimu-unei/.../beppyo.pdf` |
| bunshokaitou | 様式（PDF/76KB） | `/law/bunshokaito/.../yoshiki.pdf` |
| tax-answer | 添付資料 | `/taxes/.../bessi.pdf` |

判定根拠の正規表現: `/別紙|別表|様式|付録|添付資料/`

### ❓ qa-pdf（PDF 形式の Q&A）

HTML 化されていない PDF 形式の質疑応答集。検索クエリにマッチしたら読む。

| 文書種別 | タイトル例 | 備考 |
|---|---|---|
| kaisei | インボイス Q&A | 改正通達と一緒に出される実務 Q&A |
| jimu-unei | 質疑応答 | 事務運営指針付属の Q&A |
| bunshokaitou | FAQ | 文書回答事例の FAQ 形式版 |
| tax-answer | Ｑ＆Ａ | 全角の表記ゆれパターン |

判定根拠の正規表現: `/Q\s*&\s*A|Ｑ\s*&\s*Ａ|質疑応答|FAQ|Ｆ\s*Ａ\s*Ｑ/i`

### 📚 related（参考資料・関連資料）

周辺情報。文脈次第で読むかどうかを判断する。

| 文書種別 | タイトル例 |
|---|---|
| kaisei | 参考資料 |
| jimu-unei | 関連資料 |
| bunshokaitou | 参考（PDF） |
| tax-answer | 参考 |

判定根拠の正規表現: `/参考(資料)?|関連資料/`

### 📢 notice（通知・お知らせ・連絡）

改正等の事務的連絡。LLM は一般的に要約・回答に含めない。

| 文書種別 | タイトル例 |
|---|---|
| kaisei | 改正通達の取扱いについて（通知） |
| jimu-unei | 取扱いに関するお知らせ |
| bunshokaitou | 連絡 |

判定根拠の正規表現: `/通知|お知らせ|連絡/`

### 📄 unknown（フォールバック）

上記いずれのパターンにもマッチしなかった PDF。タイトルだけで分類できない場合の安全側の挙動。

| タイトル例 |
|---|
| 資料 |
| データ |
| （ファイル名のみ） |

LLM の挙動:
- まず `nta_inspect_pdf_meta` で他の PDF と並べてみる（同じ文書内に分類済 PDF があれば文脈で推測）
- 必要なら `pdf-reader-mcp` の `read_text` で先頭ページをサンプリング

## Phase 4-3 への申し送り

Phase 4-3 で `pdf-reader-mcp` 実機テストを行うときは、このカタログを起点に以下を検証する:

1. **取得成功率**: 各 kind から少なくとも 2 件ずつ実 URL で `read_text` を試行
2. **表組み崩れ**: 新旧対照表 PDF (comparison) は表が多いため、列ズレ・セル結合の取り扱いをチェック
3. **縦書き / 段組**: 古い別紙 PDF (attachment) で発生しやすい
4. **フォント**: 旧字体・記号が含まれる場合の文字化け
5. **OCR 必要 PDF**: スキャンされた PDF（テキスト埋め込みなし）の判定

取得不可パターンが見つかったら `pdf-reader-mcp` 側に issue を起票する。

## Phase 4-3 実機テスト結果 (2026-05-06)

npx 版 `@shuji-bonji/houki-nta-mcp` v0.7.1 と `@shuji-bonji/pdf-reader-mcp` を組み合わせて、5 つの代表 PDF を実機テストした結果を以下に記録する。Issue 草案は [docs/issues/pdf-reader-mcp-feedback-2026-05-06.md](issues/pdf-reader-mcp-feedback-2026-05-06.md) を参照。

### テスト対象

| # | kind (推定) | URL | サイズ | docType / docId |
|---|---|---|---|---|
| A | comparison | `/law/tsutatsu/kihon/shohi/kaisei/pdf/b0025003-111.pdf` | 399KB / 1p | kaisei (参考: 第8章新旧対応表) |
| B | attachment (新旧対照表) | `/law/tsutatsu/kihon/shohi/kaisei/0025004-026/pdf/01.pdf` | 221KB / 5p | kaisei 0025004-026 |
| C | attachment (新旧対照表) | `/law/tsutatsu/kihon/shohi/kaisei/0025004-026/pdf/02.pdf` | 449KB / 20p | kaisei 0025004-026 |
| D | attachment (帳票・様式) | `/law/jimu-unei/hojin/090401-2/pdf/01.pdf` | 67KB / 1p | jimu-unei hojin/090401-2 |
| E | unknown (厚労省通知) | `/law/joho-zeikaishaku/shotoku/shinkoku/h30/07/pdf/01.pdf` | -KB / 10p | tax-answer 1125 |

### 観察された pdf-reader-mcp の問題

1. **タグ付き PDF (TaggedPDF) の Table 構造が読めていない**
   - PDF B (kaisei 01.pdf) は **Tagged: Yes**, 691 構造要素, **Table 5 個 / TR 10 / TH 15 / TD 5** という明示的な表構造を持つ。
   - にもかかわらず `read_text` の出力は座標ベースで「改正後の文 + 改正前の文」を 1 行に連結したプレーンテキストになり、表構造が完全に失われる。
   - LLM が「どこが改正後で、どこが改正前か」を判別困難。

2. **暗号化 PDF で `inspect_structure` / `inspect_fonts` が失敗**
   - `Error: Expected instance of PDFDict, but got instance of undefined`
   - 国税庁 PDF は `Linearized: Yes / Encrypted: Yes` (印刷時暗号化、復号は不要レベル) が標準。
   - 同じ PDF でも `read_text` / `get_metadata` / `inspect_tags` は動くため、`inspect_structure` / `inspect_fonts` は復号処理の実装漏れの可能性が高い。

3. **新旧対照表 (2 カラム並列) の左右連結問題**
   - Y-coordinate ベースで読むため、改正後 (左) と改正前 (右) が同一行で連結される。
   - `comparison` kind の PDF はすべてこの形式なので影響範囲が広い。

4. **帳票・様式の表構造がプレーンテキスト化**
   - PDF D (書面添付制度適用法人管理簿) は表組み帳票だが、`read_text` の出力では行・列の関係が完全に失われる。
   - PDF レベルでは Tagged: Yes なので、StructTree を活用すれば復元可能。

5. **連続する全角空白 (U+3000) の整理が不十分**
   - `read_text` 出力には大量の `　` が連続して残り、LLM のトークン消費が膨らむ。
   - 整形オプション (例: `compactWhitespace: true`) があると helpful。

### houki-nta-mcp 側で得られた副次的な気づき (Phase 4 self-feedback)

これらは `pdf-reader-mcp` の問題ではなく、houki-nta-mcp 自身の Phase 4 実装に対する改善余地。

- **A1**: `nta_inspect_pdf_meta` の `attachedPdfs` に `kind` フィールドが付かない既存レコードがある。
  - 原因: v0.6.0 で投入した DB レコードは `attached_pdfs_json` に `kind` を含まない。
  - 対策案: `nta_inspect_pdf_meta` の応答時に `extractPdfKind(title)` を動的に呼んで補完するか、bulk-DL の再実行を促す。
- **A2**: `reader_hints.examples` が「unknown 1 件」しか出していない。
  - 期待: 含まれる kind ごとに 1 件ずつ example を出す（少なくとも `comparison` と `attachment` は別行）。
- **A3**: PDF タイトルパターン「【参考】... 新旧対応表」は **`comparison`** に分類されるべきだが、実装の優先順位と検証要。
  - `extractPdfKind` の正規表現 `/新旧対照表|対比表/` には `新旧対応表` (対 → 対照) のゆらぎがマッチしないように見える。
  - PDF A の正式タイトルは「新旧対応表」(国税庁の表記)。`/新旧対(照|応)表|対比表/` への拡張を検討。
- **A4**: bunshokaitou と (一部の) kaisei が npx 環境では bulk-DL されていない。これは利用者環境の話だが、README で必要 bulk DL コマンドの確認を促す導線を強化したい。


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

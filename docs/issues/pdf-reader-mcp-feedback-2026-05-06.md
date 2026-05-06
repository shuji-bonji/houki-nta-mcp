# pdf-reader-mcp への issue 起票準備 (Phase 4-3 実機テスト結果)

houki-nta-mcp v0.7.1 + `@shuji-bonji/pdf-reader-mcp` の組み合わせで、国税庁の代表 PDF 5 件を実機テストした結果から起票する improvement 候補。

- 実施日: 2026-05-06
- 関連 memory: `houki_pdf_reader_synergy.md`
- 関連 doc: [PHASE4-PDF-FIXTURES.md](../PHASE4-PDF-FIXTURES.md#phase-4-3-実機テスト結果-2026-05-06)
- テスト対象 PDF (国税庁):
  - `/law/tsutatsu/kihon/shohi/kaisei/0025004-026/pdf/01.pdf` (新旧対照表 / 5 ページ / Tagged / Linearized + Encrypted / Word 2019 産)
  - `/law/jimu-unei/hojin/090401-2/pdf/01.pdf` (帳票・様式 / 1 ページ / Tagged / Encrypted (Linearized なし) / Excel 2007 産)
  - `/law/tsutatsu/kihon/shohi/kaisei/pdf/b0025003-111.pdf` (新旧対応表 第 8 章 / 1 ページ / Linearized + Encrypted)
  - `/law/tsutatsu/kihon/shohi/kaisei/0025004-026/pdf/02.pdf` (新旧対照表 / 20 ページ)
  - `/law/joho-zeikaishaku/shotoku/shinkoku/h30/07/pdf/01.pdf` (厚労省通知改正 / 10 ページ)

### 起票ステータスサマリー

| #   | タイトル (要約)                                | 種別        | 起票ステータス                                |
| --- | ---------------------------------------------- | ----------- | --------------------------------------------- |
| 1   | inspect_structure / inspect_fonts on Linearized PDFs | Bug         | ✅ **Resolved in v0.2.3** (2026-05-06 publish) |
| 2   | Tagged PDF Table → Markdown table 抽出         | Feature     | ✅ **Resolved in v0.3.0** (2026-05-06 publish, `extract_tables` tool) |
| 3   | Untagged 並列カラム PDF の column-aware 抽出   | Feature     | 🟢 起票 Ready                                  |
| 4   | 連続する全角空白の整形オプション               | Enhancement | 🟢 起票 Ready                                  |
| 5   | StructTree から documentShape ヒントを返す     | Improvement | 🟡 アイディア段階 (Phase 5 で再検討)           |

---

## ✅ Issue #1 [Bug] (Resolved in v0.2.3) — Linearized PDF で `inspect_structure` / `inspect_fonts` が throw する

### 一行サマリー

`Expected instance of PDFDict, but got instance of undefined` を投げて hard error していた問題。**真因は `Encrypted` ではなく `Linearized`** (pdf-lib が `/Linearized` ヒントストリーム + cross-reference を解決できない)。

### 解決状況

`@shuji-bonji/pdf-reader-mcp` v0.2.3 で fix。

- `analyzeStructure`: page tree 取得が失敗したら **pdfjs-dist で page count を取得する fallback** + `note` フィールド付きで部分結果を返す
- `analyzeFontsWithPdfLib`: 同様に graceful fallback (空 fontMap + note)
- pdf-lib の `console.log` ベースの parse 警告を `withSuppressedPdfLibLogs` で全包囲、stdio JSON-RPC stream の汚染を防止
- 国税庁 PDF (Linearized + Encrypted) で実機 MCP 経由動作確認済 (`inspect_structure` / `inspect_fonts` どちらも note 付きで成功)
- jimu-unei 01.pdf (Encrypted のみで非 Linearized) では note 無しで完全動作 → Encrypted 単独は問題なし

### 観察された副次的な学び

「Encrypted」と「Linearized」を取り違えやすい。pdf-lib では `ignoreEncryption: true` でほとんどの暗号化 PDF が透過的に開けるが、`/Linearized` 構造はこのオプションでは救えない。**今後の類似 issue では metadata の `Linearized` フラグを必ず添付**することを推奨。

(本 issue は GitHub に立てる必要なし。CHANGELOG v0.2.3 で fix を記録済み。)

---

## 🟢 Issue #2 [Feature] — Tagged PDF の Table 構造を Markdown テーブルとして抽出するモード

### Title 案 (英語)

```
Add tagged-PDF-aware extraction mode that emits StructTree Tables as Markdown
```

### 背景

`read_text` は Y-coordinate ベースの reading order で抽出するため、横並び 2 カラム (新旧対照表) や帳票の表組みが **完全にプレーン化** され、左右の対応関係が消失する。

実例 (kaisei 01.pdf 1 ページ目を `read_text` で抽出した結果の抜粋):

```
⑴   法人番号を有する課税事業者   法人番号 （行政手続における特定の個  ⑴   法人番号を有する課税事業者   法人番号 （行政手続における特定の個
人を識別するための番号の利用等に関する法律（平成   25   年法律第   27  人を識別するための番号の利用等に関する法律（平成   25   年法律第   27
号）第２条 第   16   項 《定義》に規定する「法人番号」をいう。 ）及びその  号）第２条 第   15   項 《定義》に規定する「法人番号」をいう。 ）及びその
```

左 = 改正後 / 右 = 改正前 だが、テキストレベルで連結されているため、LLM が「16 項 が改正後 / 15 項 が改正前」を判別するのが困難。

### 重要な観察 (実機データで実証済)

同じ PDF を `inspect_tags` で見ると、`Tagged: Yes` で **明示的な Table 構造を持つ**:

```
- Total Elements: 691
- Max Depth: 9

Role Distribution:
  Span: 497 / P: 139 / TH: 15 / TR: 10 / Root: 5
  Document: 5 / Table: 5 / THead: 5 / TBody: 5 / TD: 5
```

つまり **PDF レベルには既に「Table → THead/TBody → TR → TH/TD」の木が記録されている**。これを reading order ではなく StructTree 順に traverse すれば、Markdown table として復元できる。

### 提案する API (案 A 推奨)

#### 案 A: 新規 tool `extract_tables`

```json
{
  "name": "extract_tables",
  "args": {
    "file_path": "/path/to/document.pdf",
    "format": "markdown",
    "page_range": "1-5"
  }
}
```

レスポンス例:

```markdown
## Page 1 — Table 1

| 改正後 | 改正前 |
|---|---|
| ⑴ 法人番号を有する課税事業者 法人番号（…平成25年法律第27号）第２条第**16**項《定義》…） | ⑴ 法人番号を有する課税事業者 法人番号（…平成25年法律第27号）第２条第**15**項《定義》…） |
| (続行行) | (続行行) |

## Page 1 — Table 2 (header-less)

| col1 | col2 | col3 |
|---|---|---|
| ... | ... | ... |
```

#### 案 B: `read_text` の拡張

```json
{ "name": "read_text", "args": { "file_path": "...", "useStructTree": true } }
```

reading order の代わりに StructTree 順で抽出。Table はインライン Markdown table として整形。

→ **案 A 推奨**。`read_text` の責務拡張は意味の混乱を生むため、Table-aware 抽出は別 tool として独立させた方が API として clean。

### 実装ヒント

`pdfjs-dist` の `getStructTree()` で StructTree 全体を取得できる。Role が `Table` のノードを traverse し、`THead/TBody/TFoot` 配下の `TR` から子の `TH` (ヘッダ) と `TD` (セル) を取り出して Markdown 化。子の Span/P から実テキストを引っ張る。

```ts
// 概念
async function extractTables(filePath: string): Promise<TableRepresentation[]> {
  const doc = await loadDocument(filePath);
  const struct = await doc.getStructTree(/* per-page or doc-level */);
  return walkAndCollectTables(struct);
}
```

### 影響度

houki-nta-mcp の `kind: "comparison"` PDF (新旧対照表) と帳票・様式 (`kind: "attachment"`) はほぼすべてこのケース。改正点の差分抽出・帳票の意味理解が桁違いに容易になり、AI 士業基盤の本命機能となる。

### 受け入れ条件

- [ ] kaisei_01.pdf の 5 個の Table が Markdown table として復元できる
- [ ] テーブルが無いページでは空配列を返す
- [ ] Untagged PDF では `note: "Document is not tagged; extract_tables requires a Tagged PDF. Try Issue #3 column-aware extraction instead."` を返す

---

## 🟢 Issue #3 [Feature] — Untagged 並列カラム PDF の column-aware 抽出

### Title 案 (英語)

```
Add column detection / column-aware extraction for untagged two-column PDFs
```

### 背景

Issue #2 (Tagged PDF) と相補的。**TaggedPDF でない** 古い PDF / スキャン PDF / 一部の改正通達では、StructTree が無いため Issue #2 のアプローチでは表構造を復元できない。

例: 国税庁の 厚労省通知改正 (h30/07/01.pdf) や 一部の旧形式 PDF では「改正後 / 現行」が 2 カラム並列で配置されているが、StructTree タグなし。

### 提案

`read_text` に column-aware オプションを追加:

```json
{
  "name": "read_text",
  "args": {
    "file_path": "...",
    "splitColumns": 2,        // 明示指定
    "autoDetectColumns": true // 自動検出
  }
}
```

### 実装ヒント

- pdfjs-dist の `getTextContent()` で取れる各 TextItem は `transform[4]` (X 座標) と `transform[5]` (Y 座標) を持つ
- X 座標のヒストグラムを取り、median を境界に左右へ振り分ける
- 左カラム全体 → 右カラム全体 の順で出力 (改行で完全分離)
- `autoDetectColumns: true` の場合は X ヒストグラムの谷を見つけて 1〜3 カラムを自動判定

### 影響度

houki-nta-mcp / houki-egov-mcp / 各種白書 PDF など、日本の公文書全般で頻出。Tagged PDF 化されていない古い文書のサポートに必須。

### 受け入れ条件

- [ ] `splitColumns: 2` 指定で b0025003-111.pdf や h30/07/01.pdf が左→右の順に出力される
- [ ] `splitColumns: 1` (デフォルト) では既存の挙動と一致 (regression なし)

---

## 🟢 Issue #4 [Enhancement] — 連続する全角空白 (U+3000) の整形オプション

### Title 案 (英語)

```
Add option to compact runs of fullwidth space (U+3000) in extracted text
```

### 背景

日本語 PDF を `read_text` で抽出すると、視覚的なインデント・段落分けを表現する U+3000 が **大量に連続** してテキストに残る。

実例 (jimu-unei 01.pdf):

```
 (   )   自   年   月   日   法   有 （   年   月   日）   有   有
```

LLM が読む文字列としてはノイズだが、人間が見ると「表っぽい区切り」を表現するためにある。情報量が低いのに **トークン消費の数十%** を占めるケースもある。

### 提案

`read_text` のオプション:

```json
{
  "name": "read_text",
  "args": {
    "file_path": "...",
    "compactWhitespace": true,            // 連続空白を 1 個に
    "whitespaceAsSeparator": false         // 2 個以上の連続空白を「区切り」記号に変換 (将来オプション)
  }
}
```

- `compactWhitespace: true` (デフォルト `false`): 連続する空白 (` `, `\t`, U+3000) を **1 個** に縮約
- `whitespaceAsSeparator: true` (将来追加候補): 2 個以上の連続空白を `\t` または `|` のような区切り記号に置換し、表構造のヒントを残す

### 影響度

中。LLM のトークン消費削減と reading 性向上。日本語 PDF のほぼ全件で効果がある。実装も極めて軽量 (正規表現 1 行)。

### 受け入れ条件

- [ ] `compactWhitespace: true` 指定で連続全角空白が縮約される
- [ ] デフォルトでは挙動変化なし (regression なし)

---

## 🟡 Issue #5 [Improvement] — StructTree shape から documentShape ヒントを返す

### Title 案 (英語)

```
Hint extraction: detect document shape (comparison-table, form, narrative, qa) from StructTree
```

### 背景

houki-nta-mcp 側では PDF **タイトル文字列** から kind を推定しているが、**本文構造からの裏付けは取れていない**。`inspect_tags` の Role Distribution と StructTree shape を見れば、「Table が dominant でしかも 2 列」「Form/様式 (TextField 多数)」「散文 (P 中心)」などの大分類が機械的に判定できる。

例: kaisei 01.pdf の Role Distribution は `Table:5 / TR:10 / TH:15 / TD:5` で、各 Table が 1 行ヘッダ + 2 列の構造。これだけで「これは新旧対照表である」と推定可能。

### 提案

`inspect_tags` の応答に `documentShape` フィールドを追加:

```json
{
  "isTagged": true,
  "totalElements": 691,
  "documentShape": "comparison-table",
  "shapeConfidence": 0.85,
  "shapeReasoning": "Tables dominate (5/138 sections), mostly 2-column with header rows"
}
```

`documentShape` 候補:
- `comparison-table` (新旧対照表 / 2 カラム表が支配的)
- `form` (TextField / Sig フィールド多数)
- `narrative` (P が支配的、Table 少数)
- `qa` (見出し階層が Q/A 交互)
- `mixed` / `unknown`

### 影響度

中。Phase 5+ の AI 士業基盤で「文書の構造を見て読み方を変える」ロジックを書きたいときに便利。本機能無しでも houki-nta-mcp 側のタイトル推定で当面は代用可能なため、優先度は低めに置く。

### 起票時期

Issue #2 (extract_tables) の実装方針が固まってから議論再開。Issue #2 で StructTree walker を書いた副産物として実装できる可能性が高い。

---

## 起票方針 (推奨順)

1. **Issue #2 を最初に起票**: houki-nta-mcp の comparison kind の本命機能。実装規模も中程度で、PR 化も視野に入る
2. **Issue #4 を併走 / または小手調べ**: 実装規模が極小で、別 issue として切り出し PR 受入れもしやすい
3. **Issue #3 を Issue #2 と前後して起票**: Tagged PDF と Untagged PDF を表裏で議論できる
4. **Issue #5 は後回し**: Issue #2 の実装で技術的な見通しが立ってから

## houki-nta-mcp 側で対応する事項 (self-feedback / v0.7.2 候補)

これらは本 issue 草案とは別軸で houki-nta-mcp に閉じて対応する。

- [ ] `extractPdfKind` の正規表現を `/新旧対(照|応)表|対比表/` に拡張 (PDF A `新旧対応表` がマッチしない問題)
- [ ] `nta_inspect_pdf_meta` で kind を動的補完 (既存 v0.6.0 期 DB レコードのフォールバック)
- [ ] `reader_hints.examples` を kind 別に複数生成
- [ ] README に必要な bulk-DL コマンドの一覧と確認方法を強化

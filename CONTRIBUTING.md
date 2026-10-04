# Contributing

`houki-nta-mcp` は houki-hub MCP family の **国税庁コンテンツ担当**です。Architecture E（複数独立 MCP + 共有ライブラリ + Skill）の設計上、貢献の経路はリポジトリごとに分かれています。

## 貢献経路の地図

| 貢献したい内容 | 行き先 |
|---|---|
| **通達・質疑応答事例の取得ロジック改善**（パーサ、URL 構造対応 等） | このリポジトリへ PR |
| **キャッシュ戦略・速度改善** | このリポジトリへ PR |
| **通達略称の追加・修正**（消基通・所基通 等） | [`@shuji-bonji/houki-abbreviations`](https://github.com/shuji-bonji/houki-abbreviations) リポジトリへ PR |
| **法律本文の取得改善** | [`houki-egov-mcp`](https://github.com/shuji-bonji/houki-egov-mcp) へ PR |
| **業務ドメイン Skill**（消費税判定、電帳法対応 等） | 各自のプロジェクトの `.claude/skills/` へ |

## このリポジトリ（houki-nta-mcp）への貢献

### Phase 1 実装の歓迎ポイント

`docs/DESIGN.md` と `docs/DATA-SOURCES.md` に Phase 1 の実装計画があります。以下の領域への PR を歓迎します:

- `src/services/nta-scraper.ts` — fetch + Shift_JIS 変換 + cheerio
- `src/services/tsutatsu-parser.ts` — 通達 HTML のパース
- `src/services/qa-parser.ts` — 質疑応答事例のパース
- `src/services/tax-answer-parser.ts` — タックスアンサーのパース
- `src/utils/cache.ts` — メモリ + ディスク 2層キャッシュ

### スクレイピングのマナー

国税庁サイトに対する取得は以下のルールで実装してください:

- User-Agent に `houki-nta-mcp` の名前と URL を明示
- 1 リクエスト/秒以下、同一ホスト 1 並列まで
- エラー時は指数バックオフ
- robots.txt を起動時に取得して順守
- 大量取得（bulk DL モード）は深夜帯に限定

### 法的位置付けの実装

各通達・事例レスポンスには **`legal_status`** フィールドを付与してください:

```ts
{
  legal_status: {
    binds_citizens: false,    // 国民への直接的拘束力なし
    binds_courts: false,      // 裁判所も拘束しない
    binds_tax_office: true,   // 税務署員のみ職務遵守
    note: '...'
  }
}
```

これにより LLM が「通達は守るべき行政規範だが、裁判規範ではない」と適切に判別できます。

## 通達略称の追加は別リポジトリ

通達の略称（消基通・所基通・法基通 等）は **`@shuji-bonji/houki-abbreviations`** に集約しています。エントリ追加・修正は以下に PR してください:

👉 https://github.com/shuji-bonji/houki-abbreviations

houki-abbreviations 側で `category: 'kihon-tsutatsu'` または `'kobetsu-tsutatsu'`、`source_mcp_hint: 'houki-nta'` のフィールドを正しく設定してください。

例:

```json
{
  "abbr": "消基通",
  "formal": "消費税法基本通達",
  "law_id": null,
  "domain": "tax",
  "category": "kihon-tsutatsu",
  "source_mcp_hint": "houki-nta",
  "aliases": ["消費税法基本通達"],
  "note": "国税庁長官が発する消費税法の解釈通達"
}
```

## 開発

```sh
npm install
npm run lint        # Biome lint
npm run format      # Biome 整形
npm run check       # Biome lint + 整形 (--write)
npm test            # vitest
npm run build       # tsc
```

## ローカル DB を使う開発

開発中のビルドで公開版の DB を壊さないための決まりです。

手元のビルド（`node dist/index.js` で起動する MCP サーバーや、`node dist/index.js --bulk-download-qa` などの CLI）も、`HOUKI_NTA_DB_PATH` が無ければ、plugin（公開版）と同じ `~/.cache/houki-nta-mcp/cache.db` を開きます。次の作業では、この DB を共有しないでください。

| 作業 | 共有すると起きること |
|---|---|
| 古いコミット（0.23.x 以前）を起動する | 0.23.x 以前は版が新しい DB を見つけると全テーブルを消すので、版 12 の `cache.db` の中身が消えます |
| DB の版（`SCHEMA_VERSION`）を上げる変更を試す | 投入のフラグや DB を開くツールが `cache.db` を新しい版に移行するので、公開版の plugin からは「版が新しい DB」になり、読むだけのツールが使えなくなります |
| 取り込みの処理（`src/services/*-bulk-downloader.ts`）を変えて試す | 試している途中の中身を、公開版の検索ツールが読みます |

開発用の DB は別のファイルにします。CLI には `--db-path` もありますが、MCP サーバーには渡せません。MCP の設定ファイルの `env` と、CLI を実行するシェルの両方に同じ `HOUKI_NTA_DB_PATH` を設定してください（JSON では `~` が展開されないので絶対パスで書きます）。

```bash
export HOUKI_NTA_DB_PATH=~/.cache/houki-nta-mcp/cache.dev.db
node dist/index.js --quickstart
node dist/index.js --status   # 2 行目の「DB:」が cache.dev.db、3 行目の「DB の場所の設定:」が HOUKI_NTA_DB_PATH であることを確かめる
```

```json
// 開発中の動作確認 (.mcp.json)
{
  "mcpServers": {
    "houki-nta-local": {
      "command": "node",
      "args": ["/absolute/path/to/houki-nta-mcp/dist/index.js"],
      "env": {
        "HOUKI_NTA_DB_PATH": "/Users/you/.cache/houki-nta-mcp/cache.dev.db"
      }
    }
  }
}
```

MCP サーバーがどのファイルを開いたかは、起動時のログの `DB: <絶対パス>（DB の場所の設定: HOUKI_NTA_DB_PATH）` の行と、検索ツールの応答の `freshness.db_path` で確かめられます。既定のファイル名に DB の版を入れないのは、版 3〜11 の DB を行を保って移行するためです（houki-hub `docs/DECISIONS.md` 2026-10-04 の T6 の (f)）。

## リリース手順（メンテナ向け）

stable リリースは **GitHub Actions が自動 publish** しますが、`dist-tag` の `next`
は手動で揃える必要があります（npm Trusted Publishers の OIDC は `npm publish`
専用で `npm dist-tag` には使えないため）。

### stable リリース (vX.Y.Z)

```bash
# 1. version bump + CHANGELOG / README / llms.txt 更新（PR でレビュー）
# 2. tag を切って push
git tag vX.Y.Z
git push origin main --tags
# → CI が自動で npm publish --tag latest を実行（OIDC）

# 3. release が完了したら、手元で next タグを揃える
npm dist-tag ls @shuji-bonji/houki-nta-mcp
# → latest: X.Y.Z, next: 古いバージョン になっているはず

npm dist-tag add @shuji-bonji/houki-nta-mcp@X.Y.Z next
# E401 が出たら `npm login` してから再実行（OIDC ローカルセッション無効のため）

npm dist-tag ls @shuji-bonji/houki-nta-mcp
# → latest: X.Y.Z, next: X.Y.Z になっていれば OK
```

**なぜ next を揃えるのか**: alpha/beta が走っていない期間も
`npm i @shuji-bonji/houki-nta-mcp@next` を使うユーザーが古いバージョンに
固定されるのを防ぐ慣習（npm 自体・React・TypeScript・Vite 等もこの形）。
次の prerelease を publish すれば `--tag next` で next が自動更新される。

### prerelease リリース (vX.Y.Z-alpha.N)

```bash
# semver の "-" を含めると CI が自動で --tag next を選択
git tag vX.Y.Z-alpha.0
git push origin main --tags
# → CI が npm publish --tag next で公開
# next タグは自動で進むので、手動操作は不要
```

## コーディング規約

- TypeScript 7.x (tsgo) / ESM / Node.js >= 22
- MCP SDK v2 (`@modelcontextprotocol/server`)。サーバー本体は `src/server.ts` の `createServer()`、bin エントリ `src/index.ts` は `serveStdio(createServer)`
- インポートは `.js` 拡張子を明示（TS ファイル内でも）
- `console.log` 禁止（stdio MCP プロトコル保護のため）。ログは `src/utils/logger.ts` 経由
- テストは `vitest`
- lint / フォーマットは Biome (`biome.json`)。規則は single quote / trailing comma es5 / semicolon / 幅 100 / 2 スペース

## 質問・議論

- GitHub Discussions
- Issues にドラフト相談も歓迎

## 作者のスタンス

「育てる基盤」として運用しています。完璧でないエントリ・実装でも、**PR で議論して磨く**方針です。気軽に投げてください。

特に Phase 1 実装は単独では負荷が大きいので、以下のいずれかでも貢献として大きいです:

- 国税庁サイトの URL 構造調査メモ（docs/DATA-SOURCES.md への追記）
- パースが難しいページのサンプル収集
- robots.txt の解釈
- ライセンス・著作権の追加調査

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
npm run lint        # ESLint
npm run format      # Prettier 整形
npm test            # vitest
npm run build       # tsc
```

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

- TypeScript 5.x / ESM / Node.js >= 20
- インポートは `.js` 拡張子を明示（TS ファイル内でも）
- `console.log` 禁止（stdio MCP プロトコル保護のため）。ログは `src/utils/logger.ts` 経由
- テストは `vitest`
- フォーマットは `prettier`
- ESLint flat config (`eslint.config.js`)

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

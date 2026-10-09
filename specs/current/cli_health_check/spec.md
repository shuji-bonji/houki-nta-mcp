---
spec_id: NTA
kind: cli
approved: 2026-09-29
pr: 103
---
# 機能: cli_health_check（国税庁サイトの代表ページの確認と、基準（baseline）との比較）

- 版: current
- 起こした元: v0.21.2 の `src/cli.ts`（`--health-check`・`--check-baseline-drift`・`--strict`）、`src/services/health-check.ts`（`CANARY_TARGETS`）、`src/services/baseline-drift.ts`、`src/services/menu-parser.ts`、`src/services/health-store.ts`（baseline ファイル）、`src/services/health-thresholds.ts`、`src/services/bulk-aggregation.ts`、`src/services/baseline-drift.test.ts`、`src/services/health-store.test.ts`
- 関連する Issue: houki-nta-mcp #111（--check-baseline-drift の判定の対象外の 4 件。0.24.0）

この文書は「このコマンドは何をするか」を書きます。どう実装しているか（関数名・テーブル名）は書きません。「基準（baseline）」は 2 つある。`--health-check` と bulk download が使う baseline ファイル（種別ごとの件数の履歴）と、`--check-baseline-drift` が menu.htm と突き合わせる代表ページの URL（canary）である。

## アクター

- 運用者（国税庁サイトの構造の変更を、投入が失敗する前に知りたい人。CI の定期実行に組み込む人を含む）。`--health-check` で 9 件の代表ページを取得して解析できるかを確かめ、`--check-baseline-drift` で代表ページの URL が国税庁の通達の目次（`https://www.nta.go.jp/law/tsutatsu/menu.htm`）に今もあるかを確かめる

## 入力

| フラグ・環境変数         | 必須          | 内容                                                                                                                 |
| ------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--health-check`         | どちらか 1 つ | 9 件の代表ページを順に取得し、それぞれの解析が通るかを確かめる                                                       |
| `--check-baseline-drift` | どちらか 1 つ | menu.htm を取得し、9 件の代表ページの URL が目次にあるか、同じ税目に新しい世代のディレクトリが出ていないかを確かめる |
| `--strict`               | 任意          | 失敗（`--health-check`）または drift（`--check-baseline-drift`）が 1 件以上あれば終了コード 1 で終わる（CI 用）      |
| `HOUKI_NTA_BASELINE_DIR` | 任意          | baseline ファイルの置き場所。無ければ `${XDG_CACHE_HOME:-~/.cache}/houki-nta-mcp/`                                   |

9 件の代表ページ（`doc_type` と URL）は次のとおり。

| `doc_type`         | 代表ページ                                                           | 解析が通る条件                             |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------ |
| `tsutatsu-shohi`   | `https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm`           | 節のページとして読める                     |
| `tsutatsu-shotoku` | `https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/02/04.htm`         | 同上                                       |
| `tsutatsu-hojin`   | `https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01/01_03.htm`        | 同上                                       |
| `tsutatsu-sozoku`  | `https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/01.htm`      | 同上                                       |
| `kaisei`           | `https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei_a.htm` | 索引から個別ページの URL が 1 件以上取れる |
| `jimu-unei`        | `https://www.nta.go.jp/law/jimu-unei/jimu.htm`                       | 同上                                       |
| `bunshokaitou`     | `https://www.nta.go.jp/law/bunshokaito/01.htm`                       | 税目のリンクが 1 件以上取れる              |
| `tax-answer`       | `https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6101.htm`     | 題名が取れる                               |
| `qa-jirei`         | `https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm`                 | 題名が取れる                               |

## 処理の流れ

図の中の番号は「できること」の仕様 ID の末尾 3 桁です。

```mermaid
flowchart TD
  subgraph --check-baseline-drift
    A["menu.htm を取得して目次の項目を集める"] --> B["代表ページ 9 件を順に判定する"]
    B --> C{"URL が /law/tsutatsu/kihon/ の下か"}
    C -- いいえ --> D["not-applicable（判定の対象外）（001）"]
    C -- はい --> E{"税目のディレクトリが目次にあるか"}
    E -- ない --> F["missing。同じ税目の新しい世代が目次にあれば newerGenerations に入れる（002）"]
    E -- ある --> G{"同じ税目の新しい世代も目次にあるか"}
    G -- ある --> H["generation-drift と newerGenerations（003）"]
    G -- ない --> I["ok（001）"]
    D --> J["結果を標準エラー出力と標準出力の JSON に出す。まとめの分母は判定の対象の件数（007）。--strict で drift があれば exit 1（未決 2）"]
    F --> J
    H --> J
    I --> J
  end
  subgraph --health-check
    K["代表ページ 9 件を順に取得して解析する（未決 1）"] --> L["baseline ファイルから種別ごとの最終実行日を読む（004・005）"]
    L --> M["結果を標準エラー出力と標準出力の JSON に出す。--strict で失敗があれば exit 1（未決 1）"]
  end
  subgraph bulk download の後
    N["種別ごとの件数の集計を baseline ファイルに追記する（006）"] --> O["前回までの履歴と比べて警告を出す（未決 3）"]
  end
```

## できること

### SPEC-NTA-CLI-HEALTH-CHECK-001 `--check-baseline-drift` は、代表ページの税目のディレクトリが目次にあれば `ok` にし、判定の対象外の代表ページは `not-applicable` にする

代表ページの URL から、`/law/tsutatsu/kihon/` の下の税目のディレクトリ（数字だけのディレクトリとファイル名を除いた部分。例: `shohi/01/04.htm` → `shohi`、`sisan/sozoku2/01.htm` → `sisan/sozoku2`、`shohi/kaisei/kaisei_a.htm` → `shohi/kaisei`）を取り、目次（menu.htm）の項目に同じディレクトリがあれば `status` を `ok` にする。改正通達の索引（`…/shohi/kaisei/kaisei_a.htm`）も同じ規則で `ok` になる。

`/law/tsutatsu/kihon/` の下でない代表ページ（`tax-answer`・`qa-jirei`・`jimu-unei`・`bunshokaitou`）と、`/law/tsutatsu/kihon/` の下でも税目のディレクトリを取れない代表ページは判定の対象外で、`status` は `not-applicable`、`message` に `drift 検知対象外` を含む。`not-applicable` の代表ページは、`driftCount`（SPEC-NTA-CLI-HEALTH-CHECK-003）にも、まとめの `OK` の数（SPEC-NTA-CLI-HEALTH-CHECK-007）にも数えない。結果の `entries` には 9 件すべてを並べる（v0.23.x までは対象外も `ok` にし、`<ok>/9 OK` の `<ok>` に数えていた。#111）。

### SPEC-NTA-CLI-HEALTH-CHECK-002 税目のディレクトリが目次に無ければ `missing` にし、新しい世代があれば `newerGenerations` に入れる

代表ページの税目のディレクトリが目次に無いときは `status` を `missing` にする。同じ親ディレクトリに、同じ名前に数字か `_new` を付けたディレクトリ（例: `sozoku` に対する `sozoku2`、`hyoka` に対する `hyoka_new`）が目次にあれば、それを `newerGenerations` に入れる（例: `['sozoku2']`）。無ければ `newerGenerations` は付かない（例: 目次に無い `zzz`）。

### SPEC-NTA-CLI-HEALTH-CHECK-003 税目のディレクトリが目次にあり、新しい世代も目次にあれば `generation-drift` にする

代表ページの税目のディレクトリが目次にあり、かつ同じ親ディレクトリに新しい世代のディレクトリも目次にあるときは、`status` を `generation-drift` にし、`newerGenerations` にその名前を入れる。例: 目次に `sisan/sozoku2` と `sisan/sozoku3` の両方があり、代表ページが `sisan/sozoku2/01.htm` なら、`generation-drift` で `newerGenerations` は `['sozoku3']`。結果の `driftCount` は `missing` と `generation-drift` の件数の合計である（`ok` と `not-applicable` は数えない）。

### SPEC-NTA-CLI-HEALTH-CHECK-004 baseline ファイルは `HOUKI_NTA_BASELINE_DIR`、無ければ `XDG_CACHE_HOME` の下に種別ごとに置く

種別ごとの baseline ファイルは `baseline-<doc_type>.json` で、置き場所は次の順で決める。

1. 環境変数 `HOUKI_NTA_BASELINE_DIR` があればそのディレクトリ。例: `HOUKI_NTA_BASELINE_DIR=/tmp/custom` なら `qa-jirei` の baseline は `/tmp/custom/baseline-qa-jirei.json`
2. 無ければ `$XDG_CACHE_HOME/houki-nta-mcp/`。例: `XDG_CACHE_HOME=/tmp/xdg` なら `tax-answer` の baseline は `/tmp/xdg/houki-nta-mcp/baseline-tax-answer.json`
3. どちらも無ければ `~/.cache/houki-nta-mcp/`

### SPEC-NTA-CLI-HEALTH-CHECK-005 baseline ファイルが無い・壊れている・種別が違うときは、履歴の無い baseline として扱う

baseline ファイルを読むとき、ファイルが無い、JSON として読めない、`doc_type` が求めた種別と違う、`history` が配列でない、のどれかなら、その種別の履歴が空（`history: []`）として扱い、エラーにしない。ファイルがあって形が合えば、`history` の各記録（`ranAt`・`totalEntries`・`documentsFetched`・`documentsFailed`・`newDocs`・`updatedDocs`・`orphanedDocs`・`movedDocs`・`failRate`・`durationMs`）をそのまま読む。

### SPEC-NTA-CLI-HEALTH-CHECK-006 bulk download の記録は baseline ファイルに追記し、直近 12 件だけを残す

bulk download が終わったときの記録は、その種別の baseline ファイルの `history` の末尾に追記する。ファイルが無ければ作り、途中のディレクトリが無ければ作る。`history` が 12 件を超えたら古いものから捨て、直近 12 件を残す。例: 15 回追記すると、最初の 3 件が捨てられ、4 回目から 15 回目までの 12 件が残る。

### SPEC-NTA-CLI-HEALTH-CHECK-007 `--check-baseline-drift` のまとめの行は、判定の対象の件数を分母にし、対象外の件数を別に出す

`--check-baseline-drift` は、標準エラー出力の 1 件ごとの行で `not-applicable` に `-` を付け、まとめの行を `[drift-check] <ok の件数>/<判定の対象の件数> OK, drift=<driftCount>, 対象外=<not-applicable の件数> (<秒>s)` にする。判定の対象の件数は、`entries` の件数から `not-applicable` の件数を引いた数である。`--strict` の終了コード（`driftCount` が 1 以上なら 1）は変わらない。

例: 今の代表ページ 9 件（判定の対象は基本通達 4 種と改正通達の索引の 5 件）で目次に問題が無ければ、まとめの行は `[drift-check] 5/5 OK, drift=0, 対象外=4 (<秒>s)`（v0.23.x では `[drift-check] 9/9 OK, drift=0 (<秒>s)`。#111）。

## できないこと

- 代表ページの URL を設定で差し替えること（9 件は固定。国税庁サイトの世代移行があれば、`--check-baseline-drift` の `newerGenerations` を見て houki-nta-mcp 側の URL を更新する）
- `--health-check` で、代表ページ以外（投入した全節・全文書）を確かめること
- 目次（menu.htm）の下にない種別（タックスアンサー・質疑応答事例・事務運営指針・文書回答事例）の drift を判定すること
- baseline ファイルを CLI から消す・作り直すこと（ファイルを消せば履歴の無い baseline になる。SPEC-NTA-CLI-HEALTH-CHECK-005）

## 未決

初版起こしで見つけた、意図か不具合かを人が決める項目です。決まったら「できること」に ID を振るか、`specs/changes/` の差分にします。

意図か不具合かの判断が要る項目は houki-nta-mcp の Issue に移し、ここには題と Issue の番号だけを残します。今の振る舞いのままでよくテストが無いだけの項目は、受入テストを書いてから「できること」に ID を振ります。

1. **`--health-check` の動きと表示。** 9 件の代表ページを順に（約 1.1 秒あけて）取得し、解析が通れば `status: "ok"`、取得か解析に失敗すれば `status: "fail"` と `error`（`fetch: <理由>` / `parse: <理由>`）にして、失敗しても次へ進む。標準エラー出力に `[health-check] starting canary fetch for 9 targets...`、1 件ごとの進捗、`✓` / `✗` 付きのまとめ、`[health-check] <ok>/9 OK (<秒>s)` を出し、標準出力に `ranAt`・`durationMs`・`results`・`ok`・`fail` と、種別ごとの baseline の最終実行（`baselineStaleness[doc_type]` の `lastRun`・`daysAgo`。履歴が無ければどちらも `null`）を JSON で出す。`--strict` で `fail` が 1 件以上あれば `[health-check] --strict: <n> canary failed → exit 1` を出して終了コード 1、`--strict` が無ければ失敗があっても終了コード 0。どれもテストが無い。ID を振るのは受入テストを書いてから。
2. **`--check-baseline-drift` の表示と終了コード。** 標準エラー出力に `[drift-check] fetching /law/tsutatsu/menu.htm ...`、目次の項目数、1 件ごとに `✓`（ok）/ `⚠`（generation-drift）/ `✗`（missing）/ `-`（not-applicable）と `message`・`newer:`、`[drift-check] <ok の件数>/<判定の対象の件数> OK, drift=<driftCount>, 対象外=<not-applicable の件数> (<秒>s)`（SPEC-NTA-CLI-HEALTH-CHECK-007） を出し、標準出力に `ranAt`・`durationMs`・`menuUrl`・`menuEntryCount`・`entries`・`driftCount` を JSON で出す。`--strict` で `driftCount` が 1 以上なら終了コード 1、無ければ 0。判定（SPEC-NTA-CLI-HEALTH-CHECK-001〜003）はテストがあるが、コマンドとしての表示と終了コードはテストが無い。ID を振るのは受入テストを書いてから。
3. **bulk download の後の警告のしきい値。** bulk download の記録（SPEC-NTA-CLI-HEALTH-CHECK-006）を前回までの履歴と比べ、失敗率が種別ごとの下限（件数と率の両方）を超えたとき、総件数が履歴の中央値から 20% 以上ずれたとき、更新された文書が 50% を超えたとき、に `⚠ health warning:` と理由を標準エラー出力に出し、結果の JSON の `health.warn` を `true` にする。履歴が無い初回は件数のずれを判定しない。しきい値の計算はテストがある（`src/services/health-thresholds.test.ts`・`src/services/bulk-aggregation.test.ts`）が、内部の計算式の単位で、CLI の出力としては確かめていない。しきい値の値を仕様にするかは人が決める。
5. **目次の項目のうち、コメントの中にある旧版のリンクは拾わない。** 目次には世代移行した旧版のリンクが HTML のコメントの中に残っているが、判定には使わない（ブラウザーの表示と同じ）。テストは目次の解析の単位（`src/services/menu-parser.test.ts`）にある。ID を振るのは受入テストを書いてから。

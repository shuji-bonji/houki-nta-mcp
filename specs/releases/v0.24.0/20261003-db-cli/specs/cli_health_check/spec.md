# 差分: cli_health_check（20261003-db-cli）

`specs/current/cli_health_check/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える（見出しの行の題も置き換える）
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 冒頭の「関連する Issue」を `houki-nta-mcp #111（--check-baseline-drift の判定の対象外の 4 件。0.24.0）` にする
- 「処理の流れ」の図で、`C -- いいえ --> D["ok（判定の対象外）（001）"]` を `C -- いいえ --> D["not-applicable（判定の対象外）（001）"]` にし、`J` の文を「結果を標準エラー出力と標準出力の JSON に出す。まとめの分母は判定の対象の件数（007）。--strict で drift があれば exit 1（未決 2）」にする
- 「未決」の 4（→ #111）の行を消す。未決 2 の `[drift-check] <ok>/9 OK, drift=<n> (<秒>s)` を SPEC-NTA-CLI-HEALTH-CHECK-007 の形に直し、「1 件ごとに `✓`（ok）/ `⚠`（generation-drift）/ `✗`（missing）」に「/ `-`（not-applicable）」を足す

## MODIFIED

### SPEC-NTA-CLI-HEALTH-CHECK-001 `--check-baseline-drift` は、代表ページの税目のディレクトリが目次にあれば `ok` にし、判定の対象外の代表ページは `not-applicable` にする

代表ページの URL から、`/law/tsutatsu/kihon/` の下の税目のディレクトリ（数字だけのディレクトリとファイル名を除いた部分。例: `shohi/01/04.htm` → `shohi`、`sisan/sozoku2/01.htm` → `sisan/sozoku2`、`shohi/kaisei/kaisei_a.htm` → `shohi/kaisei`）を取り、目次（menu.htm）の項目に同じディレクトリがあれば `status` を `ok` にする。改正通達の索引（`…/shohi/kaisei/kaisei_a.htm`）も同じ規則で `ok` になる。

`/law/tsutatsu/kihon/` の下でない代表ページ（`tax-answer`・`qa-jirei`・`jimu-unei`・`bunshokaitou`）と、`/law/tsutatsu/kihon/` の下でも税目のディレクトリを取れない代表ページは判定の対象外で、`status` は `not-applicable`、`message` に `drift 検知対象外` を含む。`not-applicable` の代表ページは、`driftCount`（SPEC-NTA-CLI-HEALTH-CHECK-003）にも、まとめの `OK` の数（SPEC-NTA-CLI-HEALTH-CHECK-007）にも数えない。結果の `entries` には 9 件すべてを並べる（v0.23.x までは対象外も `ok` にし、`<ok>/9 OK` の `<ok>` に数えていた。#111）。

### SPEC-NTA-CLI-HEALTH-CHECK-003 税目のディレクトリが目次にあり、新しい世代も目次にあれば `generation-drift` にする

代表ページの税目のディレクトリが目次にあり、かつ同じ親ディレクトリに新しい世代のディレクトリも目次にあるときは、`status` を `generation-drift` にし、`newerGenerations` にその名前を入れる。例: 目次に `sisan/sozoku2` と `sisan/sozoku3` の両方があり、代表ページが `sisan/sozoku2/01.htm` なら、`generation-drift` で `newerGenerations` は `['sozoku3']`。結果の `driftCount` は `missing` と `generation-drift` の件数の合計である（`ok` と `not-applicable` は数えない）。

## ADDED

### SPEC-NTA-CLI-HEALTH-CHECK-007 `--check-baseline-drift` のまとめの行は、判定の対象の件数を分母にし、対象外の件数を別に出す

`--check-baseline-drift` は、標準エラー出力の 1 件ごとの行で `not-applicable` に `-` を付け、まとめの行を `[drift-check] <ok の件数>/<判定の対象の件数> OK, drift=<driftCount>, 対象外=<not-applicable の件数> (<秒>s)` にする。判定の対象の件数は、`entries` の件数から `not-applicable` の件数を引いた数である。`--strict` の終了コード（`driftCount` が 1 以上なら 1）は変わらない。

例: 今の代表ページ 9 件（判定の対象は基本通達 4 種と改正通達の索引の 5 件）で目次に問題が無ければ、まとめの行は `[drift-check] 5/5 OK, drift=0, 対象外=4 (<秒>s)`（v0.23.x では `[drift-check] 9/9 OK, drift=0 (<秒>s)`。#111）。

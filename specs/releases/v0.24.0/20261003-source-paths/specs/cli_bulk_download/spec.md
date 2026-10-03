# 差分: cli_bulk_download（`--tax-answer-taxonomy` の値の一覧）

この差分は `specs/current/cli_bulk_download/spec.md` に対するものです。仕様 ID は変えず、ID の無い節（「入力」の表）だけを変えます。SPEC-NTA-CLI-BULK-DOWNLOAD-008 は「各フラグの一覧（入力の表）にある値」を使うので、表を変えると使える値が変わります。

## ID の無い節の変更

- 「入力」の表の `--tax-answer-taxonomy=<csv>` の行の値の一覧を、国税庁のタックスアンサーの索引にある税目フォルダ 13 個にする: `shotoku` / `gensen` / `joto` / `sozoku` / `zoyo` / `hyoka` / `hojin` / `shohi` / `inshi` / `hotei` / `fufuku` / `saigai` / `osirase`（2026-10-03 JST の索引で確かめた値。足したのは `zoyo`・`hyoka`・`hotei`・`fufuku`・`saigai` の 5 個）
- 同じ行に「国税庁の索引にこの一覧に無い税目フォルダが現れても、`--tax-answer-taxonomy` を付けない投入では取り込む。絞り込みに使えるのはこの一覧の値だけ」を足す

例: `--bulk-download-tax-answer --tax-answer-taxonomy=saigai` は 8xxx 帯の 16 件だけを投入する（v0.23.0 では `saigai` が使えない値で、`--tax-answer-taxonomy=saigai,zzz` の `saigai` も使えない値として集めていた）。

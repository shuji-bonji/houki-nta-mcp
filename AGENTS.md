# AGENTS.md

エージェント（Claude Code / Cowork のセッション）がこのリポジトリで作業するときの目次です。手順の本文はここには書きません。

## 仕様の正本

- 意図の正本は `specs/current/` です。Wiki・Discussions・README は正本にしません。
- 変更は `specs/changes/<yyyymmdd>-<slug>/` に出し、人が承認するまで Coder を起動しません。
- 承認された差分は Spec Publisher が `specs/current/` に取り込み、差分のフォルダーを `specs/releases/<実装を出したタグ>/<yyyymmdd>-<slug>/` へ移します（`git mv`）。移すときに proposal.md の「状態」を取り込み済みにします。
- `spec.md` の「承認日」は、承認にあたる PR（初版の `spec.md` を足す PR、差分を取り込む PR）をマージする前に、そのブランチで書きます（JST の日付と PR 番号）。マージの後に書くと、承認日を書くためだけの PR が要るためです。
- Coder は `specs/current/` の本文を書き換えません。実装から仕様へ戻したい発見は、新しい `specs/changes/` に書きます。
- 受入テストの `describe` には仕様 ID（例: `SPEC-NTA-GET-TSUTATSU-001`）を含めます。`npx spec-ids check`（[@shuji-bonji/spec-ids](https://github.com/shuji-bonji/spec-ids)）が仕様とテストの ID を突き合わせ、CI（spec-gate）で走ります。

## 仕様 ID

- 形式は `SPEC-<領域>-<機能>-<3 桁>` です（例: `SPEC-NTA-GET-TSUTATSU-001`）。領域 `NTA` はこのリポジトリを表します。機能は `specs/current/<dir>/spec.md` のディレクトリ名から接頭辞 `nta_` を除いて大文字にし、`_` を `-` にしたものです（`nta_get_tsutatsu` → `GET-TSUTATSU`）。番号は機能ごとに 001 からの通し番号です。
- 機能ごとに数列を分けるので、並行するブランチが衝突するのは同じ機能の仕様を同時に足したときだけです。`spec-ids check` は、見出しの ID の機能がディレクトリ名と一致することも検査します。
- 一度使った番号はその機能の中で再利用しません。仕様を外すときは `specs/changes/` の `REMOVED` に書き、テストからも ID を外します。
- 新しい ID は `npx spec-ids next specs/current/<dir>/spec.md`（またはディレクトリ名 `npx spec-ids next nta_get_qa`）で取ります。その機能の見出しの最大番号 +1 です。複数なら `--count 3`。番号の予約はしないので、万一同じ番号が 2 つの見出しに現れたら、マージ時に `spec-ids check` の重複検知で止まります。
- ID の形式（正規表現・機能の導き方・組み立て）は `@shuji-bonji/spec-ids` が決めています。このリポジトリで決めるのは `specs/spec-ids.json` の領域 `NTA`、接頭辞 `nta_`、テストの glob だけです。

## 役割

| 役割 | 書いてよいもの | 書いてはいけないもの |
|---|---|---|
| Spec Steward | `specs/changes/<id>/` の草案、初版起こしの `specs/current/` 草案 | 実装、テストの期待値、承認前の `specs/current/` の直接編集 |
| Test Designer | 仕様 ID 付きの受入テスト | 実装を見て期待値を足すこと、仕様本文 |
| Coder | 実装 | `specs/current/`、テストを消して GREEN にすること |
| Spec Auditor | 食い違いの報告（ID 単位で GREEN / 意図が古い / 実装が古い / テストが古い / 判断できない） | 仕様・実装・テストのどれも |
| Spec Publisher | 承認済み差分の `specs/current/` への取り込み草案、`specs/releases/<tag>/` | 未承認の意図の追加 |

Steward と Coder と Auditor は同じ会話で起動しません。次の係には成果物のパスだけを渡し、要約して渡しません。

## 関連

- 出典: shuji-bonji/ai-design-advisor Discussion #21「仕様を担保するエージェントの導入と実践」
- family 全体の位置付け: houki-hub Issue #26 / #27
- 開発の手順とリリース手順: `CONTRIBUTING.md`

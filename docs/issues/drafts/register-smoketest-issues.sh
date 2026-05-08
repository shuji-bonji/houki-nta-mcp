#!/usr/bin/env bash
# houki-nta-mcp スモークテスト (2026-05-08) で発見された不整合 4 件を GitHub Issue 化するスクリプト
#
# 前提:
#   - macOS で `gh auth status` が通っている
#   - リポジトリディレクトリ (houki-nta-mcp) で実行する
#   - issue 本文ファイルが outputs/ にある (本スクリプトと同階層)
#
# 使い方:
#   chmod +x register-smoketest-issues.sh
#   ./register-smoketest-issues.sh

set -euo pipefail

REPO="shuji-bonji/houki-nta-mcp"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==== Issue #1 ===="
gh issue create --repo "$REPO" \
  --title "legal_status を docType 別に整備 (LEGAL_STATUS_BY_DOCTYPE 一元化)" \
  --label "enhancement" \
  --body-file "$DIR/issue-1-legal-status-by-doctype.md"

echo "==== Issue #2 ===="
gh issue create --repo "$REPO" \
  --title "nta_search_bunshokaitou の legal_status.note に「文書回答事例」を含める" \
  --label "enhancement" \
  --body-file "$DIR/issue-2-search-bunshokaitou-note.md"

echo "==== Issue #3 ===="
gh issue create --repo "$REPO" \
  --title "search 系全体で通称→正式名の synonym 展開 (kaisei/bunshokaitou 等にも)" \
  --label "enhancement" \
  --body-file "$DIR/issue-3-synonym-expansion-document.md"

echo "==== Issue #5 ===="
gh issue create --repo "$REPO" \
  --title "freshness ロジックを houki-hub family 共有パッケージに昇格" \
  --label "enhancement" \
  --body-file "$DIR/issue-5-freshness-shared.md"

echo
echo "完了: 4 件の issue を $REPO に登録しました。"
echo "Note: smoketest #4 は Bug ではないと判明したため起票せず、"
echo "      docs/issues/smoketest-feedback-2026-05-08.md に SQL 証拠付き調査メモとして記録済み。"

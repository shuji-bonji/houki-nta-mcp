/**
 * MCP サーバーの起動時のログ（標準エラー出力の JSON の行）。
 *
 * v0.25.0（houki-nta-mcp #138、SPEC-NTA-CLI-ENTRY-009）から、`started` の行の次に、DB の絶対パスと
 * DB の場所を決めた設定を出す。この行のために DB を開かず、ファイルがあるかも確かめない
 * （ツールは呼び出しごとに DB を開くので、起動した後に CLI で作った DB も使える。起動時の有無を出すと古い情報になる）。
 */

import { PACKAGE_INFO } from './config.js';
import { resolveDbLocation } from './db/location.js';
import { logger } from './utils/logger.js';

export function logServerStarted(): void {
  logger.info(
    'server',
    `${PACKAGE_INFO.name} v${PACKAGE_INFO.version} started (MCP SDK v2 / #36: 添付 PDF の read_strategy / layout_note + save: true + next_actions（読み手は固定しない） + 「新旧対応表」表記ゆれ対応 / Phase 4-2: has_pdf filter / nta_inspect_pdf_meta / Phase 4-1: PDF kind classification / Phase 5: Resilience + Lv-3a soft-404 detection + Lv-3b menu.htm baseline drift)`
  );
  // MCP サーバーは --db-path を受け取らないので、設定は HOUKI_NTA_DB_PATH・XDG_CACHE_HOME・既定のどれか。
  // ホームディレクトリを ~ に置き換えない（利用者の端末にしか出ないため。SPEC-NTA-DB-SCHEMA-028）
  const location = resolveDbLocation();
  logger.info('server', `DB: ${location.absolutePath}（DB の場所の設定: ${location.setting}）`, {
    db_path: location.absolutePath,
    setting: location.setting,
  });
}

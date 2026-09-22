#!/usr/bin/env node
/**
 * 次の仕様 ID を表示する（採番）。
 *
 *   node scripts/next-spec-id.mjs specs/current/nta_get_tsutatsu/spec.md
 *     → SPEC-NTA-GET-TSUTATSU-014
 *   node scripts/next-spec-id.mjs nta_get_tsutatsu --count 3
 *     → 3 つ
 *   node scripts/next-spec-id.mjs nta_search_qa
 *     → SPEC-NTA-SEARCH-QA-001（まだ 1 件も無い機能）
 *
 * 引数は spec.md のパスか、specs/current/ 直下のディレクトリ名。機能はそこから導く。
 * 番号は、specs/current と specs/changes の見出しにあるその機能の最大番号 +1。
 * ファイルは書き換えない。番号の予約もしない。並行するブランチで同じ番号を振ったときは、
 * マージ時に check-spec-ids.mjs の重複検知で止まる。
 */
import { DOMAIN, basename, collectHeadings, featureOfDir, formatId, parseId, specFiles } from './spec-id-format.mjs';

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const target = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const count = Number(opt('--count', '1'));
if (!target || !Number.isInteger(count) || count < 1) {
  console.error('使い方: node scripts/next-spec-id.mjs <specs/current/<dir>/spec.md | <dir>> [--count 1]');
  process.exit(2);
}
const dirName = target.endsWith('spec.md') ? basename(target.replace(/\/spec\.md$/, '')) : basename(target);
const feature = featureOfDir(dirName);

let max = 0;
for (const id of collectHeadings(specFiles()).keys()) {
  const p = parseId(id);
  if (p && p.domain === DOMAIN && p.feature === feature && p.n > max) max = p.n;
}
if (max + count > 999) {
  console.error(`${feature} の番号が 3 桁を超えます（最大 ${max}）。ID の形式を見直してください`);
  process.exit(1);
}
console.log(Array.from({ length: count }, (_, i) => formatId(DOMAIN, feature, max + 1 + i)).join(' '));

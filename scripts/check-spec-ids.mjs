#!/usr/bin/env node
/**
 * 仕様 ID とテストの突き合わせ。
 *
 * - specs/current/** /spec.md と specs/changes/* /spec.md から `SPEC-<領域>-<機能>-<3 桁>` を集める
 * - src/** /*.test.ts と tests/** /*.test.ts の `describe(` / `it(` / `test(` の名前から同じ形を集める
 * - 次のどれかが 1 つでもあれば exit 1
 *   1. 仕様の見出し（`### SPEC-…`）に同じ ID が 2 回以上ある（採番の衝突）
 *   2. 仕様にあってテストに無い ID
 *   3. テストにあって仕様に無い ID
 *   4. specs/current/<dir>/spec.md の見出しの ID の領域・機能が、このリポジトリの領域と
 *      そのディレクトリ名から導いた機能に一致しない（別の機能の数列を伸ばしている）
 *
 * 出典: shuji-bonji/ai-design-advisor Discussion #21 §5 手順 5。
 * このリポジトリは vitest なので対象は `*.spec.ts` ではなく `*.test.ts`。
 * ID を書く場所は `describe(` だけでなく `it(` の名前も認める（既存テストは
 * `it` 1 本が振る舞い 1 つに対応しているため。AGENTS.md「仕様 ID」を参照）。
 * ID の形式と走査は scripts/spec-id-format.mjs に置いている。
 */
import {
  DOMAIN,
  HEADING_RE,
  ID_RE,
  ROOT,
  TEST_NAME_RE,
  collect,
  collectHeadings,
  featureOfSpecPath,
  parseId,
  specFiles,
  testFiles,
} from './spec-id-format.mjs';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

const specs = specFiles();
const tests = testFiles();

const specIds = collect(specs, (text) => text.match(ID_RE) ?? []);
const testIds = collect(tests, (text) => {
  const ids = [];
  for (const m of text.matchAll(TEST_NAME_RE)) ids.push(...(m[2].match(ID_RE) ?? []));
  return ids;
});
const headings = collectHeadings(specs);

const duplicated = [...headings.entries()].filter(([, files]) => files.length > 1).sort();

// 4. 現行の spec.md の見出しは、そのディレクトリの機能の ID でなければならない
const misplaced = [];
for (const f of specs) {
  const feature = featureOfSpecPath(f);
  if (!feature) continue;
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(HEADING_RE)) {
    const p = parseId(m[1]);
    if (!p || p.domain !== DOMAIN || p.feature !== feature) {
      misplaced.push([m[1], relative(ROOT, f), `SPEC-${DOMAIN}-${feature}-###`]);
    }
  }
}
const missingTests = [...specIds.keys()].filter((id) => !testIds.has(id)).sort();
const missingSpecs = [...testIds.keys()].filter((id) => !specIds.has(id)).sort();

console.log(`spec files: ${specs.length}, spec IDs: ${specIds.size}（見出し: ${headings.size}）`);
console.log(`test files: ${tests.length}, test IDs: ${testIds.size}`);

let failed = false;
if (duplicated.length > 0) {
  failed = true;
  console.error('\n仕様の見出しに同じ ID が 2 回以上ある（採番の衝突）:');
  for (const [id, files] of duplicated) console.error(`  ${id}  (${files.join(', ')})`);
}
if (missingTests.length > 0) {
  failed = true;
  console.error('\n仕様にあってテストに無い ID:');
  for (const id of missingTests) console.error(`  ${id}  (${[...specIds.get(id)].join(', ')})`);
}
if (misplaced.length > 0) {
  failed = true;
  console.error('\n見出しの ID が、その spec.md のディレクトリから導いた機能と一致しない:');
  for (const [id, file, expected] of misplaced) console.error(`  ${id}  (${file}、期待する形: ${expected})`);
}
if (missingSpecs.length > 0) {
  failed = true;
  console.error('\nテストにあって仕様に無い ID:');
  for (const id of missingSpecs) console.error(`  ${id}  (${[...testIds.get(id)].join(', ')})`);
}
if (failed) {
  process.exit(1);
}
console.log('OK: 仕様 ID とテストが一致しています');

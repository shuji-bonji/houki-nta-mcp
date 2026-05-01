// Phase 2c probe: 章 1 のみで bulk DL → 検索を試す
import { openDb, closeDb } from '../dist/db/index.js';
import { bulkDownloadTsutatsu } from '../dist/services/bulk-downloader.js';
import { searchClauseFts, hasAnyClause } from '../dist/services/db-search.js';

const db = openDb(':memory:');
await bulkDownloadTsutatsu(db, {
  formalName: '消費税法基本通達',
  abbr: '消基通',
  onlyChapter: 1,
});
console.log('hasAnyClause:', hasAnyClause(db));
console.log();
console.log('=== 検索: "納税義務" ===');
for (const h of searchClauseFts(db, '納税義務', { limit: 5 })) {
  console.log(`  ${h.clauseNumber}（${h.title}）  rank=${h.rank.toFixed(2)}`);
  console.log(`    ${h.snippet.slice(0, 100)}`);
}
console.log();
console.log('=== 検索: "適格請求書" ===');
for (const h of searchClauseFts(db, '適格請求書', { limit: 5 })) {
  console.log(`  ${h.clauseNumber}（${h.title}）`);
}
console.log();
console.log('=== 複合検索: "課税 売上" ===');
for (const h of searchClauseFts(db, '課税 売上', { limit: 3 })) {
  console.log(`  ${h.clauseNumber}（${h.title}）`);
}
closeDb(db);

// Quick probe: parse a fixture HTML and print the structure summary.
// node scripts/probe-parser.mjs tests/fixtures/<file>.htm
import { readFileSync } from 'node:fs';
import { parseTsutatsuSection } from '../dist/services/tsutatsu-parser.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/probe-parser.mjs <fixture path>');
  process.exit(1);
}

const html = readFileSync(path, 'utf8');
const sec = parseTsutatsuSection(html, `https://example.com/${path}`);

console.log('# pageTitle    :', sec.pageTitle);
console.log('# chapterTitle :', sec.chapterTitle ?? '(none)');
console.log('# sectionTitle :', sec.sectionTitle);
console.log('# clauses      :', sec.clauses.length);
console.log('# fetchedAt    :', sec.fetchedAt);
console.log();

for (const c of sec.clauses) {
  console.log(`## ${c.clauseNumber}（${c.title}）  paragraphs=${c.paragraphs.length}`);
  for (const p of c.paragraphs) {
    const preview = p.text.length > 80 ? p.text.slice(0, 78) + '…' : p.text;
    console.log(`  [${p.indent}] ${preview}`);
  }
}

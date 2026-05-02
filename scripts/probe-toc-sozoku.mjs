import { readFileSync } from 'node:fs';
import { parseTsutatsuTocSozoku } from '../dist/services/tsutatsu-toc-parser-sozoku.js';
const html = readFileSync(process.argv[2], 'utf8');
const toc = parseTsutatsuTocSozoku(html, 'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/01.htm');
console.log('pageTitle:', toc.pageTitle);
console.log('chapters:', toc.chapters.length);
let total = 0;
for (const ch of toc.chapters) {
  console.log(`第${ch.number}章 ${ch.title} (${ch.sections.length} sections)`);
  total += ch.sections.length;
  for (const s of ch.sections.slice(0, 3)) {
    console.log(`  第${s.number}節 ${s.title.slice(0, 60)}`);
    console.log(`      → ${s.url}`);
  }
}
console.log('total sections:', total);

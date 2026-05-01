import { readFileSync } from 'node:fs';
import { parseTsutatsuTocShotoku } from '../dist/services/tsutatsu-toc-parser-shotoku.js';

const html = readFileSync(process.argv[2], 'utf8');
const toc = parseTsutatsuTocShotoku(html, 'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/01.htm');
console.log('pageTitle:', toc.pageTitle);
console.log('chapters:', toc.chapters.length);
let totalSections = 0;
for (const ch of toc.chapters) {
  console.log(`第${ch.number}章 ${ch.title} (${ch.sections.length} sections)`);
  totalSections += ch.sections.length;
  for (const s of ch.sections.slice(0, 2)) {
    console.log(`  第${s.number}節 ${s.title.slice(0, 40)}`);
    console.log(`      → ${s.url}`);
  }
}
console.log('total sections:', totalSections);

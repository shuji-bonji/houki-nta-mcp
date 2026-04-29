import { readFileSync } from 'node:fs';
import { parseTsutatsuToc } from '../dist/services/tsutatsu-toc-parser.js';
const html = readFileSync(process.argv[2], 'utf8');
const toc = parseTsutatsuToc(html, 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01.htm');
console.log('pageTitle:', toc.pageTitle);
console.log('chapters:', toc.chapters.length);
for (const ch of toc.chapters) {
  console.log(`第${ch.number}章 ${ch.title} (${ch.sections.length} sections)`);
  for (const s of ch.sections.slice(0, 3)) {
    console.log(`  第${s.number}節 ${s.title} -> ${s.url ?? '(no url)'}`);
    if (s.subsections) {
      for (const sub of s.subsections.slice(0, 2)) {
        console.log(`    第${sub.number}款 ${sub.title} -> ${sub.url ?? '(no url)'}`);
      }
    }
  }
}

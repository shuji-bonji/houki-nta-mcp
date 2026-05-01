import { readFileSync } from 'node:fs';
import { parseTsutatsuToc } from '../dist/services/tsutatsu-toc-parser.js';
import { parseTsutatsuTocShotoku } from '../dist/services/tsutatsu-toc-parser-shotoku.js';

const path = process.argv[2];
const html = readFileSync(path, 'utf8');
const url = `https://www.nta.go.jp/${path.replace(/^tests\/fixtures\//, '').replace(/_/g, '/')}`;

for (const [name, fn] of [['shohi-style', parseTsutatsuToc], ['shotoku-style', parseTsutatsuTocShotoku]]) {
  try {
    const toc = fn(html, url);
    console.log(`-- ${name}: chapters=${toc.chapters.length} sections=${toc.chapters.reduce((a,c)=>a+c.sections.length,0)}`);
    for (const ch of toc.chapters.slice(0, 3)) {
      console.log(`   第${ch.number}章 ${ch.title.slice(0,40)} (${ch.sections.length} sections)`);
      for (const s of ch.sections.slice(0, 2)) {
        console.log(`      第${s.number}節 ${s.title.slice(0,30)} → ${s.url ?? '(no url)'}`);
      }
    }
  } catch (e) {
    console.log(`-- ${name}: ERROR ${e?.message ?? e}`);
  }
}

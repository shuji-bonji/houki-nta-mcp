import { readFileSync } from 'node:fs';
import { parseJimuUneiIndex, parseJimuUneiPage } from '../dist/services/jimu-unei-parser.js';

console.log('=== 索引 ===');
{
  const html = readFileSync('tests/fixtures/www.nta.go.jp_law_jimu-unei_jimu.htm', 'utf8');
  const url = 'https://www.nta.go.jp/law/jimu-unei/jimu.htm';
  const entries = parseJimuUneiIndex(html, url);
  console.log(`entries: ${entries.length}`);
  for (const e of entries.slice(0, 8)) {
    console.log(`  ${e.issuedAt ?? '-         '} ${e.title.slice(0, 50)}`);
    console.log(`    -> ${e.url}`);
  }
}

console.log('\n=== 個別: 170331 ===');
{
  const html = readFileSync('tests/fixtures/www.nta.go.jp_law_jimu-unei_shotoku_shinkoku_170331_index.htm', 'utf8');
  const url = 'https://www.nta.go.jp/law/jimu-unei/shotoku/shinkoku/170331/index.htm';
  const doc = parseJimuUneiPage(html, url, '2026-05-02T00:00:00.000Z');
  console.log('docId:', doc.docId);
  console.log('taxonomy:', doc.taxonomy);
  console.log('title:', doc.title.slice(0, 60));
  console.log('issuedAt:', doc.issuedAt);
  console.log('issuer:', doc.issuer?.slice(0, 80));
  console.log('fullText.length:', doc.fullText.length);
  console.log('attachedPdfs:', doc.attachedPdfs.length);
  for (const p of doc.attachedPdfs.slice(0, 3)) console.log(`  ${p.title.slice(0, 50)} (${p.sizeKb}KB)`);
}

console.log('\n=== 個別: sozoku/170111_1 ===');
{
  const html = readFileSync('tests/fixtures/www.nta.go.jp_law_jimu-unei_sozoku_170111_1_01.htm', 'utf8');
  const url = 'https://www.nta.go.jp/law/jimu-unei/sozoku/170111_1/01.htm';
  const doc = parseJimuUneiPage(html, url, '2026-05-02T00:00:00.000Z');
  console.log('docId:', doc.docId);
  console.log('taxonomy:', doc.taxonomy);
  console.log('title:', doc.title.slice(0, 60));
  console.log('issuedAt:', doc.issuedAt);
}

import { readFileSync } from 'node:fs';
import { parseKaiseiIndex } from '../dist/services/kaisei-toc-parser.js';
import { parseKaiseiPage } from '../dist/services/kaisei-parser.js';

// 1. 索引 parser
console.log('=== 索引 (消基通) ===');
{
  const html = readFileSync('tests/fixtures/www.nta.go.jp_law_tsutatsu_kihon_shohi_kaisei_kaisei_a.htm', 'utf8');
  const url = 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei_a.htm';
  const entries = parseKaiseiIndex(html, url);
  console.log(`entries: ${entries.length}`);
  for (const e of entries.slice(0, 5)) {
    console.log(`  ${e.issuedAt ?? '????-??-??'} ${e.title.slice(0, 50)}`);
    console.log(`    -> ${e.url}`);
  }
}

console.log('\n=== 個別ページ (令和8年4月) ===');
{
  const html = readFileSync('tests/fixtures/www.nta.go.jp_law_tsutatsu_kihon_shohi_kaisei_0026003-067_index.htm', 'utf8');
  const url = 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/0026003-067/index.htm';
  const doc = parseKaiseiPage(html, url, '2026-05-02T00:00:00.000Z');
  console.log(`docType: ${doc.docType}`);
  console.log(`docId: ${doc.docId}`);
  console.log(`taxonomy: ${doc.taxonomy}`);
  console.log(`title: ${doc.title}`);
  console.log(`issuedAt: ${doc.issuedAt}`);
  console.log(`issuer: ${doc.issuer}`);
  console.log(`fullText.length: ${doc.fullText.length}`);
  console.log(`fullText preview: ${doc.fullText.slice(0, 100)}`);
  console.log(`attachedPdfs:`);
  for (const p of doc.attachedPdfs) {
    console.log(`  ${p.title} (${p.sizeKb}KB) -> ${p.url}`);
  }
}

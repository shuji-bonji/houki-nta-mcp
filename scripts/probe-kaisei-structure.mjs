import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';

function probe(label, fpath) {
  console.log(`\n=== ${label} ===`);
  const html = readFileSync(fpath, 'utf8');
  const $ = cheerio.load(html);
  const $body = $('div.imp-cnt-tsutatsu#bodyArea').first();
  console.log(`bodyArea: ${$body.length > 0 ? 'OK' : 'NG'}`);
  console.log(`title: ${$('title').first().text().trim()}`);
  console.log(`H1: ${$body.find('h1').first().text().trim().slice(0, 80)}`);
  console.log(`H2 count: ${$body.find('h2').length}`);
  // a[href] サンプル（kaisei 配下のもののみ）
  const links = [];
  $body.find('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const text = $(a).text().trim().replace(/\s+/g, ' ');
    if (href.includes('/kaisei/') && !href.includes('kaisei_')) {
      links.push({ href, text: text.slice(0, 80) });
    }
  });
  console.log(`kaisei links: ${links.length}`);
  for (const l of links.slice(0, 5)) console.log(`  ${l.text} -> ${l.href}`);
  if (links.length > 5) console.log(`  ... +${links.length - 5}`);
  // p 内の主要テキスト（10 行まで）
  console.log(`\n--- p contents (first 10) ---`);
  $body.find('p').slice(0, 10).each((i, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text) console.log(`  [${i}] ${text.slice(0, 80)}`);
  });
}

probe(
  '消基通改正索引',
  'tests/fixtures/www.nta.go.jp_law_tsutatsu_kihon_shohi_kaisei_kaisei_a.htm'
);
probe(
  '消基通 個別改正 (令和8年4月)',
  'tests/fixtures/www.nta.go.jp_law_tsutatsu_kihon_shohi_kaisei_0026003-067_index.htm'
);

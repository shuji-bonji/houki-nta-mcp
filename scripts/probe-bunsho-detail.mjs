import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';

function probe(label, fpath) {
  console.log(`\n=== ${label} ===`);
  const html = readFileSync(fpath, 'utf8');
  const $ = cheerio.load(html);
  console.log(`Title: ${$('title').first().text().trim()}`);
  const $body =
    $('div.imp-cnt-tsutatsu#bodyArea').first().length > 0
      ? $('div.imp-cnt-tsutatsu#bodyArea').first()
      : $('div.imp-cnt#bodyArea').first().length > 0
        ? $('div.imp-cnt#bodyArea').first()
        : $('#bodyArea').first();
  console.log(`bodyArea: ${$body.length > 0}`);
  const h1 = $body.find('h1').first().text().trim().replace(/\s+/g, ' ');
  console.log(`h1: ${h1.slice(0, 80)}`);
  console.log(`H2: ${$body.find('h2').slice(0, 5).map((_, e) => $(e).text().trim().replace(/\s+/g, ' ').slice(0, 50)).get().join(' / ')}`);
  // 本文段落のサンプル
  const ps = $body.find('p').slice(0, 8).map((_, e) => $(e).text().trim().replace(/\s+/g, ' ')).get().filter(Boolean).slice(0, 6);
  for (const p of ps) console.log(`  p: ${p.slice(0, 80)}`);
  // PDF リンク
  const pdfs = [];
  $body.find('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (href && /\.pdf(\?|$)/i.test(href)) pdfs.push({ href, text: $(a).text().trim().slice(0, 50) });
  });
  console.log(`PDFs: ${pdfs.length}`);
  for (const p of pdfs.slice(0, 3)) console.log(`  ${p.text} -> ${p.href}`);
}

probe(
  '個別: 本庁系 (250416)',
  'tests/fixtures/www.nta.go.jp_law_bunshokaito_shotoku_250416_index.htm'
);
probe(
  '個別: 国税局系 (260218 東京)',
  'tests/fixtures/www.nta.go.jp_about_organization_tokyo_bunshokaito_shotoku_260218_index.htm'
);

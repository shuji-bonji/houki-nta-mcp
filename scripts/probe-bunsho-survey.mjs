import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import * as cheerio from 'cheerio';

async function survey(label, url) {
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${url}`);
  try {
    const r = await fetchNtaPage(url);
    const $ = cheerio.load(r.html);
    console.log(`HTTP ${r.status} ${r.html.length}B charset=${r.charset}`);
    console.log(`Title: ${$('title').first().text().trim()}`);
    const $body =
      $('div.imp-cnt-tsutatsu#bodyArea').first().length > 0
        ? $('div.imp-cnt-tsutatsu#bodyArea').first()
        : $('div.imp-cnt#bodyArea').first().length > 0
          ? $('div.imp-cnt#bodyArea').first()
          : $('#bodyArea').first();
    console.log(`bodyArea OK: ${$body.length > 0}`);
    const h = $body.find('h1, h2, h3').slice(0, 5).map((_, e) => $(e).text().trim().replace(/\s+/g, ' ').slice(0, 60)).get();
    console.log('headings:', h);
    // bunshokaito 配下リンクを抽出
    const links = [];
    $body.find('a[href]').each((_, a) => {
      const href = $(a).attr('href') ?? '';
      const text = $(a).text().trim().replace(/\s+/g, ' ');
      if (href.includes('/bunshokaito/') && text) links.push({ href, text: text.slice(0, 60) });
    });
    console.log(`bunshokaito links: ${links.length}`);
    for (const l of links.slice(0, 8)) console.log(`  ${l.text} -> ${l.href}`);
    if (links.length > 8) console.log(`  ... +${links.length - 8}`);
  } catch (e) {
    console.log(`ERROR: ${e?.message ?? e}`);
  }
  await new Promise(r => setTimeout(r, 1100));
}

// メイン索引
await survey('文書回答事例 メイン索引', 'https://www.nta.go.jp/law/bunshokaito/01.htm');
// 税目別索引（所得税 回答年月日順）
await survey('税目別: 所得税 02.htm', 'https://www.nta.go.jp/law/bunshokaito/shotoku/02.htm');
// 同 項目別
await survey('税目別: 所得税 02_1.htm（項目別）', 'https://www.nta.go.jp/law/bunshokaito/shotoku/02_1.htm');

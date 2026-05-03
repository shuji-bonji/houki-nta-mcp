import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import * as cheerio from 'cheerio';

async function survey(label, url, sampleN = 8) {
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${url}`);
  try {
    const r = await fetchNtaPage(url);
    const $ = cheerio.load(r.html);
    console.log(`HTTP ${r.status} ${r.html.length}B charset=${r.charset}`);
    console.log(`Title: ${$('title').first().text().trim()}`);
    // bodyArea セレクタ判定
    const $body =
      $('div.imp-cnt-tsutatsu#bodyArea').first().length > 0
        ? $('div.imp-cnt-tsutatsu#bodyArea').first()
        : $('div.imp-cnt#bodyArea').first().length > 0
          ? $('div.imp-cnt#bodyArea').first()
          : $('#bodyArea').first();
    console.log(`bodyArea OK: ${$body.length > 0}`);
    // 主要見出し
    const h = $body.find('h1, h2, h3').slice(0, 5).map((_, e) => $(e).text().trim().replace(/\s+/g, ' ').slice(0, 60)).get();
    console.log(`headings:`, h);
    // 個別 jimu-unei ページへのリンク（/jimu-unei/.../{id}/index.htm 系）
    const links = [];
    $body.find('a[href]').each((_, a) => {
      const href = $(a).attr('href') ?? '';
      const text = $(a).text().trim().replace(/\s+/g, ' ');
      if (/\/jimu-unei\/.+\/(index|01)\.htm$/.test(href) && text) {
        links.push({ href, text: text.slice(0, 60) });
      }
    });
    console.log(`jimu-unei links: ${links.length}`);
    for (const l of links.slice(0, sampleN)) console.log(`  ${l.text} -> ${l.href}`);
  } catch (e) {
    console.log(`ERROR ${e?.message ?? e}`);
  }
  await new Promise(r => setTimeout(r, 1100));
}

await survey('事務運営指針 索引', 'https://www.nta.go.jp/law/jimu-unei/jimu.htm', 12);
await survey('個別: 平成17年所得税 (170331)', 'https://www.nta.go.jp/law/jimu-unei/shotoku/shinkoku/170331/index.htm');

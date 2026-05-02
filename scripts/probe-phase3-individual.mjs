import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import * as cheerio from 'cheerio';

async function inspect(label, url) {
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${url}`);
  try {
    const r = await fetchNtaPage(url);
    const $ = cheerio.load(r.html);
    console.log(`HTTP: ${r.status} ${r.html.length}B charset=${r.charset}`);
    console.log(`Title: ${$('title').first().text().trim()}`);
    // bodyArea (通達系) または別構造
    const $body =
      $('div.imp-cnt-tsutatsu#bodyArea').first().length > 0
        ? $('div.imp-cnt-tsutatsu#bodyArea').first()
        : $('#bodyArea').first().length > 0
          ? $('#bodyArea').first()
          : $('body');
    console.log(`bodyArea found: ${$body.length > 0}`);
    // 主要見出しを順に
    console.log('Headings:');
    $body.find('h1, h2, h3').slice(0, 10).each((_, el) => {
      console.log(`  <${el.tagName}> ${$(el).text().trim().replace(/\s+/g, ' ').slice(0, 60)}`);
    });
    // 段落のサンプル
    console.log('Paragraph samples:');
    $body.find('p').slice(0, 5).each((_, el) => {
      const t = $(el).text().trim().replace(/\s+/g, ' ').slice(0, 80);
      if (t) console.log(`  ${t}`);
    });
    // ファイル添付候補（PDF 等）
    const pdfs = [];
    $body.find('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && /\.pdf(\?|$)/.test(href)) {
        pdfs.push({ text: $(el).text().trim().slice(0, 60), href });
      }
    });
    if (pdfs.length) {
      console.log(`PDFs: ${pdfs.length}`);
      for (const p of pdfs.slice(0, 3)) console.log(`  ${p.text} -> ${p.href}`);
    }
    await new Promise(r => setTimeout(r, 1100));
  } catch (e) {
    console.log(`ERROR: ${e?.message ?? e}`);
  }
}

// 各種別から 1 件ずつ
await inspect(
  '文書回答事例 — 所得税の代表例',
  'https://www.nta.go.jp/law/bunshokaito/shotoku/02.htm'
);
await inspect(
  '事務運営指針 — 所得税 平成17年',
  'https://www.nta.go.jp/law/jimu-unei/shotoku/shinkoku/170331/index.htm'
);
await inspect(
  '改正通達 — 消基通 令和8年4月',
  'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/0026003-067/index.htm'
);
await inspect(
  'インボイス制度概要',
  'https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice_about.htm'
);

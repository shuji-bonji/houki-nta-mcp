import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import * as cheerio from 'cheerio';

async function detail(label, url) {
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${url}`);
  try {
    const r = await fetchNtaPage(url);
    const $ = cheerio.load(r.html);
    console.log(`HTTP: ${r.status} ${r.html.length}B charset=${r.charset}`);
    console.log(`Title: ${$('title').first().text().trim()}`);
    // 主要見出しと、本文配下のリンク種別
    const h2s = $('h2').map((_, el) => $(el).text().trim().replace(/\s+/g, ' ')).get();
    console.log(`H2s (${h2s.length}):`, h2s.slice(0, 10));
    // 拡張子別リンク数
    const exts = {};
    const samples = { pdf: [], htm: [] };
    $('a[href]').each((_, a) => {
      const href = $(a).attr('href');
      if (!href) return;
      const ext = (href.match(/\.(\w+)(?:[?#]|$)/) || [])[1]?.toLowerCase();
      if (!ext) return;
      exts[ext] = (exts[ext] || 0) + 1;
      const text = $(a).text().trim().replace(/\s+/g, ' ').slice(0, 50);
      if (samples[ext] && samples[ext].length < 3) {
        samples[ext].push({ text, href });
      }
    });
    console.log(`Link extensions:`, exts);
    if (samples.pdf.length) {
      console.log(`PDF samples:`);
      for (const s of samples.pdf) console.log(`  ${s.text} -> ${s.href}`);
    }
    if (samples.htm.length) {
      console.log(`HTM samples:`);
      for (const s of samples.htm) console.log(`  ${s.text} -> ${s.href}`);
    }
    await new Promise(r => setTimeout(r, 1100));
  } catch (e) {
    console.log(`ERROR: ${e?.message ?? e}`);
  }
}

await detail('文書回答事例 索引', 'https://www.nta.go.jp/law/bunshokaito/01.htm');
await detail('事務運営指針 索引', 'https://www.nta.go.jp/law/jimu-unei/jimu.htm');
await detail('インボイス特設', 'https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice.htm');
await detail('消基通 一部改正通達 索引', 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei_a.htm');

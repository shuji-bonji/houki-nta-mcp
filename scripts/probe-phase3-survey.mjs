import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import * as cheerio from 'cheerio';

async function survey(label, url) {
  console.log(`\n=== ${label} ===`);
  try {
    const r = await fetchNtaPage(url);
    const $ = cheerio.load(r.html);
    const title = $('title').first().text().trim();
    console.log(`URL: ${url}`);
    console.log(`HTTP: ${r.status} ${r.html.length}B charset=${r.charset}`);
    console.log(`Title: ${title}`);
    // 本文中のリンクを類推
    const links = [];
    $('a[href]').each((_, a) => {
      const href = $(a).attr('href');
      const text = $(a).text().trim().replace(/\s+/g, ' ');
      if (!text || !href) return;
      if (text.length > 50) return;
      if (href.startsWith('#') || href.startsWith('mailto:')) return;
      // 法令系のリンクだけに絞る
      if (text.match(/(文書回答|事務運営|インボイス|質疑|回答|改正|通達|軽減税率)/)) {
        links.push({ text, href });
      }
    });
    for (const l of links.slice(0, 20)) {
      console.log(`  ${l.text} -> ${l.href}`);
    }
    if (links.length > 20) console.log(`  ... +${links.length - 20} more`);
    await new Promise(r => setTimeout(r, 1100));
  } catch (e) {
    console.log(`ERROR: ${e?.message ?? e}`);
  }
}

await survey('国税庁トップ', 'https://www.nta.go.jp/');
await survey('法令等トップ', 'https://www.nta.go.jp/law/index.htm');
await survey('通達トップ', 'https://www.nta.go.jp/law/tsutatsu/menu.htm');
await survey('質疑応答事例トップ', 'https://www.nta.go.jp/law/shitsugi/');

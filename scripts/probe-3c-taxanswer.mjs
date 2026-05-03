import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import * as cheerio from 'cheerio';

async function survey(label, url) {
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${url}`);
  try {
    const r = await fetchNtaPage(url);
    const $ = cheerio.load(r.html);
    console.log(`HTTP ${r.status} ${r.html.length}B`);
    console.log(`Title: ${$('title').first().text().trim()}`);
    const $body = $('#bodyArea').first();
    // タックスアンサー個別へのリンクを集計
    const links = [];
    $body.find('a[href]').each((_, a) => {
      const href = $(a).attr('href') ?? '';
      const text = $(a).text().trim().replace(/\s+/g, ' ');
      if (/\/taxes\/shiraberu\/taxanswer\/[^/]+\/\d+\.htm$/.test(href)) {
        links.push({ href, text: text.slice(0, 50) });
      }
    });
    console.log(`tax answer 個別リンク: ${links.length}`);
    for (const l of links.slice(0, 10)) console.log(`  ${l.text.slice(0, 40)} -> ${l.href}`);
    // bunya-* / shotoku/index.htm 系
    const indexLinks = [];
    $body.find('a[href]').each((_, a) => {
      const href = $(a).attr('href') ?? '';
      if (/taxanswer.*(?:bunya|index|all)/.test(href)) {
        indexLinks.push(href);
      }
    });
    if (indexLinks.length) console.log(`関連索引: ${[...new Set(indexLinks)].slice(0, 6).join(' / ')}`);
  } catch (e) {
    console.log(`ERROR: ${e?.message ?? e}`);
  }
  await new Promise((r) => setTimeout(r, 1100));
}

// 税目別 index ページの可能性
await survey('タックスアンサー 所得税 index', 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/index.htm');
await survey('タックスアンサー 法人税 index', 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/index.htm');
await survey('タックスアンサー code/bunya all', 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/code/index2.htm');
// サイトマップ的なものはないか
await survey('タックスアンサー 検索/索引', 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/code/');

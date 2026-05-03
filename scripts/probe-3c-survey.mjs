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
    const h = $body
      .find('h1, h2, h3')
      .slice(0, 5)
      .map((_, e) => $(e).text().trim().replace(/\s+/g, ' ').slice(0, 60))
      .get();
    console.log('headings:', h);
    // 個別 URL リンクを集計
    const taxAnswerLinks = [];
    const qaLinks = [];
    $body.find('a[href]').each((_, a) => {
      const href = $(a).attr('href') ?? '';
      const text = $(a).text().trim().replace(/\s+/g, ' ');
      if (!href || !text) return;
      if (/\/taxes\/shiraberu\/taxanswer\/[^/]+\/\d+\.htm$/.test(href)) {
        taxAnswerLinks.push({ href, text: text.slice(0, 50) });
      }
      if (/\/law\/shitsugi\/[^/]+\/\d+\/\d+\.htm$/.test(href)) {
        qaLinks.push({ href, text: text.slice(0, 50) });
      }
    });
    if (taxAnswerLinks.length) {
      console.log(`tax answer links: ${taxAnswerLinks.length}`);
      for (const l of taxAnswerLinks.slice(0, 5)) console.log(`  ${l.text} -> ${l.href}`);
    }
    if (qaLinks.length) {
      console.log(`qa links: ${qaLinks.length}`);
      for (const l of qaLinks.slice(0, 5)) console.log(`  ${l.text} -> ${l.href}`);
    }
  } catch (e) {
    console.log(`ERROR: ${e?.message ?? e}`);
  }
  await new Promise((r) => setTimeout(r, 1100));
}

// タックスアンサー索引（税目別）
await survey('タックスアンサー トップ', 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/index2.htm');
// 税目別 (例: 消費税)
await survey('タックスアンサー 消費税', 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/code/bunya-syohizei.htm');

// 質疑応答事例 索引（税目別）
await survey('QA 索引 消費税', 'https://www.nta.go.jp/law/shitsugi/shohi/01.htm');
await survey('QA 索引 所得税', 'https://www.nta.go.jp/law/shitsugi/shotoku/01.htm');

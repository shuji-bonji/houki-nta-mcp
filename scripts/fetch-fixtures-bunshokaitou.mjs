// 文書回答事例 (bunshokaitou) の索引・税目別索引・個別事例を fixture に取り込む。
// node scripts/fetch-fixtures-bunshokaitou.mjs

import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import { writeFileSync } from 'node:fs';

const URLS = [
  // メイン索引
  'https://www.nta.go.jp/law/bunshokaito/01.htm',
  // 所得税 税目別索引（回答年月日順）
  'https://www.nta.go.jp/law/bunshokaito/shotoku/02.htm',
  // 個別事例: 本庁系（/law/bunshokaito/...）
  'https://www.nta.go.jp/law/bunshokaito/shotoku/250416/index.htm',
  // 個別事例: 国税局系（/about/organization/.../bunshokaito/...）
  'https://www.nta.go.jp/about/organization/tokyo/bunshokaito/shotoku/260218/index.htm',
  // 別税目: 法人税（参考）
  'https://www.nta.go.jp/law/bunshokaito/hojin/06.htm',
];

for (const url of URLS) {
  try {
    const r = await fetchNtaPage(url);
    const slug = url.replace(/^https?:\/\//, '').replace(/\//g, '_');
    const out = `tests/fixtures/${slug}`;
    writeFileSync(out, r.html, 'utf8');
    console.error(`OK ${r.status} ${r.html.length}B charset=${r.charset} -> ${out}`);
  } catch (e) {
    console.error(`NG ${url}: ${e?.message ?? e}`);
  }
  await new Promise((r) => setTimeout(r, 1100));
}

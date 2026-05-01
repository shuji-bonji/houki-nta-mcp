// 法基通 / 相基通 の TOC + 代表的な節 fixture を取得。
// node scripts/fetch-fixtures-hojin-sozoku.mjs

import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import { writeFileSync } from 'node:fs';

const URLS = [
  // 法基通
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01.htm',
  // 相基通
  'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/01.htm',
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

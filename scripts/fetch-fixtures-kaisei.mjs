// 改正通達 (kaisei) の索引 + 代表的な個別ページを fixture に取り込む。
// node scripts/fetch-fixtures-kaisei.mjs

import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import { writeFileSync } from 'node:fs';

const URLS = [
  // 4 通達の改正索引
  'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei_a.htm',
  'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/kaisei/kaisei_a.htm',
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/kaisei/kaisei_a.htm',
  'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku/kaisei/kaisei_a.htm',
  // 個別改正通達ページ（消基通の最新分）
  'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/0026003-067/index.htm',
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

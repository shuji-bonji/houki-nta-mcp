// 事務運営指針 (jimu-unei) の索引 + 代表的な個別ページを fixture に取り込む。
// node scripts/fetch-fixtures-jimu-unei.mjs

import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import { writeFileSync } from 'node:fs';

const URLS = [
  // 索引
  'https://www.nta.go.jp/law/jimu-unei/jimu.htm',
  // 代表個別: index.htm 形式
  'https://www.nta.go.jp/law/jimu-unei/shotoku/shinkoku/170331/index.htm',
  // 代表個別: 01.htm 形式（さらにシンプル）
  'https://www.nta.go.jp/law/jimu-unei/shotoku/shinkoku/090401/01.htm',
  // 別税目（相続税）
  'https://www.nta.go.jp/law/jimu-unei/sozoku/170111_1/01.htm',
  // 法人課税部門書面添付制度
  'https://www.nta.go.jp/law/jimu-unei/hojin/090401/01.htm',
  // 源泉所得税
  'https://www.nta.go.jp/law/jimu-unei/shotoku/gensen/000703/01.htm',
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

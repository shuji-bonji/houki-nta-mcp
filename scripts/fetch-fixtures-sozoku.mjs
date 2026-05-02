// 相基通の代表的な節（実体は 1 ファイルに複数 clause が anchor 付きで同居）を fixtures に取り込む。
// node scripts/fetch-fixtures-sozoku.mjs

import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import { writeFileSync } from 'node:fs';

const URLS = [
  // 第1章 総則 第1節 通則 / 第1条の2((定義))関係（最初のファイル、1 clause）
  'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/01/00.htm',
  // 第1章 総則 第1節 通則 / 第1条の3・1の4 共通関係（複数 clause、ナカグロ番号）
  'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/01/01.htm',
  // 第1章 総則 第2節 第3条関係 / 多数の clause を含む
  'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/01/02.htm',
  // 第3章 財産の評価（複数の条グループが 1 ファイルに同居 — 23/24/25/26 条）
  'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/03/01.htm',
  // 第4章 申告及び納付
  'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/04/01.htm',
  // 第6章 延納及び物納
  'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/06/01.htm',
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

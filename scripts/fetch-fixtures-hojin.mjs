// 法基通の代表的な節ページを fixtures に取り込む。
// 章 / 節 / 款 のバリエーションを意図的に散らしている。
// node scripts/fetch-fixtures-hojin.mjs

import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import { writeFileSync } from 'node:fs';

const URLS = [
  // 第1章 第1節（最小ケース）
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01/01_01.htm',
  // 第2章 第1款（款を含む節）
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/02/02_01_01.htm',
  // 第2章 「第1款の2」（枝番款）
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/02/02_01_01_2.htm',
  // 第7章 減価償却（多くの clause が並ぶ）
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/07/07_01_01.htm',
  // 第9章 その他の損金（複雑な構造）
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/09/09_02_03.htm',
  // 第18章 国際最低課税（新しい章）
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/18/18_01_01.htm',
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

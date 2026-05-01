// 所基通の代表的な節ページを fixtures に取り込む。
// node scripts/fetch-fixtures-shotoku.mjs
//
// 編・章・節のバリエーションを意図的に散らしている:
//   - 第1編第1章 第1節（通則：小さい章）
//   - 第2編第1章 第1節（課税標準：大きい章の先頭）
//   - 第2編第1章 第5節（同章の中の別節 — 章が同じで節が違うパターン）
//   - 第2編第2章 第1節（編の中の別の章）
//   - 第3編第1章 第1節（編が変わったパターン — 国内源泉所得）
//   - 第6編第3章 第1節（源泉徴収 — 給与所得に係る）
//
// parseTsutatsuSection の互換性確認 + 必要なら専用 parser 切り出しの判定材料に使う。

import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import { writeFileSync } from 'node:fs';

const URLS = [
  'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/01/01.htm',
  'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/04/01.htm',
  'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/04/05.htm',
  'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/17/01.htm',
  'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/22/01.htm',
  'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/30/01.htm',
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
  // 1 req/sec を超えない
  await new Promise((r) => setTimeout(r, 1100));
}

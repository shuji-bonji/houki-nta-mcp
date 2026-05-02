import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import { parseTsutatsuSection } from '../dist/services/tsutatsu-parser.js';

const urls = [
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01/01_01.htm',
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01/01_02.htm',
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01/01_03.htm',
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01/01_03_02.htm',
  'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01/01_04.htm',
];
for (const url of urls) {
  const r = await fetchNtaPage(url);
  const sec = parseTsutatsuSection(r.html, url);
  const nums = sec.clauses.map(c => c.clauseNumber);
  console.log(url.split('/').pop(), '->', nums.join(' / '));
  await new Promise(r => setTimeout(r, 1100));
}

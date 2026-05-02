import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import { parseTsutatsuSection } from '../dist/services/tsutatsu-parser.js';

const url = 'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01/01_04.htm';
try {
  const r = await fetchNtaPage(url);
  console.log('fetched:', r.status, r.html.length, 'B charset=', r.charset);
  // 保存
  const fs = await import('node:fs');
  fs.writeFileSync('tests/fixtures/www.nta.go.jp_law_tsutatsu_kihon_hojin_01_01_04.htm', r.html, 'utf8');
  // parse
  try {
    const sec = parseTsutatsuSection(r.html, url);
    console.log('chapterTitle:', sec.chapterTitle);
    console.log('sectionTitle:', sec.sectionTitle);
    console.log('clauses:', sec.clauses.length);
    for (const c of sec.clauses.slice(0, 3)) {
      console.log(' -', c.clauseNumber, c.title.slice(0, 30));
    }
  } catch (e) {
    console.log('PARSE THREW:', e?.constructor?.name, '-', e?.message);
    console.log('stack:', e?.stack?.split('\n').slice(0, 5).join('\n'));
  }
} catch (e) {
  console.log('FETCH THREW:', e?.constructor?.name, '-', e?.message);
}

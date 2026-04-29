// One-off fixture fetcher. Run after `npm run build`.
// node scripts/fetch-fixtures.mjs <url> [<url> ...]
import { fetchNtaPage } from '../dist/services/nta-scraper.js';
import { writeFileSync } from 'node:fs';

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('usage: node scripts/fetch-fixtures.mjs <url> [<url> ...]');
  process.exit(1);
}

for (const url of urls) {
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

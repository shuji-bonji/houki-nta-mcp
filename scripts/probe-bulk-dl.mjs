// Probe: 章 1 のみで bulk DL を実行して DB の中身を確認
import { openDb, closeDb } from '../dist/db/index.js';
import { bulkDownloadTsutatsu } from '../dist/services/bulk-downloader.js';

const db = openDb(':memory:');
const r = await bulkDownloadTsutatsu(db, {
  formalName: '消費税法基本通達',
  abbr: '消基通',
  onlyChapter: 1,
  onProgress: (p) => process.stderr.write('  ' + p.message + '\n'),
});
console.log('===result===');
console.log(JSON.stringify(r, null, 2));
console.log('===DB content===');
console.log('tsutatsu:', db.prepare('SELECT * FROM tsutatsu').all());
console.log('chapters:', db.prepare('SELECT count(*) as n FROM chapter').get());
console.log('sections:', db.prepare('SELECT count(*) as n FROM section').get());
console.log('clauses:', db.prepare('SELECT count(*) as n FROM clause').get());
console.log('===FTS5 search hits===');
const hits = db
  .prepare("SELECT clause_number, title FROM clause_fts WHERE clause_fts MATCH '消費税' LIMIT 5")
  .all();
console.log(hits);
console.log('===clause→URL lookup (1-1-1)===');
const lookup = db
  .prepare(
    'SELECT clause_number, source_url, title FROM clause WHERE tsutatsu_id = ? AND clause_number = ?'
  )
  .get(r.tsutatsuId, '1-1-1');
console.log(lookup);
closeDb(db);

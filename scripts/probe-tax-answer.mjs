import { readFileSync } from 'node:fs';
import { parseTaxAnswer } from '../dist/services/tax-answer-parser.js';
const html = readFileSync(process.argv[2], 'utf8');
const ta = parseTaxAnswer(html, 'https://example/x');
console.log('No.' + ta.no, ta.title);
console.log('  effectiveDate:', ta.effectiveDate);
console.log('  taxCategory  :', ta.taxCategory);
console.log('  sections     :', ta.sections.length);
for (const s of ta.sections) {
  console.log(`  ## ${s.heading} (${s.paragraphs.length} 段落)`);
  if (s.paragraphs[0]) console.log(`     ${s.paragraphs[0].slice(0, 60)}...`);
}

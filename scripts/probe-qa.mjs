import { readFileSync } from 'node:fs';
import { parseQaJirei } from '../dist/services/qa-parser.js';
const html = readFileSync(process.argv[2], 'utf8');
const qa = parseQaJirei({
  html,
  sourceUrl: 'https://example/x',
  topic: 'shohi',
  category: '02',
  id: '19',
});
console.log('Title    :', qa.title);
console.log('Topic    :', qa.topic, qa.category, qa.id);
console.log('照会要旨 :', qa.question.length, '段落');
qa.question.forEach((p, i) => console.log(`  [${i+1}] ${p.slice(0, 80)}...`));
console.log('回答要旨 :', qa.answer.length, '段落');
qa.answer.forEach((p, i) => console.log(`  [${i+1}] ${p.slice(0, 80)}...`));
console.log('関係法令通達:', qa.relatedLaws.length, '段落');
qa.relatedLaws.forEach((p, i) => console.log(`  [${i+1}] ${p.slice(0, 80)}`));

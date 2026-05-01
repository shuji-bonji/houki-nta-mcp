/**
 * Tax Answer / QA Markdown Renderer
 *
 * `TaxAnswer` / `QaJirei` を Markdown 文字列に整形する。
 * 出典 URL・取得時刻・参考資料の旨を末尾に付与する。
 */

import { NTA_GENERAL_INFO_LEGAL_STATUS } from '../constants.js';
import type { TaxAnswer } from '../types/tax-answer.js';
import type { QaJirei } from '../types/qa.js';

/** タックスアンサーを Markdown に整形 */
export function renderTaxAnswerMarkdown(t: TaxAnswer): string {
  const lines: string[] = [];
  lines.push(`# No.${t.no} ${t.title}`);
  lines.push('');
  if (t.effectiveDate) lines.push(`> 法令時点: ${t.effectiveDate}`);
  if (t.taxCategory) lines.push(`> 対象税目: ${t.taxCategory}`);
  if (t.effectiveDate || t.taxCategory) lines.push('');

  for (const sec of t.sections) {
    lines.push(`## ${sec.heading}`);
    lines.push('');
    for (const p of sec.paragraphs) {
      lines.push(p);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`出典: ${t.sourceUrl}`);
  lines.push(`取得: ${t.fetchedAt}`);
  lines.push('');
  lines.push(`> ${NTA_GENERAL_INFO_LEGAL_STATUS.note}`);

  return lines.join('\n').trimEnd() + '\n';
}

/** 質疑応答事例を Markdown に整形 */
export function renderQaMarkdown(q: QaJirei): string {
  const lines: string[] = [];
  lines.push(`# ${q.title}`);
  lines.push('');
  lines.push(`> 税目: ${q.topic} / カテゴリ: ${q.category} / 事例番号: ${q.id}`);
  lines.push('');

  if (q.question.length > 0) {
    lines.push('## 【照会要旨】');
    lines.push('');
    for (const p of q.question) {
      lines.push(p);
      lines.push('');
    }
  }

  if (q.answer.length > 0) {
    lines.push('## 【回答要旨】');
    lines.push('');
    for (const p of q.answer) {
      lines.push(p);
      lines.push('');
    }
  }

  if (q.relatedLaws.length > 0) {
    lines.push('## 【関係法令通達】');
    lines.push('');
    for (const p of q.relatedLaws) {
      lines.push(p);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`出典: ${q.sourceUrl}`);
  lines.push(`取得: ${q.fetchedAt}`);
  lines.push('');
  lines.push(`> ${NTA_GENERAL_INFO_LEGAL_STATUS.note}`);

  return lines.join('\n').trimEnd() + '\n';
}

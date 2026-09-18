/**
 * Tax Answer / QA Markdown Renderer
 *
 * `TaxAnswer` / `QaJirei` を Markdown 文字列に整形する。
 * 出典 URL・取得時刻・参考資料の旨を末尾に付与する。
 */

import { NTA_GENERAL_INFO_LEGAL_STATUS } from '../constants.js';
import type { QaJirei } from '../types/qa.js';
import type { TaxAnswer } from '../types/tax-answer.js';
import { REMOVED_FROM_INDEX, REMOVED_FROM_INDEX_NOTICE } from './index-status.js';

/**
 * 応答をどこから返したか（Issue #29）。
 *
 * - `'db'`: ローカル DB（`--bulk-download-*` で取り込んだもの）から返した
 * - `'live'`: この呼び出しで国税庁サイトから取得した
 */
export type DocumentSource = 'db' | 'live';

const SOURCE_LABEL: Record<DocumentSource, string> = {
  db: 'ローカル DB（bulk download で取り込んだもの）',
  live: '国税庁サイト（この呼び出しで取得）',
};

/** 索引から消えた文書に付ける行（Issue #30）。索引にある文書には何も足さない */
function indexStatusLines(orphanedAt: string | undefined): string[] {
  if (!orphanedAt) return [];
  return [
    `> **索引の状態**: ${REMOVED_FROM_INDEX}（${orphanedAt} に確認）`,
    `> ${REMOVED_FROM_INDEX_NOTICE}`,
    '',
  ];
}

/** タックスアンサーを Markdown に整形 */
export function renderTaxAnswerMarkdown(
  t: TaxAnswer,
  source?: DocumentSource,
  orphanedAt?: string
): string {
  const lines: string[] = [];
  lines.push(`# No.${t.no} ${t.title}`);
  lines.push('');
  if (t.effectiveDate) lines.push(`> 法令時点: ${t.effectiveDate}`);
  if (t.taxCategory) lines.push(`> 対象税目: ${t.taxCategory}`);
  if (t.effectiveDate || t.taxCategory) lines.push('');
  lines.push(...indexStatusLines(orphanedAt));

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
  if (source) lines.push(`取得元: ${SOURCE_LABEL[source]}`);
  lines.push('');
  lines.push(`> ${NTA_GENERAL_INFO_LEGAL_STATUS.note}`);

  return `${lines.join('\n').trimEnd()}\n`;
}

/** 質疑応答事例を Markdown に整形 */
export function renderQaMarkdown(q: QaJirei, source?: DocumentSource, orphanedAt?: string): string {
  const lines: string[] = [];
  lines.push(`# ${q.title}`);
  lines.push('');
  lines.push(`> 税目: ${q.topic} / カテゴリ: ${q.category} / 事例番号: ${q.id}`);
  lines.push('');
  lines.push(...indexStatusLines(orphanedAt));

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

  // Issue #22: ページ下部の注記（作成時点と、一般的な回答である旨の断り書き）
  if (q.notice) {
    lines.push('## 注記（国税庁）');
    lines.push('');
    lines.push(q.notice);
    lines.push('');
  }

  lines.push('---');
  lines.push(`出典: ${q.sourceUrl}`);
  lines.push(`取得: ${q.fetchedAt}`);
  if (source) lines.push(`取得元: ${SOURCE_LABEL[source]}`);
  lines.push('');
  lines.push(`> ${NTA_GENERAL_INFO_LEGAL_STATUS.note}`);

  return `${lines.join('\n').trimEnd()}\n`;
}

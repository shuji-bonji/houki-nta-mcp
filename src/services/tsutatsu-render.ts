/**
 * Tsutatsu Markdown Renderer
 *
 * `TsutatsuSection` / `TsutatsuClause` を Markdown 文字列に整形する。
 * MCP のレスポンス（`format: 'markdown'`）で使う。
 */

import { TSUTATSU_LEGAL_STATUS } from '../constants.js';
import type { TsutatsuClause, TsutatsuSection } from '../types/tsutatsu.js';

/** 単一 clause を Markdown に整形する */
export function renderClauseMarkdown(
  clause: TsutatsuClause,
  meta?: { sourceUrl?: string; fetchedAt?: string }
): string {
  const lines: string[] = [];
  lines.push(`## ${clause.clauseNumber}（${clause.title}）`);
  lines.push('');

  for (const p of clause.paragraphs) {
    if (p.indent === 1) {
      lines.push(p.text);
    } else if (p.indent === 2) {
      lines.push(`> ${p.text}`);
    } else {
      lines.push(`> > ${p.text}`);
    }
    lines.push('');
  }

  if (meta?.sourceUrl) {
    lines.push('---');
    lines.push(`出典: ${meta.sourceUrl}`);
    if (meta.fetchedAt) {
      lines.push(`取得: ${meta.fetchedAt}`);
    }
    lines.push('');
    lines.push(`> ${TSUTATSU_LEGAL_STATUS.note}`);
  }

  return lines.join('\n').trimEnd() + '\n';
}

/** セクション全体を Markdown に整形する（章タイトル / 節タイトル / 全 clause） */
export function renderSectionMarkdown(section: TsutatsuSection): string {
  const lines: string[] = [];
  lines.push(`# ${section.sectionTitle}`);
  lines.push('');

  if (section.chapterTitle) {
    lines.push(`**${section.chapterTitle}**`);
    lines.push('');
  }

  for (const c of section.clauses) {
    lines.push(`## ${c.clauseNumber}（${c.title}）`);
    lines.push('');
    for (const p of c.paragraphs) {
      if (p.indent === 1) {
        lines.push(p.text);
      } else if (p.indent === 2) {
        lines.push(`> ${p.text}`);
      } else {
        lines.push(`> > ${p.text}`);
      }
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`出典: ${section.sourceUrl}`);
  lines.push(`取得: ${section.fetchedAt}`);
  lines.push('');
  lines.push(`> ${TSUTATSU_LEGAL_STATUS.note}`);

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Tsutatsu Markdown Renderer
 *
 * `TsutatsuSection` / `TsutatsuClause` を Markdown 文字列に整形する。
 * MCP のレスポンス（`format: 'markdown'`）で使う。
 */

import { TSUTATSU_LEGAL_STATUS } from '../constants.js';
import type { TsutatsuClause, TsutatsuParagraph, TsutatsuSection } from '../types/tsutatsu.js';

/**
 * Issue #17 (v0.10.1): 本文に画像 (算式の GIF 等) が含まれるときの注記。
 * 利用側 (LLM / Skill 層) が「この clause の本文は画像の分だけ不完全」と判定できるように文で返す。
 * 画像が無ければ空配列。
 */
export function describeImageNotes(
  paragraphs: ReadonlyArray<Pick<TsutatsuParagraph, 'images'>>
): string[] {
  const images = paragraphs.flatMap((p) => p.images ?? []);
  if (images.length === 0) return [];
  const alts = images.map((i) => i.alt).filter((a) => a.length > 0);
  return [
    `本文に画像が ${images.length} 箇所含まれています（算式などが GIF 画像で掲載されている箇所）。画像の内容は取得できないため、本文には alt テキストを [画像: …] として同じ位置に残しています${
      alts.length > 0 ? `（${alts.map((a) => `"${a}"`).join(' / ')}）` : ''
    }。算式の正確な内容は出典 URL の原ページで確認してください`,
  ];
}

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

  for (const note of describeImageNotes(clause.paragraphs)) {
    lines.push(`> 注意: ${note}`);
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

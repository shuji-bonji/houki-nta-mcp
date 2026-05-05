/**
 * PDF Meta — 添付 PDF のタイトルから kind を分類するヘルパ。
 *
 * Phase 4 で追加。pdf-reader-mcp との責務分離原則に従い、houki-nta-mcp は
 * PDF 本文を読まず「メタ情報の整理と分類」のみ担う。
 *
 * 設計詳細: docs/PHASE4-PDF.md §3
 */

import { normalizeJpText } from './text-normalize.js';

/** 添付 PDF の種別。LLM が「どの PDF を読むべきか」を判断する材料 */
export type PdfKind =
  /** 新旧対照表・対比表（改正通達で頻出、改正点を知りたい時に最優先） */
  | 'comparison'
  /** 別紙・別表・様式・付録・添付（通達本体の参照先） */
  | 'attachment'
  /** Q&A・質疑応答・FAQ（PDF 形式の質疑応答） */
  | 'qa-pdf'
  /** 参考資料・関連資料（周辺情報） */
  | 'related'
  /** 通知・お知らせ・連絡 */
  | 'notice'
  /** 上記いずれにもマッチしない（フォールバック） */
  | 'unknown';

/**
 * kind 推定パターン。配列の上から優先的にマッチさせる。
 *
 * 優先順:
 *  1. comparison: 新旧対照表は他の文字列にも含まれる可能性があるので最優先
 *  2. qa-pdf:     「Q&A」を含む別紙より優先
 *  3. attachment: 一般的な付属資料
 *  4. notice:     お知らせ系
 *  5. related:    参考資料系
 */
const PATTERNS: ReadonlyArray<readonly [PdfKind, RegExp]> = [
  ['comparison', /新旧対照表|対比表/],
  ['qa-pdf', /Q\s*&\s*A|Ｑ\s*&\s*Ａ|質疑応答|FAQ|Ｆ\s*Ａ\s*Ｑ/i],
  ['attachment', /別紙|別表|様式|付録|添付資料/],
  ['notice', /通知|お知らせ|連絡/],
  ['related', /参考(資料)?|関連資料/],
];

/**
 * kind 推定用の積極的正規化。
 *
 * `normalizeJpText` は clause 番号や本文の保守的な正規化（数字・ハイフン・チルダ・空白）
 * しか行わないが、PDF タイトルの kind 分類では「Ｑ＆Ａ」「新旧 対照表」などの表記ゆれに
 * 強くマッチさせたい。そのため:
 *  - 全角英字 `Ａ-Ｚａ-ｚ` → 半角英字
 *  - 全角アンパサンド `＆` → ASCII `&`
 *  - 全角中黒以外の空白すべて除去（パターン内部の空白も含めて確実にマッチさせる）
 */
function normalizeForKind(title: string): string {
  return normalizeJpText(title)
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/＆/g, '&')
    .replace(/\s+/g, '');
}

/**
 * PDF タイトルから kind を推定する純関数。
 *
 * Normalize-everywhere 原則に従い、内部で全角・半角を統一してマッチ。
 * kind 分類用に追加で「全角英字→半角」「＆→&」「空白除去」も行う。
 *
 * @example
 * extractPdfKind('新旧対照表（PDF/470KB）')           // 'comparison'
 * extractPdfKind('別紙1 計算明細書')                    // 'attachment'
 * extractPdfKind('インボイス Q&A')                     // 'qa-pdf'
 * extractPdfKind('Ｑ＆Ａ')                              // 'qa-pdf' (全角)
 * extractPdfKind('新旧 対照表')                        // 'comparison' (空白あり)
 * extractPdfKind('参考資料')                            // 'related'
 * extractPdfKind('改正通達の取扱いについて（通知）')   // 'notice'
 * extractPdfKind('資料')                                // 'unknown'
 */
export function extractPdfKind(title: string): PdfKind {
  if (!title) return 'unknown';
  const normalized = normalizeForKind(title);
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(normalized)) return kind;
  }
  return 'unknown';
}

/**
 * kind に対応する絵文字（Markdown 出力で視認性を上げる用）。
 */
export const PDF_KIND_EMOJI: Record<PdfKind, string> = {
  comparison: '🔄',
  attachment: '📎',
  'qa-pdf': '❓',
  related: '📚',
  notice: '📢',
  unknown: '📄',
};

/**
 * kind の人間可読ラベル（日本語）。
 */
export const PDF_KIND_LABEL: Record<PdfKind, string> = {
  comparison: '新旧対照表',
  attachment: '別紙・別表',
  'qa-pdf': 'Q&A',
  related: '参考資料',
  notice: '通知・連絡',
  unknown: 'その他',
};

/**
 * すべての kind 値（テスト・列挙用）。
 */
export const ALL_PDF_KINDS: readonly PdfKind[] = [
  'comparison',
  'attachment',
  'qa-pdf',
  'related',
  'notice',
  'unknown',
];

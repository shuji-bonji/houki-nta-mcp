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
  // 国税庁は「新旧対照表」と「新旧対応表」の両方の表記を使う。
  // 例: kaisei /shohi/kaisei/pdf/b0025003-111.pdf のタイトル「新旧対応表」。
  // 「対照」「対応」両方を吸収する。「対比表」も別表記として包含。
  ['comparison', /新旧対(照|応)表|対比表/],
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

/**
 * Markdown 出力で kind 順にソートする際の優先度。小さいほど先に並ぶ。
 *
 * LLM の判断材料として「改正点を知りたい時に最優先で読む」`comparison` を最上位、
 * 「一般的には読まない」`notice` を最下位に配置。`unknown` は最後（情報なし）。
 */
const KIND_PRIORITY: Record<PdfKind, number> = {
  comparison: 0,
  attachment: 1,
  'qa-pdf': 2,
  related: 3,
  notice: 4,
  unknown: 5,
};

/**
 * pdf-reader-mcp 呼び出しの一言コメント（kind ごと）。
 * 「呼び出し例」JSON の前に `// ...` 形式で添える。
 */
const KIND_CALL_HINT: Record<PdfKind, string> = {
  comparison: '// 新旧対照表を読む（改正点を知りたい時に最優先）',
  attachment: '// 別紙・別表を読む（通達本文の参照先）',
  'qa-pdf': '// Q&A PDF を読む',
  related: '// 参考資料を読む',
  notice: '// 通知・連絡を読む',
  unknown: '// この PDF を読む',
};

/**
 * kind ごとの推奨 pdf-reader-mcp tool。
 *
 * v0.7.2 で `extract_tables` (pdf-reader-mcp v0.3.0+) を導入。
 *  - comparison: 新旧対照表は表構造が必須なので `extract_tables` 最優先。失敗時 `read_text` フォールバック。
 *  - attachment: 別紙・別表・様式は半分以上が表組み。`extract_tables` を推奨し、`read_text` を補助に。
 *  - qa-pdf / related / notice / unknown: 散文中心なので `read_text` のみ。
 */
const KIND_PRIMARY_TOOL: Record<PdfKind, 'extract_tables' | 'read_text'> = {
  comparison: 'extract_tables',
  attachment: 'extract_tables',
  'qa-pdf': 'read_text',
  related: 'read_text',
  notice: 'read_text',
  unknown: 'read_text',
};

/**
 * 推奨 tool の説明文（kind ごと）。`reader_hints.examples` の `note` に添える。
 */
const KIND_TOOL_NOTE: Record<PdfKind, string> = {
  comparison:
    'extract_tables で改正後/改正前の差分を表として抽出するのが最優先。失敗時は read_text に fallback。',
  attachment:
    'extract_tables で表組みの別紙・別表・様式を構造化抽出。本文ベースで読みたい時は read_text を併用。',
  'qa-pdf': 'read_text で全文を取得し、Q/A の流れを読む。',
  related: 'read_text で全文を取得。文脈次第で読むか判断。',
  notice: 'read_text で連絡内容を確認。LLM 要約には通常含めない。',
  unknown: 'read_text で先頭ページをサンプリングし、内容を把握する。',
};

/** `reader_hints.examples` の 1 件分。 */
export interface ReaderHintExample {
  kind: PdfKind;
  /** 推奨される pdf-reader-mcp tool 名 */
  tool: 'extract_tables' | 'read_text';
  /** 呼び出し引数。`extract_tables` でも `read_text` でも `url` を主軸にする */
  args: { url: string };
  /** kind ごとの一言ガイド */
  note: string;
}

/**
 * 添付 PDF 群から `reader_hints.examples` を生成する。
 *
 * 仕様 (v0.7.2):
 *  - 含まれる kind ごとに **代表例 1 件ずつ** を生成する。
 *  - 各 kind の代表例は KIND_PRIORITY 内で同 kind の先頭 PDF。
 *  - 推奨 tool は kind に応じて `extract_tables` (comparison/attachment) または `read_text`。
 *  - 出力順は KIND_PRIORITY と同じ（comparison が先頭）。
 *
 * これにより LLM は「どの PDF を、どの tool で、なぜ読むべきか」を 1 つのフィールドで判断できる。
 */
export function buildReaderHintExamples(pdfs: ReadonlyArray<AttachedPdfLike>): ReaderHintExample[] {
  if (pdfs.length === 0) return [];

  // kind ごとに「最初に出現した PDF」を覚える
  const seenByKind = new Map<PdfKind, AttachedPdfLike>();
  for (const pdf of pdfs) {
    const kind = pdf.kind ?? extractPdfKind(pdf.title);
    if (!seenByKind.has(kind)) seenByKind.set(kind, pdf);
  }

  // KIND_PRIORITY 順で並べる
  return Array.from(seenByKind.entries())
    .sort(([a], [b]) => KIND_PRIORITY[a] - KIND_PRIORITY[b])
    .map(([kind, pdf]) => ({
      kind,
      tool: KIND_PRIMARY_TOOL[kind],
      args: { url: pdf.url },
      note: KIND_TOOL_NOTE[kind],
    }));
}

/**
 * v0.6.0 期に投入された DB レコードは `attached_pdfs_json` に `kind` を持たない。
 * inspect / get 系の応答時に動的に補完する。kind 既設定なら何もしない。
 *
 * 純関数。新しい配列を返す（入力は変更しない）。
 */
export function fillMissingKinds<T extends AttachedPdfLike>(pdfs: ReadonlyArray<T>): T[] {
  return pdfs.map((pdf) => (pdf.kind ? pdf : { ...pdf, kind: extractPdfKind(pdf.title) }));
}

/**
 * Markdown のテーブルセル内で `|` をエスケープする。
 * パイプ文字がそのままだとテーブルの列区切りと衝突するため。
 */
function escapeMdTableCell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

/** 軽量な AttachedPdf 型（循環依存を避けるためここでローカル定義） */
interface AttachedPdfLike {
  title: string;
  url: string;
  sizeKb?: number;
  kind?: PdfKind;
}

/**
 * 添付 PDF を Phase 4-1 (v0.7.0) フォーマットの Markdown 行列に整形する。
 *
 * 出力構造:
 *   - `## 添付 PDF (N 件)` ヘッダ
 *   - pdf-reader-mcp 案内
 *   - 種別 / タイトル / サイズ / URL の表（kind 優先度でソート）
 *   - `### pdf-reader-mcp 呼び出し例` JSON ブロック（先頭 PDF）
 *
 * `pdfs` が空のときは空配列を返す。kind が undefined の PDF（v0.6.0 以前のレコード）
 * は `unknown` 扱いで描画する。
 *
 * 詳細仕様: docs/PHASE4-PDF.md §5.2
 */
export function renderAttachedPdfsMarkdown(pdfs: ReadonlyArray<AttachedPdfLike>): string[] {
  if (pdfs.length === 0) return [];

  // kind 優先度で安定ソート（同 kind 内は元の出現順を維持）
  const sorted = pdfs
    .map((pdf, idx) => ({ pdf, idx }))
    .sort((a, b) => {
      const pa = KIND_PRIORITY[a.pdf.kind ?? 'unknown'];
      const pb = KIND_PRIORITY[b.pdf.kind ?? 'unknown'];
      return pa !== pb ? pa - pb : a.idx - b.idx;
    })
    .map((x) => x.pdf);

  const lines: string[] = [];
  lines.push(`## 添付 PDF (${pdfs.length} 件)`);
  lines.push('');
  lines.push('> PDF 本文は `pdf-reader-mcp` の `read_text` で取得してください。');
  lines.push('');
  lines.push('| 種別 | タイトル | サイズ | URL |');
  lines.push('| --- | --- | --- | --- |');
  for (const pdf of sorted) {
    const kind = pdf.kind ?? 'unknown';
    const emoji = PDF_KIND_EMOJI[kind];
    const label = PDF_KIND_LABEL[kind];
    const size = pdf.sizeKb ? `${pdf.sizeKb}KB` : '—';
    lines.push(
      `| ${emoji} ${label} | ${escapeMdTableCell(pdf.title)} | ${size} | [link](${pdf.url}) |`
    );
  }

  // 呼び出し例 (v0.7.2 〜): 含まれる kind ごとに 1 例ずつ生成。
  // comparison / attachment は extract_tables を最優先で推奨し、それ以外は read_text。
  const examples = buildReaderHintExamples(sorted);
  if (examples.length > 0) {
    lines.push('');
    lines.push('### pdf-reader-mcp 呼び出し例');
    lines.push('');
    lines.push('```json');
    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i];
      lines.push(KIND_CALL_HINT[ex.kind]);
      lines.push(`{ "tool": "${ex.tool}", "args": { "url": "${ex.args.url}" } }`);
      if (i < examples.length - 1) lines.push('');
    }
    lines.push('```');
  }

  return lines;
}

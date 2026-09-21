/**
 * PDF Meta — 添付 PDF のタイトルから kind を分類するヘルパ。
 *
 * Phase 4 で追加。pdf-reader-mcp との責務分離原則に従い、houki-nta-mcp は
 * PDF 本文を読まず「メタ情報の整理と分類」のみ担う。
 *
 * v0.19.0（#36）: 読み手を pdf-reader-mcp に固定しない。kind ごとに「どう読むか」
 * （`read_strategy` / `layout_note`）を道具の名前を使わずに書き、pdf-reader-mcp への
 * 呼び出し例は `next_actions` に置く。
 *
 * 設計詳細: docs/PHASE4-PDF.md §3・§6、houki-hub の docs/DECISIONS.md（2026-09-21）
 */

import type { NextAction } from '../errors.js';
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
 * PDF の読み方（道具に依存しない）。
 *
 * - `tables`: 表として取る。表として取れないときは本文として読む
 * - `text`:   本文として通して読む
 * - `sample`: 先頭ページを読んで中身を確かめてから決める
 */
export type PdfReadStrategy = 'tables' | 'text' | 'sample';

/** `attachedPdfs[]` に付ける読み方の説明。どの PDF 読み取りツールでも使える言葉で書く */
export interface PdfReading {
  read_strategy: PdfReadStrategy;
  /** 紙面の組み方と、読むときに気を付ける点 */
  layout_note: string;
}

const KIND_READING: Record<PdfKind, PdfReading> = {
  comparison: {
    read_strategy: 'tables',
    layout_note:
      '改正後と改正前を左右 2 列に並べた表。国税庁の新旧対照表は左が改正後、右が改正前のことが多いが、見出し行で確かめる。変更箇所には下線が引かれ、改正前の側に「（同左）」、両側に「（省略）」「（新設）」「（削除）」の欄がある。表として取れるなら表で、取れないなら左右 2 列に分けて読む（1 列として読むと改正後と改正前の文が混ざる）',
  },
  attachment: {
    read_strategy: 'tables',
    layout_note:
      '別紙・別表・様式。表組みか記入欄の書式が多い。表として取れるなら表で、取れなければ本文として読む',
  },
  'qa-pdf': {
    read_strategy: 'text',
    layout_note: '問と答が交互に並ぶ散文。本文として通して読む',
  },
  related: {
    read_strategy: 'text',
    layout_note: '参考資料。本文として読む。調査に要るかどうかは文脈で決める',
  },
  notice: {
    read_strategy: 'text',
    layout_note: '通知・連絡。本文として読む。調査の結論には通常含めない',
  },
  unknown: {
    read_strategy: 'sample',
    layout_note:
      'タイトルから種別を判定できなかった。先頭ページを読んで中身を確かめてから、表として取るか本文として読むかを決める',
  },
};

/** `read_strategy` の日本語ラベル（Markdown の表用） */
const READ_STRATEGY_LABEL: Record<PdfReadStrategy, string> = {
  tables: '表として取る',
  text: '本文として読む',
  sample: '先頭を見て決める',
};

/** kind に対応する読み方を返す */
export function describePdfReading(kind: PdfKind): PdfReading {
  return KIND_READING[kind];
}

/**
 * 添付 PDF に `read_strategy` / `layout_note` を付ける。kind が無ければタイトルから補う。
 * 純関数。新しい配列を返す。
 */
export function withPdfReading<T extends AttachedPdfLike>(
  pdfs: ReadonlyArray<T>
): Array<T & { kind: PdfKind } & PdfReading> {
  return pdfs.map((pdf) => {
    const kind = pdf.kind ?? extractPdfKind(pdf.title);
    return { ...pdf, kind, ...KIND_READING[kind] };
  });
}

/** `buildPdfNextActions` に渡す「保存済みの絶対パス」。キーは `attachedPdfs[].url` */
export type SavedPathByUrl = ReadonlyMap<string, string>;

/**
 * 添付 PDF 群から `next_actions` を生成する（#36、v0.19.0）。
 *
 * 方針:
 *  - 含まれる kind ごとに 1 件（同 kind 内は先頭の PDF）。順序は KIND_PRIORITY（comparison が先頭）
 *  - pdf-reader-mcp を第一候補として、`action` は houki-egov-mcp と同じ `pdf-reader-mcp:<tool>` の書式
 *  - `example` は引数だけ（`mcp` / `tool` は入れない）
 *  - 保存済みパスがあれば `file_path` を使う経路（extract_tables / read_text / summarize）、
 *    無ければ `read_url` の経路（URL のまま読む。表として取る経路にはならない）
 *  - 最後に、pdf-reader-mcp が無い環境向けの汎用の 1 件（`read_pdf`）を置く。読み手は固定しない
 */
export function buildPdfNextActions(
  pdfs: ReadonlyArray<AttachedPdfLike>,
  savedPathByUrl: SavedPathByUrl = new Map()
): NextAction[] {
  if (pdfs.length === 0) return [];

  const seenByKind = new Map<PdfKind, AttachedPdfLike>();
  for (const pdf of pdfs) {
    const kind = pdf.kind ?? extractPdfKind(pdf.title);
    if (!seenByKind.has(kind)) seenByKind.set(kind, pdf);
  }
  const representatives = Array.from(seenByKind.entries()).sort(
    ([a], [b]) => KIND_PRIORITY[a] - KIND_PRIORITY[b]
  );

  const actions: NextAction[] = representatives.map(([kind, pdf]) =>
    pdfReaderAction(kind, pdf.url, savedPathByUrl.get(pdf.url))
  );

  const first = representatives[0][1];
  const firstPath = savedPathByUrl.get(first.url);
  actions.push({
    action: 'read_pdf',
    reason:
      'pdf-reader-mcp が無いときは、使っている PDF 読み取りツールに url（save: true で保存したときは path）を渡す。読み方は attachedPdfs[].read_strategy と layout_note のとおり',
    example: firstPath ? { url: first.url, path: firstPath } : { url: first.url },
  });
  return actions;
}

/** kind と保存状態から pdf-reader-mcp への 1 件を組み立てる */
function pdfReaderAction(kind: PdfKind, url: string, savedPath: string | undefined): NextAction {
  const label = PDF_KIND_LABEL[kind];
  const strategy = KIND_READING[kind].read_strategy;

  if (savedPath) {
    if (strategy === 'tables') {
      return {
        action: 'pdf-reader-mcp:extract_tables',
        reason: `${label}を表として取る。タグ付き PDF なら行と列がそのまま返る。表が 0 件（タグ無し）なら read_text に split_columns: 2 を付けて同じ file_path を読む`,
        example: { file_path: savedPath },
      };
    }
    if (strategy === 'text') {
      return {
        action: 'pdf-reader-mcp:read_text',
        reason: `${label}を本文として読む。長いときは pages で範囲を切る`,
        example: { file_path: savedPath },
      };
    }
    return {
      action: 'pdf-reader-mcp:summarize',
      reason: `${label}。ページ数・タグの有無・文字が取れるかを見てから、extract_tables か read_text を選ぶ`,
      example: { file_path: savedPath },
    };
  }

  if (strategy === 'tables') {
    const isComparison = kind === 'comparison';
    return {
      action: 'pdf-reader-mcp:read_url',
      reason: `${label}を URL のまま本文として読む。${
        isComparison ? '左右の列が混ざらないよう split_columns: 2 を付ける。' : ''
      }表として取るには、この tool を save: true で呼び直して saved[].path を extract_tables に渡す`,
      example: isComparison ? { url, split_columns: 2 } : { url },
    };
  }
  if (strategy === 'text') {
    return {
      action: 'pdf-reader-mcp:read_url',
      reason: `${label}を URL のまま本文として読む。長いときは pages で範囲を切る`,
      example: { url },
    };
  }
  return {
    action: 'pdf-reader-mcp:read_url',
    reason: `${label}。先頭ページだけ読んで中身を確かめてから、読み方を決める`,
    example: { url, pages: '1' },
  };
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
 *   - 読み手を固定しない案内（URL のまま読む / save: true で保存して表として取る）
 *   - 種別 / タイトル / サイズ / 読み方 / URL の表（kind 優先度でソート）
 *   - `### 読み方` kind ごとの layout_note
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
  lines.push(
    '> houki-nta-mcp は PDF の本文を読みません。URL のまま読むなら pdf-reader-mcp の `read_url`（新旧対照表は `split_columns: 2`）、表として取るなら `nta_inspect_pdf_meta` を `save: true` で呼び、`saved[].path` を `extract_tables` に渡してください。他の PDF 読み取りツールでも、url か path を渡せば同じように読めます。'
  );
  lines.push('');
  lines.push('| 種別 | タイトル | サイズ | 読み方 | URL |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const pdf of sorted) {
    const kind = pdf.kind ?? 'unknown';
    const emoji = PDF_KIND_EMOJI[kind];
    const label = PDF_KIND_LABEL[kind];
    const size = pdf.sizeKb ? `${pdf.sizeKb}KB` : '—';
    const strategy = READ_STRATEGY_LABEL[KIND_READING[kind].read_strategy];
    lines.push(
      `| ${emoji} ${label} | ${escapeMdTableCell(pdf.title)} | ${size} | ${strategy} | [link](${pdf.url}) |`
    );
  }

  // 読み方の補足 (v0.19.0 〜): kind ごとに 1 行。道具の名前は使わない
  const kindsInOrder = Array.from(new Set(sorted.map((p) => p.kind ?? 'unknown')));
  lines.push('');
  lines.push('### 読み方');
  lines.push('');
  for (const kind of kindsInOrder) {
    lines.push(`- ${PDF_KIND_LABEL[kind]}: ${KIND_READING[kind].layout_note}`);
  }

  return lines;
}

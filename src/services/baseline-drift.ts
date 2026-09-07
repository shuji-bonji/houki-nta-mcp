/**
 * Baseline Drift Detector — `menu.htm` を真の正典として CANARY_TARGETS のドリフトを検知する。
 *
 * Phase 5 Resilience Lv-3b。
 *
 * 目的:
 *  - canary が落ちる**前に**「baseline URL が menu に存在するか」を確認する
 *  - 世代付きディレクトリ (`sozoku2`, `hyoka_new`) の出現を「baseline 更新候補」として上申する
 *
 * 検知する drift の種類:
 *   1. **missing**: baseline URL が menu に登場していない (= 既に削除済み or soft-404 予備軍)
 *   2. **generation**: 同じ税目で baseline は旧名 (`sozoku`) なのに menu に新名 (`sozoku2`) が出現している
 *   3. **ok**: 上記のいずれにも該当しない
 */

import { CANARY_TARGETS } from './health-check.js';
import { extractKihonSegments, type MenuEntry, parseTsutatsuMenu } from './menu-parser.js';
import { type FetchNtaPageOptions, fetchNtaPage } from './nta-scraper.js';

const TSUTATSU_MENU_URL = 'https://www.nta.go.jp/law/tsutatsu/menu.htm';

/** 1 baseline の drift 判定結果 */
export interface BaselineDriftEntry {
  doc_type: string;
  label: string;
  baselineUrl: string;
  status: 'ok' | 'missing' | 'generation-drift';
  /**
   * `status === 'generation-drift'` のとき、menu 側で見つかった新世代のディレクトリ名一覧。
   * 例: baseline が `sozoku/` を見ているのに menu に `sozoku2/` がある → ['sozoku2']
   */
  newerGenerations?: string[];
  /** 推奨メッセージ (運用者向け、コミット message 等に貼れる短い文) */
  message: string;
}

export interface BaselineDriftResult {
  ranAt: string;
  durationMs: number;
  menuUrl: string;
  /** menu.htm から取れた entry 総数 (debug 用) */
  menuEntryCount: number;
  entries: BaselineDriftEntry[];
  /** ok 以外の件数 */
  driftCount: number;
}

export interface BaselineDriftOptions extends FetchNtaPageOptions {
  /** menu URL を上書き (テスト用) */
  menuUrl?: string;
  /** menu HTML を直接渡す (テスト用、fetch をスキップ) */
  menuHtml?: string;
  /** CANARY_TARGETS の差し替え (テスト用) */
  targets?: ReadonlyArray<{ doc_type: string; label: string; url: string }>;
}

/**
 * menu.htm を fetch (またはオプションの直接 HTML を使用) し、CANARY_TARGETS と突合する。
 */
export async function detectBaselineDrift(
  options: BaselineDriftOptions = {}
): Promise<BaselineDriftResult> {
  const menuUrl = options.menuUrl ?? TSUTATSU_MENU_URL;
  const ranAt = new Date().toISOString();
  const startMs = Date.now();

  let html: string;
  if (options.menuHtml !== undefined) {
    html = options.menuHtml;
  } else {
    const fetched = await fetchNtaPage(menuUrl, options);
    html = fetched.html;
  }

  const menuEntries = parseTsutatsuMenu(html, menuUrl);
  const targets = options.targets ?? CANARY_TARGETS;

  const entries: BaselineDriftEntry[] = targets.map((t) =>
    classifyDrift({
      doc_type: t.doc_type,
      label: t.label,
      baselineUrl: t.url,
      menuEntries,
    })
  );

  const driftCount = entries.filter((e) => e.status !== 'ok').length;

  return {
    ranAt,
    durationMs: Date.now() - startMs,
    menuUrl,
    menuEntryCount: menuEntries.length,
    entries,
    driftCount,
  };
}

/**
 * 1 baseline の drift 判定本体 (純粋関数、テスト容易性のため分離)。
 *
 * 判定の核は "taxKey" レベルの粒度合わせ。
 * baseline は節レベル (`shohi/01/04.htm`) だが menu は章レベル (`shohi/01.htm`) しか載せないため、
 * 同じ taxKey (= 純粋な数字ディレクトリ・ファイル名を除いた "意味のある名前付きディレクトリ" の連鎖) で比較する。
 *
 * taxKey の例:
 *   - `shohi/01/04.htm` → taxKey = 'shohi' (01 は章番号で除外、04.htm はファイル名で除外)
 *   - `sisan/sozoku2/01.htm` → taxKey = 'sisan/sozoku2' (sisan は親グループ、sozoku2 は税目)
 *   - `hojin/01/01_03.htm` → taxKey = 'hojin'
 *   - `sisan/sozoku/kaisei/kaisei_a.htm` → taxKey = 'sisan/sozoku/kaisei' (kaisei も意味のある名前)
 */
export function classifyDrift(args: {
  doc_type: string;
  label: string;
  baselineUrl: string;
  menuEntries: MenuEntry[];
}): BaselineDriftEntry {
  const { doc_type, label, baselineUrl, menuEntries } = args;
  const baselineSegments = extractKihonSegments(baselineUrl);

  // `kihon/` 配下でない baseline (= jimu-unei, bunshokaitou, tax-answer, qa-jirei) は drift 検知対象外。
  // menu.htm は通達系のインデックスなので、そもそも比較できない。
  if (baselineSegments.length === 0) {
    return {
      doc_type,
      label,
      baselineUrl,
      status: 'ok',
      message: 'kihon/ 配下でないため drift 検知対象外 (menu.htm 範囲外)',
    };
  }

  const baselineTaxKey = computeTaxKey(baselineSegments);
  if (!baselineTaxKey) {
    return {
      doc_type,
      label,
      baselineUrl,
      status: 'ok',
      message: 'taxKey を抽出できないため drift 検知対象外',
    };
  }

  // menu 側の entry を taxKey に揃えて Set 化。
  // kaisei パス (sisan/sozoku/kaisei/...) も含めて構築する: kaisei baseline 側の判定で必要。
  // baseline 本体側が「sisan/sozoku」だった場合に kaisei/ パスを sozoku entry と混同しないか?
  //   → computeTaxKey は kaisei セグメントを 'sisan/sozoku/kaisei' まで含むため、`sisan/sozoku` とは別の Key になる。
  //   → よって本体世代移行 (sisan/sozoku → sisan/sozoku2) の検知に影響しない。
  const menuTaxKeys = new Set<string>();
  for (const m of menuEntries) {
    if (!m.isKihon) continue;
    const tk = computeTaxKey(m.kihonSegments);
    if (tk) menuTaxKeys.add(tk);
  }

  const newerGenerations = findNewerGenerationSiblings({
    baselineTaxKey,
    menuTaxKeys,
  });

  // 1) baseline taxKey が menu MainBody の taxKey 集合に存在するか
  if (menuTaxKeys.has(baselineTaxKey)) {
    if (newerGenerations.length > 0) {
      return {
        doc_type,
        label,
        baselineUrl,
        status: 'generation-drift',
        newerGenerations,
        message: `baseline (${baselineTaxKey}) は menu に存在するが、新世代 ${newerGenerations.join(', ')} も menu に出現。baseline 更新を検討。`,
      };
    }
    return {
      doc_type,
      label,
      baselineUrl,
      status: 'ok',
      message: `menu に ${baselineTaxKey} が存在 (健全)`,
    };
  }

  // baseline taxKey が menu に無い → 世代移行で消えた or サイト構造変更
  return {
    doc_type,
    label,
    baselineUrl,
    status: 'missing',
    ...(newerGenerations.length > 0 ? { newerGenerations } : {}),
    message:
      newerGenerations.length > 0
        ? `baseline (${baselineTaxKey}) が menu から消滅し、新世代 ${newerGenerations.join(', ')} への移行が疑われる`
        : `baseline (${baselineTaxKey}) が menu から消滅 (soft-404 予備軍)`,
  };
}

/**
 * URL セグメントから "taxKey" を抽出する純粋関数。
 *
 * taxKey は「**ファイル名でも純粋数字ディレクトリ (章番号) でもない、名前付きディレクトリの連鎖**」。
 *
 *   ['shohi', '01.htm']                     → 'shohi'
 *   ['shohi', '01', '04.htm']               → 'shohi' (01 は数字のみ除外)
 *   ['sisan', 'sozoku2', '01.htm']          → 'sisan/sozoku2'
 *   ['hojin', '01', '01_03.htm']            → 'hojin'
 *   ['sisan', 'sozoku', 'kaisei', 'kaisei_a.htm'] → 'sisan/sozoku/kaisei'
 *   ['shohi', 'kaisei', 'kaisei_a.htm']     → 'shohi/kaisei'
 */
export function computeTaxKey(segments: string[]): string | null {
  if (segments.length === 0) return null;
  const named: string[] = [];
  for (const s of segments) {
    if (s.endsWith('.htm')) break; // ファイル名に到達したら終わり
    if (/^\d+$/.test(s)) continue; // 純粋数字ディレクトリ (章番号) は無視
    named.push(s);
  }
  return named.length > 0 ? named.join('/') : null;
}

/**
 * taxKey 単位で世代サフィックス付き兄弟が menu に出現しているかを検出する。
 *
 * baseline taxKey = `sisan/sozoku` (旧) の場合、menu に `sisan/sozoku2` があれば兄弟。
 * baseline taxKey = `shohi` の場合、menu に `shohi2` や `shohi_new` があれば兄弟。
 *
 * 世代サフィックスのパターン:
 *  - `{base}\d+` (例: `sozoku` → `sozoku2`)
 *  - `{base}_new` (例: `hyoka` → `hyoka_new`)
 *  - `{base}_[a-z]+` (より広く取りたい場合)
 */
export function findNewerGenerationSiblings(args: {
  baselineTaxKey: string;
  menuTaxKeys: Set<string>;
}): string[] {
  const { baselineTaxKey, menuTaxKeys } = args;
  const parts = baselineTaxKey.split('/');
  const lastName = parts[parts.length - 1];
  if (!lastName) return [];
  // 末尾の世代サフィックスを除いた "base"
  const baseName = lastName.replace(/(?:\d+|_new|_[a-z]+)$/i, '');
  if (!baseName) return [];

  const parentPrefix = parts.slice(0, -1).join('/');
  const siblings = new Set<string>();

  for (const tk of menuTaxKeys) {
    const tkParts = tk.split('/');
    const tkLast = tkParts[tkParts.length - 1];
    if (!tkLast) continue;
    const tkParent = tkParts.slice(0, -1).join('/');
    if (tkParent !== parentPrefix) continue;
    if (tkLast === lastName) continue;
    if (!tkLast.startsWith(baseName)) continue;
    const suffix = tkLast.slice(baseName.length);
    if (suffix.length === 0) continue;
    if (!/^(?:\d+|_new|_[a-z]+)$/i.test(suffix)) continue;
    siblings.add(tkLast);
  }

  return Array.from(siblings).sort();
}

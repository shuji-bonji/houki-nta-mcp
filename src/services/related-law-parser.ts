/**
 * Related-law parser — 質疑応答事例の【関係法令通達】欄を、法令と通達の参照に分ける（Issue #22）
 *
 * 入力は `parseQaJirei()` が返す `relatedLaws`（段落ごとの文字列）。例:
 *
 *   "所得税法第27条、第34条、第37条、所得税基本通達34-1(4)"
 *   "租税特別措置法第70条の6第1項、第9項"
 *   "消費税法別表第二第7号ハ、消費税法施行令第14条の3第1号"
 *
 * 「、」で区切った各要素を、直前の要素の続き（「第34条」は直前の法令の条、「第9項」は直前の条の項、
 * 「3-3」は直前の通達の番号）として読む。法令名・通達名を推測で補うことはしない。
 * 読み取れない要素（告示・付随の説明文・「［参考］」など）は結果に入れず、呼び出し側は `relatedLaws`
 * の元の文字列で確かめる。
 *
 * 2026-09-11 に houki-nta-mcp のローカル DB の質疑応答事例 1,834 件（【関係法令通達】欄あり）で
 * 書き方を数えて決めた規則。件数と分解できた割合は README と CHANGELOG（v0.12.0）に記載。
 */

import { normalizeJpText } from './text-normalize.js';

/** 法令（法律・政令・省令・条約など）への参照 */
export interface RelatedLawRef {
  /** 法令名（ページの表記のまま）。例: "所得税法施行令" */
  law_name: string;
  /** 条。houki-egov-mcp の get_law の `article` と同じ形。例: "57の2" */
  article?: string;
  /** 項 */
  paragraph?: number;
  /**
   * 号。houki-egov-mcp の get_law の `item` と同じ形。
   * 枝番号の号（「第12号の8」）は文字列 "12の8"（v0.14.0 から。get_law は houki-egov-mcp v0.6.0 以上で受け付ける）。
   * v0.13.0 までは枝番号の号を入れていなかった
   */
  item?: number | string;
  /** 別表への参照。例: "別表第二第7号ハ" */
  appendix?: string;
  /** この参照を読み取った元の要素（「、」で区切ったもの）。続きの要素では法令名が省かれている */
  raw: string;
}

/** 通達への参照 */
export interface RelatedTsutatsuRef {
  /** 通達名（ページの表記のまま）。例: "所得税基本通達" / "租税特別措置法関係通達（法人税編）" */
  name: string;
  /** 通達の番号（ページの表記を半角にしたもの）。例: "34-1(4)" / "65の7(1)-22" / "211" */
  clause?: string;
  raw: string;
}

export interface RelatedReferences {
  related_laws: RelatedLawRef[];
  related_tsutatsu: RelatedTsutatsuRef[];
  /** 法令・通達として読み取れなかった要素（統計・テスト用。応答には載せない） */
  unparsed: string[];
}

/** 条の後ろに続く「第N項」「第N号(のM)」を読む */
function parseAfterArticle(rest: string): { paragraph?: number; item?: number | string } {
  const out: { paragraph?: number; item?: number | string } = {};
  let s = rest;
  const p = s.match(/^第(\d+)項/);
  if (p) {
    out.paragraph = Number(p[1]);
    s = s.slice(p[0].length);
  }
  const item = itemOf(s);
  if (item !== undefined) out.item = item;
  return out;
}

/**
 * 先頭の「第N号」「第N号のM」を get_law の item の形にする。
 * 枝番号が無ければ数値（12）、あれば文字列（"12の8"）。号で始まらなければ undefined
 */
function itemOf(s: string): number | string | undefined {
  const it = s.match(/^第(\d+)号((?:の\d+)*)/);
  if (!it) return undefined;
  return it[2] ? `${it[1]}${it[2]}` : Number(it[1]);
}

/** "第57条の2" → "57の2" */
function articleOf(m: string): string {
  return m.replace(/^第/, '').replace(/条/, '');
}

const LAW_NAME_TAIL = /(法|令|規則|法律|条約)$/;
const TSUTATSU_HEAD = /^(.+?通達(?:（[^）]*）)?)(.*)$/;
const LAW_WITH_ARTICLE = /^(.+?)(第\d+条(?:の\d+)*)(.*)$/;
const LAW_WITH_APPENDIX = /^(.+?)(別表.*)$/;
const GLUED_LAW_TSUTATSU =
  /^([^第「」。（）]+?)(第\d+条(?:の\d+)*)((?:第\d+項)?(?:第\d+号(?:の\d+)?)?)([^第\d「」。]+?通達(?:（[^）]*）)?)(.*)$/;

type Context =
  | { kind: 'law'; law_name: string; article?: string; paragraph?: number }
  | { kind: 'tsutatsu'; name: string }
  | undefined;

/**
 * 【関係法令通達】欄の段落から、法令と通達の参照を取り出す。
 */
export function parseRelatedReferences(paragraphs: string[]): RelatedReferences {
  const result: RelatedReferences = { related_laws: [], related_tsutatsu: [], unparsed: [] };

  for (const para of paragraphs) {
    let ctx: Context;
    const tokens = normalizeJpText(para)
      .split(/[、，,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);

    for (const raw of tokens) {
      // 箇条書きの番号（「1 相続税法第…」）は法令名に含めない
      const t = raw
        .replace(/\s+/g, '')
        .replace(
          /^[(（]?\d+[)）.．](?=[^\d第])|^\d+(?=[^\d第条項号の\-~(（]+(?:法|令|規則|法律|条約|通達))/,
          ''
        );

      // 0. 区切りの抜け（「消費税法施行令第45条第3項消費税法基本通達」）: 法令の条と通達に分けて読む
      const glued = t.match(GLUED_LAW_TSUTATSU);
      if (glued && LAW_NAME_TAIL.test(glued[1])) {
        const after = parseAfterArticle(glued[3]);
        const article = articleOf(glued[2]);
        result.related_laws.push({ law_name: glued[1], article, ...after, raw });
        const clause = glued[5] || undefined;
        result.related_tsutatsu.push({ name: glued[4], ...(clause ? { clause } : {}), raw });
        ctx = { kind: 'tsutatsu', name: glued[4] };
        continue;
      }

      // 1. 通達（名前が通達で終わる。「租税特別措置法関係通達（法人税編）」のような括弧書きも含む）
      const ts = t.match(TSUTATSU_HEAD);
      if (ts && !/[「」。]/.test(ts[1])) {
        const clause = ts[2] || undefined;
        result.related_tsutatsu.push({ name: ts[1], ...(clause ? { clause } : {}), raw });
        ctx = { kind: 'tsutatsu', name: ts[1] };
        continue;
      }

      // 2. 法令名 + 条
      const la = t.match(LAW_WITH_ARTICLE);
      if (
        la &&
        !la[1].startsWith('第') &&
        LAW_NAME_TAIL.test(la[1]) &&
        !/[「」。（）]/.test(la[1])
      ) {
        const article = articleOf(la[2]);
        const after = parseAfterArticle(la[3]);
        result.related_laws.push({ law_name: la[1], article, ...after, raw });
        ctx = { kind: 'law', law_name: la[1], article, paragraph: after.paragraph };
        continue;
      }

      // 3. 法令名 + 別表
      const ap = t.match(LAW_WITH_APPENDIX);
      if (ap && LAW_NAME_TAIL.test(ap[1]) && !/[「」。（）]/.test(ap[1])) {
        result.related_laws.push({ law_name: ap[1], appendix: ap[2], raw });
        ctx = { kind: 'law', law_name: ap[1] };
        continue;
      }

      // 4. 直前の要素の続き
      if (ctx?.kind === 'law') {
        const art = t.match(/^(第\d+条(?:の\d+)*)(.*)$/);
        if (art) {
          const article = articleOf(art[1]);
          const after = parseAfterArticle(art[2]);
          result.related_laws.push({ law_name: ctx.law_name, article, ...after, raw });
          ctx = { kind: 'law', law_name: ctx.law_name, article, paragraph: after.paragraph };
          continue;
        }
        if (ctx.article && /^第\d+項/.test(t)) {
          const after = parseAfterArticle(t);
          result.related_laws.push({ law_name: ctx.law_name, article: ctx.article, ...after, raw });
          ctx = { ...ctx, paragraph: after.paragraph };
          continue;
        }
        if (ctx.article && /^第\d+号/.test(t)) {
          const item = itemOf(t);
          result.related_laws.push({
            law_name: ctx.law_name,
            article: ctx.article,
            ...(ctx.paragraph !== undefined ? { paragraph: ctx.paragraph } : {}),
            ...(item !== undefined ? { item } : {}),
            raw,
          });
          continue;
        }
        if (/^別表/.test(t)) {
          result.related_laws.push({ law_name: ctx.law_name, appendix: t, raw });
          continue;
        }
      }
      if (ctx?.kind === 'tsutatsu' && /^([0-9]|別表)/.test(t)) {
        result.related_tsutatsu.push({ name: ctx.name, clause: t, raw });
        continue;
      }

      result.unparsed.push(raw);
      ctx = undefined;
    }
  }
  return result;
}

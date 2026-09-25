/**
 * Tsutatsu Live — `nta_get_tsutatsu` が DB に無い基本通達 4 種の条項を国税庁サイトから取る（Issue #54）
 *
 * 流れ:
 *   1. `clause` を通達ごとの番号の形で読む（`parseLiveClause`）
 *   2. 候補ページを決める
 *      - 消費税法基本通達: 番号の章・節から `{章}/{節}.htm` を組み立てる。無ければ目次で選び直す
 *      - 法人税・所得税・相続税法基本通達: 目次の項目の題から選ぶ（`selectCandidatePages`）
 *   3. 候補ページを順に取得し、条項が見つかったところで止める。取得して解析できたページは
 *      見つかったかどうかにかかわらず DB に書き戻す
 *   4. 目次は DB（`tsutatsu_toc`）に保存して使い回し、条項が見つからないときにだけ
 *      1 回の呼び出しにつき 1 回、条件付き取得（If-Modified-Since / If-None-Match）で取り直す
 *
 * 1 回の呼び出しで取る候補ページは `TSUTATSU_LIVE_FETCH.maxPages` まで、ページとページの
 * あいだは `TSUTATSU_LIVE_FETCH.pageIntervalMs` あける。
 *
 * 設計: houki-hub `docs/notes/2026-09-25-design-nta-54-tsutatsu-live-toc.md` の 4 章・6 章
 */

import type DatabaseT from 'better-sqlite3';

import { TSUTATSU_LIVE_FETCH, type TsutatsuTocStyle } from '../constants.js';
import type { TsutatsuClause, TsutatsuSection } from '../types/tsutatsu.js';
import type { TsutatsuToc } from '../types/tsutatsu-toc.js';
import { buildSectionUrl } from '../utils/clause.js';
import { logger, toMeta } from '../utils/logger.js';
import { writeBackLiveSection } from './bulk-downloader.js';
import { type FetchNtaPageOptions, fetchNtaPage, NtaFetchError } from './nta-scraper.js';
import { normalizeClauseNumber, normalizeJpText } from './text-normalize.js';
import { parseTsutatsuSection, TsutatsuParseError } from './tsutatsu-parser.js';
import { parseTsutatsuToc } from './tsutatsu-toc-parser.js';
import { parseTsutatsuTocHojin } from './tsutatsu-toc-parser-hojin.js';
import { parseTsutatsuTocShotoku } from './tsutatsu-toc-parser-shotoku.js';
import { parseTsutatsuTocSozoku } from './tsutatsu-toc-parser-sozoku.js';

/* -------------------------------------------------------------------------- */
/* 番号の形                                                                   */
/* -------------------------------------------------------------------------- */

/** 通達ごとの `clause` の番号の形と例。INVALID_ARGUMENT / ARTICLE_NOT_FOUND の hint に使う */
export const CLAUSE_FORMS: Readonly<
  Record<TsutatsuTocStyle, { form: string; examples: readonly string[] }>
> = {
  shohi: { form: '章-節-条', examples: ['5-1-9', '1-4-13の2'] },
  hojin: { form: '章-節-条（章・節に枝番号が付くことがある）', examples: ['1-1-1', '1-3の2-1'] },
  shotoku: {
    form: '条-項（複数の条に共通する通達は 条~条共-項）',
    examples: ['34-1', '2-4の2', '23~35共-6'],
  },
  sozoku: {
    form: '条-項（複数の条に共通する通達は 条・条共-項）',
    examples: ['3-1', '1の3・1の4共-1'],
  },
};

/** hint 用に「番号の形は 章-節-条（例: 5-1-9 / 1-4-13の2）」を組み立てる */
export function describeClauseForm(style: TsutatsuTocStyle): string {
  const { form, examples } = CLAUSE_FORMS[style];
  return `番号の形は ${form}（例: ${examples.join(' / ')}）`;
}

/** 条の番号。`34` は `{ base: 34, branch: 0 }`、`1の3` は `{ base: 1, branch: 3 }` */
export interface ArticleRef {
  base: number;
  branch: number;
}

/** 条の指定。単独・列挙（`1の3・1の4共`）は list、範囲（`23~35共`）は range */
export type ArticleSpec =
  | { kind: 'list'; refs: ArticleRef[] }
  | { kind: 'range'; from: ArticleRef; to: ArticleRef };

/** `clause` を通達ごとの番号の形で読んだ結果 */
export type LiveClauseKey =
  | { style: 'shohi'; chapter: number; section: number }
  | { style: 'hojin'; chapterLabel: string; sectionLabel: string }
  | { style: 'shotoku' | 'sozoku'; articles: ArticleSpec };

const ART = String.raw`\d+(?:の\d+)?`;
const RE_THREE_PART_NUMERIC = /^(\d+)-(\d+)-(\d+(?:の\d+)?)$/;
const RE_THREE_PART_BRANCHED = new RegExp(`^(${ART})-(${ART})-(${ART})$`);
const RE_ARTICLE_SINGLE = new RegExp(`^(${ART})-(${ART})$`);
const RE_ARTICLE_RANGE = new RegExp(`^(${ART})~(${ART})共-(${ART})$`);
const RE_ARTICLE_LIST = new RegExp(`^(${ART}(?:・${ART})+)共-(${ART})$`);

/**
 * `clause`（`normalizeClauseNumber` 済み）を通達ごとの番号の形で読む。どの形にも当たらなければ null
 *
 * - 消費税法基本通達: 章-節-条（`5-1-9` / `1-4-13の2`）
 * - 法人税基本通達: 章-節-条。章・節に枝番号が付くことがある（`1-3の2-1` / `12の2-1-1`）
 * - 所得税基本通達: 条-項（`34-1` / `2-4の2`）、共通の通達は `23~35共-6`（`36・37共-1` も読む）
 * - 相続税法基本通達: 条-項（`3-1`）、共通の通達は `1の3・1の4共-1`（`~` の範囲も読む）
 */
export function parseLiveClause(style: TsutatsuTocStyle, clause: string): LiveClauseKey | null {
  if (style === 'shohi') {
    const m = clause.match(RE_THREE_PART_NUMERIC);
    if (!m) return null;
    const chapter = parseInt(m[1], 10);
    const section = parseInt(m[2], 10);
    if (chapter < 1 || section < 1) return null;
    return { style, chapter, section };
  }
  if (style === 'hojin') {
    const m = clause.match(RE_THREE_PART_BRANCHED);
    if (!m) return null;
    return { style, chapterLabel: canonicalLabel(m[1]), sectionLabel: canonicalLabel(m[2]) };
  }
  const single = clause.match(RE_ARTICLE_SINGLE);
  if (single) return { style, articles: { kind: 'list', refs: [parseArticleRef(single[1])] } };
  const range = clause.match(RE_ARTICLE_RANGE);
  if (range) {
    return {
      style,
      articles: { kind: 'range', from: parseArticleRef(range[1]), to: parseArticleRef(range[2]) },
    };
  }
  const list = clause.match(RE_ARTICLE_LIST);
  if (list) {
    return { style, articles: { kind: 'list', refs: list[1].split('・').map(parseArticleRef) } };
  }
  return null;
}

function parseArticleRef(s: string): ArticleRef {
  const [base, branch] = s.split('の');
  return { base: parseInt(base, 10), branch: branch ? parseInt(branch, 10) : 0 };
}

/** `"03"` → `"3"`、`"3の02"` → `"3の2"`（先頭の 0 を落とす） */
function canonicalLabel(s: string): string {
  return s
    .split('の')
    .map((n) => String(parseInt(n, 10)))
    .join('の');
}

/* -------------------------------------------------------------------------- */
/* 目次から候補ページを選ぶ                                                   */
/* -------------------------------------------------------------------------- */

/** 取得する候補ページ。章・節の番号は bulk download と同じく目次の解析結果の番号を使う */
export interface CandidatePage {
  url: string;
  chapterNumber: number;
  sectionNumber: number;
  chapterTitle?: string;
  sectionTitle?: string;
}

/** 目次の解析器を通達のスタイルで切り替える（bulk download と同じ解析器） */
export function parseTocByStyle(
  style: TsutatsuTocStyle,
  html: string,
  sourceUrl: string,
  fetchedAt: string
): TsutatsuToc {
  switch (style) {
    case 'shotoku':
      return parseTsutatsuTocShotoku(html, sourceUrl, fetchedAt);
    case 'hojin':
      return parseTsutatsuTocHojin(html, sourceUrl, fetchedAt);
    case 'sozoku':
      return parseTsutatsuTocSozoku(html, sourceUrl, fetchedAt);
    default:
      return parseTsutatsuToc(html, sourceUrl, fetchedAt);
  }
}

/** 消費税法基本通達: 番号の章・節から組み立てた `{章}/{節}.htm` */
export function directShohiCandidate(
  rootUrl: string,
  key: Extract<LiveClauseKey, { style: 'shohi' }>
): CandidatePage {
  return {
    url: buildSectionUrl(rootUrl, key.chapter, key.section),
    chapterNumber: key.chapter,
    sectionNumber: key.section,
  };
}

/**
 * 目次から、番号の条項が載っていそうなページを目次の順に選ぶ。同じ URL は 1 回だけ
 *
 * - 消費税法基本通達: 番号の章・節の節ページ。節が款に分かれていれば款のページを全部
 * - 法人税基本通達: 番号の章（`第12章の2`）の中で、題（款なら属する節の題）が番号の節
 *   （`第3節の2`）に当たる項目。章の項目に節の題が 1 つも無ければ（`第13章` の「詳細はこちら」）章の全ページ
 * - 所得税・相続税法基本通達: `articleTitles` の題（「法第N条…関係」「法第N条から第M条まで…共通関係」
 *   「第N条《…》及び第M条《…》共通関係」）が番号の条と同じ項目。同じ項目が無ければ、条が重なる項目
 */
export function selectCandidatePages(toc: TsutatsuToc, key: LiveClauseKey): CandidatePage[] {
  const pages: CandidatePage[] = [];
  const seen = new Set<string>();
  const push = (
    url: string | undefined,
    chapter: TsutatsuToc['chapters'][number],
    sectionNumber: number,
    sectionTitle: string
  ) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    pages.push({
      url,
      chapterNumber: chapter.number,
      sectionNumber,
      chapterTitle: chapter.title,
      sectionTitle,
    });
  };

  if (key.style === 'shohi') {
    for (const ch of toc.chapters) {
      if (ch.number !== key.chapter) continue;
      for (const sec of ch.sections) {
        if (sec.number !== key.section) continue;
        push(sec.url, ch, sec.number, sec.title);
        for (const sub of sec.subsections ?? []) {
          push(sub.url, ch, sec.number, `${sec.title} ${sub.title}`);
        }
      }
    }
    return pages;
  }

  if (key.style === 'hojin') {
    for (const ch of toc.chapters) {
      if (headingLabel(ch.title, '章') !== key.chapterLabel) continue;
      const labeled = ch.sections.map((sec) => ({
        sec,
        label: headingLabel(sec.parentTitle ?? sec.title, '節'),
      }));
      const anyLabel = labeled.some((x) => x.label !== undefined);
      for (const { sec, label } of labeled) {
        if (anyLabel && label !== key.sectionLabel) continue;
        const title = sec.parentTitle ? `${sec.parentTitle} ${sec.title}` : sec.title;
        push(sec.url, ch, sec.number, title);
      }
    }
    return pages;
  }

  const exact: Array<() => void> = [];
  const overlapping: Array<() => void> = [];
  for (const ch of toc.chapters) {
    for (const sec of ch.sections) {
      const specs = (sec.articleTitles ?? [])
        .map(articlesInTitle)
        .filter((s): s is ArticleSpec => s !== null);
      const add = () => push(sec.url, ch, sec.number, sec.title);
      if (specs.some((s) => sameArticles(s, key.articles))) exact.push(add);
      else if (specs.some((s) => overlapArticles(s, key.articles))) overlapping.push(add);
    }
  }
  for (const add of exact.length > 0 ? exact : overlapping) add();
  return pages;
}

/**
 * 「第12章の2 …」→ `"12の2"`、「第3節の2 …」→ `"3の2"`。当たらなければ undefined。
 * 法人税基本通達の目次の解析器は「第12章の2」を「第12章 の2 …」の形で章の題に残すので、
 * 「章」「節」と「の」のあいだの空白も読む
 */
function headingLabel(title: string, unit: '章' | '節'): string | undefined {
  const m = normalizeJpText(title)
    .trim()
    .match(new RegExp(`^第(\\d+)${unit}\\s*(?:の(\\d+))?`));
  if (!m) return undefined;
  return m[2] ? `${parseInt(m[1], 10)}の${parseInt(m[2], 10)}` : String(parseInt(m[1], 10));
}

/**
 * 目次の題から条を読む。《…》や括弧の中の番号は条の指定ではないので除く
 *
 * - 「法第183条から第193条まで（…）共通関係」→ range 183〜193
 * - 「第1条の3《…》及び第1条の4《…》共通関係」→ list 1の3・1の4
 * - 「法第31条《…》関係」→ list 31
 */
export function articlesInTitle(title: string): ArticleSpec | null {
  const t = normalizeJpText(title)
    .replace(/《[^》]*》/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '');
  const range = t.match(/第(\d+)条(?:の(\d+))?から第(\d+)条(?:の(\d+))?まで/);
  if (range) {
    return {
      kind: 'range',
      from: { base: parseInt(range[1], 10), branch: range[2] ? parseInt(range[2], 10) : 0 },
      to: { base: parseInt(range[3], 10), branch: range[4] ? parseInt(range[4], 10) : 0 },
    };
  }
  const refs: ArticleRef[] = [];
  for (const m of t.matchAll(/第(\d+)条(?:の(\d+))?/g)) {
    const ref = { base: parseInt(m[1], 10), branch: m[2] ? parseInt(m[2], 10) : 0 };
    if (!refs.some((r) => sameRef(r, ref))) refs.push(ref);
  }
  return refs.length > 0 ? { kind: 'list', refs } : null;
}

function sameRef(a: ArticleRef, b: ArticleRef): boolean {
  return a.base === b.base && a.branch === b.branch;
}

/** 範囲の下端・上端の比較用の値。上端の枝番号なし（`第35条まで`）は `35の…` も含める */
function refValue(r: ArticleRef, upper = false): number {
  return r.base * 1000 + (upper && r.branch === 0 ? 999 : r.branch);
}

function sameArticles(a: ArticleSpec, b: ArticleSpec): boolean {
  if (a.kind === 'range' && b.kind === 'range') {
    return sameRef(a.from, b.from) && sameRef(a.to, b.to);
  }
  if (a.kind === 'list' && b.kind === 'list') {
    return (
      a.refs.length === b.refs.length && a.refs.every((r) => b.refs.some((x) => sameRef(r, x)))
    );
  }
  return false;
}

function inRange(r: ArticleRef, spec: Extract<ArticleSpec, { kind: 'range' }>): boolean {
  const v = refValue(r);
  return refValue(spec.from) <= v && v <= refValue(spec.to, true);
}

function overlapArticles(a: ArticleSpec, b: ArticleSpec): boolean {
  if (a.kind === 'list' && b.kind === 'list') {
    return a.refs.some((r) => b.refs.some((x) => sameRef(r, x)));
  }
  if (a.kind === 'list' && b.kind === 'range') return a.refs.some((r) => inRange(r, b));
  if (a.kind === 'range' && b.kind === 'list') return b.refs.some((r) => inRange(r, a));
  if (a.kind === 'range' && b.kind === 'range') {
    return refValue(a.from) <= refValue(b.to, true) && refValue(b.from) <= refValue(a.to, true);
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* 目次の保存（tsutatsu_toc）                                                  */
/* -------------------------------------------------------------------------- */

/** DB に保存した目次 */
export interface StoredToc {
  toc: TsutatsuToc;
  fetchedAt: string;
  lastModified?: string;
  etag?: string;
}

/** 目次の URL で保存した目次を読む。無いか、壊れていれば null */
export function readStoredToc(db: DatabaseT.Database, url: string): StoredToc | null {
  try {
    const row = db
      .prepare(`SELECT toc_json, fetched_at, last_modified, etag FROM tsutatsu_toc WHERE url = ?`)
      .get(url) as
      | { toc_json: string; fetched_at: string; last_modified: string | null; etag: string | null }
      | undefined;
    if (!row) return null;
    const stored: StoredToc = {
      toc: JSON.parse(row.toc_json) as TsutatsuToc,
      fetchedAt: row.fetched_at,
    };
    if (row.last_modified) stored.lastModified = row.last_modified;
    if (row.etag) stored.etag = row.etag;
    return stored;
  } catch (err) {
    logger.warn('tsutatsu-live', '保存した目次を読めない（取り直す）', { url, error: toMeta(err) });
    return null;
  }
}

/** 目次を保存する（best effort。失敗しても応答は変えない） */
export function saveStoredToc(
  db: DatabaseT.Database,
  formalName: string,
  url: string,
  stored: StoredToc
): void {
  try {
    db.prepare(
      `INSERT OR REPLACE INTO tsutatsu_toc(url, formal_name, toc_json, fetched_at, last_modified, etag)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      url,
      formalName,
      JSON.stringify(stored.toc),
      stored.fetchedAt,
      stored.lastModified ?? null,
      stored.etag ?? null
    );
  } catch (err) {
    logger.warn('tsutatsu-live', '目次の保存に失敗（無視）', { url, error: toMeta(err) });
  }
}

/* -------------------------------------------------------------------------- */
/* 国税庁サイトから条項を取る                                                 */
/* -------------------------------------------------------------------------- */

/** `fetchTsutatsuClauseLive` のオプション。上限・間隔・再試行はテストで短くできる */
export interface LiveFetchOptions {
  fetchImpl?: typeof fetch;
  /** 1 回の呼び出しで取る候補ページの上限。既定は `TSUTATSU_LIVE_FETCH.maxPages` */
  maxPages?: number;
  /** 候補ページとページのあいだの待ち (ms)。既定は `TSUTATSU_LIVE_FETCH.pageIntervalMs` */
  pageIntervalMs?: number;
  /** 取得の再試行回数（`fetchNtaPage` の `maxRetries`） */
  maxRetries?: number;
  /** 再試行の待ちの基準値 (ms)（`fetchNtaPage` の `retryBaseMs`） */
  retryBaseMs?: number;
}

/** 国税庁サイトから条項を取った結果 */
export type LiveFetchResult =
  | { kind: 'found'; clause: TsutatsuClause; section: TsutatsuSection }
  | {
      kind: 'not_found';
      /** 取得して解析できたページにある条項番号（取得の順、重複なし） */
      availableClauses: string[];
      /** 取得した（取得を試みた）候補ページの URL */
      searchedUrls: string[];
      /** 取得した候補ページがどれも存在しなかった（404 / 404 ページへの転送） */
      allMissing: boolean;
      /** 上限に達して取らなかった候補ページの数（上限に達していなければ 0） */
      skippedByLimit: number;
    }
  /** 番号の形には当たるが、目次（取り直した後も）から候補ページを 1 つも決められない */
  | { kind: 'no_candidates' }
  | { kind: 'fetch_error'; error: NtaFetchError; url: string }
  | { kind: 'parse_error'; error: TsutatsuParseError; url: string };

/** 目次の状態。source は、この呼び出しで取得したか、DB に保存してあったものか */
interface TocState {
  stored: StoredToc;
  source: 'db' | 'fetched';
}

/**
 * DB に無い条項を国税庁サイトから取る。取得して解析できたページは DB に書き戻す。
 *
 * @param db 目次の保存と書き戻しに使う DB
 * @param target 通達と、`normalizeClauseNumber` 済みの `clause`、それを読んだ `key`
 */
export async function fetchTsutatsuClauseLive(
  db: DatabaseT.Database,
  target: {
    formalName: string;
    abbr: string;
    rootUrl: string;
    style: TsutatsuTocStyle;
    clause: string;
    key: LiveClauseKey;
  },
  options: LiveFetchOptions = {}
): Promise<LiveFetchResult> {
  const maxPages = options.maxPages ?? TSUTATSU_LIVE_FETCH.maxPages;
  const pageIntervalMs = options.pageIntervalMs ?? TSUTATSU_LIVE_FETCH.pageIntervalMs;
  const fetchOptions: FetchNtaPageOptions = {};
  if (options.fetchImpl) fetchOptions.fetchImpl = options.fetchImpl;
  if (options.maxRetries !== undefined) fetchOptions.maxRetries = options.maxRetries;
  if (options.retryBaseMs !== undefined) fetchOptions.retryBaseMs = options.retryBaseMs;

  const tocUrl = `${target.rootUrl}01.htm`;
  const tried = new Set<string>();
  const searchedUrls: string[] = [];
  const availableClauses: string[] = [];
  let pagesFetched = 0;
  let pagesParsed = 0;
  let skippedByLimit = 0;

  /** 候補ページを順に取る。見つかった・取得や解析に失敗したら結果を、それ以外は undefined を返す */
  const tryPages = async (candidates: CandidatePage[]): Promise<LiveFetchResult | undefined> => {
    const fresh = candidates.filter((c) => !tried.has(c.url));
    for (let i = 0; i < fresh.length; i++) {
      const page = fresh[i];
      if (pagesFetched >= maxPages) {
        skippedByLimit += fresh.length - i;
        return undefined;
      }
      if (pagesFetched > 0) await sleep(pageIntervalMs);
      tried.add(page.url);
      searchedUrls.push(page.url);
      pagesFetched++;

      let fetched: Awaited<ReturnType<typeof fetchNtaPage>>;
      try {
        fetched = await fetchNtaPage(page.url, fetchOptions);
      } catch (err) {
        // 存在しないページ（404、404 ページへの転送）は次の候補へ。それ以外は再試行できるエラー
        if (err instanceof NtaFetchError && isMissingPage(err)) continue;
        if (err instanceof NtaFetchError) return { kind: 'fetch_error', error: err, url: page.url };
        throw err;
      }

      let section: TsutatsuSection;
      try {
        section = parseTsutatsuSection(fetched.html, fetched.sourceUrl, fetched.fetchedAt);
      } catch (err) {
        if (err instanceof TsutatsuParseError) {
          return { kind: 'parse_error', error: err, url: page.url };
        }
        throw err;
      }
      pagesParsed++;

      // 見つかったかどうかにかかわらず書き戻す（次の呼び出しで取り直さない）
      writeBackLiveSection(db, {
        formalName: target.formalName,
        abbr: target.abbr,
        rootUrl: target.rootUrl,
        chapterNumber: page.chapterNumber,
        sectionNumber: page.sectionNumber,
        sectionUrl: section.sourceUrl,
        fetchedAt: section.fetchedAt,
        sectionTitle: page.sectionTitle ?? section.sectionTitle,
        chapterTitle: page.chapterTitle ?? section.chapterTitle,
        clauses: section.clauses,
      });

      for (const c of section.clauses) {
        if (!availableClauses.includes(c.clauseNumber)) availableClauses.push(c.clauseNumber);
      }
      const clause = section.clauses.find(
        (c) => normalizeClauseNumber(c.clauseNumber) === target.clause
      );
      if (clause) return { kind: 'found', clause, section };
    }
    return undefined;
  };

  /** 目次を取得して解析し、保存する。conditional に前回の値を渡し、304 が返れば notModified を返す */
  const fetchToc = async (
    conditional?: StoredToc
  ): Promise<{ state: TocState } | { notModified: true } | LiveFetchResult> => {
    const opts: FetchNtaPageOptions = { ...fetchOptions };
    if (conditional?.lastModified) opts.ifModifiedSince = conditional.lastModified;
    if (conditional?.etag) opts.ifNoneMatch = conditional.etag;
    let fetched: Awaited<ReturnType<typeof fetchNtaPage>>;
    try {
      fetched = await fetchNtaPage(tocUrl, opts);
    } catch (err) {
      if (err instanceof NtaFetchError) return { kind: 'fetch_error', error: err, url: tocUrl };
      throw err;
    }
    if (fetched.notModified) {
      if (conditional) {
        saveStoredToc(db, target.formalName, tocUrl, {
          ...conditional,
          fetchedAt: fetched.fetchedAt,
        });
      }
      return { notModified: true };
    }
    let toc: TsutatsuToc;
    try {
      toc = parseTocByStyle(target.style, fetched.html, fetched.sourceUrl, fetched.fetchedAt);
    } catch (err) {
      if (err instanceof TsutatsuParseError)
        return { kind: 'parse_error', error: err, url: tocUrl };
      throw err;
    }
    const stored: StoredToc = { toc, fetchedAt: fetched.fetchedAt };
    if (fetched.lastModified) stored.lastModified = fetched.lastModified;
    if (fetched.etag) stored.etag = fetched.etag;
    saveStoredToc(db, target.formalName, tocUrl, stored);
    return { state: { stored, source: 'fetched' } };
  };

  // 1. 消費税法基本通達は、番号から組み立てたページを先に取る（目次を使わない）
  if (target.key.style === 'shohi') {
    const r = await tryPages([directShohiCandidate(target.rootUrl, target.key)]);
    if (r) return r;
  }

  // 2. 目次（保存してあればそれを使う）から候補ページを選んで取る
  let toc: TocState;
  const saved = readStoredToc(db, tocUrl);
  if (saved) {
    toc = { stored: saved, source: 'db' };
  } else {
    const loaded = await fetchToc();
    if ('kind' in loaded) return loaded;
    if (!('state' in loaded)) return { kind: 'no_candidates' };
    toc = loaded.state;
  }
  const first = await tryPages(selectCandidatePages(toc.stored.toc, target.key));
  if (first) return first;

  // 3. 候補を決められない・どれにも無い・どれも存在しないときは、保存してあった目次を
  //    1 回だけ条件付きで取り直す。この呼び出しで取得した目次は取り直さない。
  //    上限に達したときは、取り直しても取れるページが無いので取り直さない
  if (toc.source === 'db' && skippedByLimit === 0) {
    const refreshed = await fetchToc(toc.stored);
    if ('kind' in refreshed) return refreshed;
    if ('state' in refreshed) {
      const second = await tryPages(selectCandidatePages(refreshed.state.stored.toc, target.key));
      if (second) return second;
    }
  }

  if (searchedUrls.length === 0) return { kind: 'no_candidates' };
  return {
    kind: 'not_found',
    availableClauses,
    searchedUrls,
    allMissing: pagesParsed === 0,
    skippedByLimit,
  };
}

/** 存在しないページ（404 / 410、国税庁サイトの 404 ページへの転送）か */
function isMissingPage(err: NtaFetchError): boolean {
  return err.status === 404 || err.status === 410;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * テスト用のタックスアンサーの索引（国税庁の /taxes/shiraberu/taxanswer/code/ の代わり）。
 *
 * v0.24.0（SPEC-NTA-GET-TAX-ANSWER-003・016、houki-nta-mcp #128）から、nta_get_tax_answer は DB に無い記事の URL を
 * 国税庁の索引で決める。国税庁サイトを fetchImpl で差し替えるテストは、記事のページに加えて索引も返す必要がある。
 *
 * 索引の中身は、houki-hub docs/notes/2026-10-03-issue-draft-nta-tax-answer-8xxx.md と
 * specs の差分 20261003-source-paths の proposal.md「確かめた値」の 2026-10-03 JST の実測値から組み立てる
 * （755 件、先頭の桁とフォルダの組ごとの件数、Issue の例に出た番号）。
 */

export const TAX_ANSWER_INDEX_URL = 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/code/';

export interface IndexEntry {
  no: string;
  folder: string;
  title: string;
}

/** 先頭の桁とフォルダの組ごとの件数と、Issue の例に出た番号。例に無い番号は、その千の位の空いている番号で埋める */
export const MEASURED_GROUPS: Array<
  [digit: string, folder: string, count: number, examples: string[]]
> = [
  ['1', 'shotoku', 170, ['1120', '1131']],
  ['2', 'gensen', 65, ['2502']],
  ['2', 'shotoku', 37, ['2010', '2011', '2012', '2020', '2022']],
  ['3', 'joto', 71, ['3240']],
  ['3', 'shotoku', 1, ['3382']],
  ['3', 'hojin', 1, ['3429']],
  ['4', 'sozoku', 52, ['4102']],
  ['4', 'hyoka', 29, ['4603', '4604', '4605', '4606', '4607']],
  ['4', 'zoyo', 29, ['4402', '4405', '4408', '4410', '4411']],
  ['5', 'hojin', 109, ['5759']],
  ['6', 'shohi', 118, ['6101']],
  ['7', 'inshi', 30, ['7124']],
  ['7', 'hotei', 14, ['7400', '7401', '7411', '7421', '7431']],
  ['7', 'fufuku', 2, ['7200', '7210']],
  [
    '8',
    'saigai',
    16,
    Array.from({ length: 17 }, (_, i) => `${8001 + i}`).filter((n) => n !== '8010'),
  ],
  ['9', 'osirase', 11, ['9201']],
];

/** 索引に載せない番号（テストで「索引に無い」に使う） */
export const NOT_IN_INDEX: ReadonlySet<string> = new Set(['6999', '6998', '0101']);

export function buildMeasuredIndex(): IndexEntry[] {
  const used = new Set<string>(NOT_IN_INDEX);
  for (const [, , , examples] of MEASURED_GROUPS) for (const n of examples) used.add(n);
  const entries: IndexEntry[] = [];
  for (const [digit, folder, count, examples] of MEASURED_GROUPS) {
    const numbers = [...examples];
    for (let n = Number(`${digit}000`); numbers.length < count; n++) {
      const s = `${n}`;
      if (used.has(s)) continue;
      used.add(s);
      numbers.push(s);
    }
    for (const no of numbers) entries.push({ no, folder, title: `記事 ${no}` });
  }
  return entries;
}

export const MEASURED_INDEX: readonly IndexEntry[] = buildMeasuredIndex();

export function taxAnswerIndexHtml(entries: readonly IndexEntry[]): string {
  const links = entries
    .map(
      (e) =>
        `<li><a href="/taxes/shiraberu/taxanswer/${e.folder}/${e.no}.htm">No.${e.no} ${e.title}</a></li>`
    )
    .join('\n');
  return `<html><body><div id="bodyArea"><ul>${links}</ul></div></body></html>`;
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * 索引の URL には測った索引を返し、それ以外は渡した fetch に任せる fetch を作る。
 * 記事のページを返す既存のテストの fetchImpl を包んで使う
 */
export function withTaxAnswerIndex(
  inner: typeof fetch,
  entries: readonly IndexEntry[] = MEASURED_INDEX
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (urlOf(input) === TAX_ANSWER_INDEX_URL) {
      return new Response(taxAnswerIndexHtml(entries), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    }
    return inner(input, init);
  }) as typeof fetch;
}

/**
 * 仕様 ID の形式と、specs/ とテストを走査する共通部分。
 *
 * ID の形式を変えるときは、このファイルだけを直す。
 * check-spec-ids.mjs と next-spec-id.mjs はここから読む。
 *
 * 形式: `SPEC-<領域>-<機能>-<3 桁>`
 *   - 領域: リポジトリを表す英大文字（このリポジトリは NTA）
 *   - 機能: その仕様が入っている `specs/current/<dir>/spec.md` のディレクトリ名から、
 *     領域の接頭辞（`nta_`）を除いて大文字にし、`_` を `-` にしたもの。例: nta_get_tsutatsu → GET-TSUTATSU
 *   - 3 桁: 機能ごとの通し番号。001 から。機能内で一度使った番号は再利用しない
 *
 * 例: SPEC-NTA-GET-TSUTATSU-001
 *
 * 番号の数列をリポジトリ 1 本ではなく機能ごとに分けるので、並行するブランチが衝突するのは
 * 「同じ機能の仕様を同時に足したとき」だけになる。そのときは check-spec-ids.mjs の重複検知で止まる。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

/** このリポジトリの領域 */
export const DOMAIN = 'NTA';

/** ディレクトリ名から機能を導くときに除く接頭辞 */
export const DIR_PREFIX = 'nta_';

/** ID の形（本文のどこにあっても拾う）。機能の部分はハイフンを含んでよく、末尾 3 桁が番号 */
export const ID_RE = /SPEC-[A-Z]+-[A-Z0-9-]+-[0-9]{3}\b/g;

/** 仕様 1 件の見出し。`### SPEC-NTA-GET-TSUTATSU-001 題` の形。採番・重複検知・機能の照合はこの見出しだけを数える */
export const HEADING_RE = /^###\s+(SPEC-[A-Z]+-[A-Z0-9-]+-[0-9]{3})\b/gm;

/** テスト名。describe( / it( / test( の第 1 引数の文字列リテラル */
export const TEST_NAME_RE = /\b(?:describe|it|test)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;

/** 領域・機能・番号から ID を組み立てる */
export function formatId(domain, feature, n) {
  return `SPEC-${domain}-${feature}-${String(n).padStart(3, '0')}`;
}

/** ID を領域・機能・番号に分ける。形に合わなければ null */
export function parseId(id) {
  const m = /^SPEC-([A-Z]+)-([A-Z0-9-]+)-([0-9]{3})$/.exec(id);
  return m ? { domain: m[1], feature: m[2], n: Number(m[3]) } : null;
}

/** `specs/current/<dir>/spec.md` のディレクトリ名から機能を導く。例: nta_get_tsutatsu → GET-TSUTATSU */
export function featureOfDir(dirName) {
  const stripped = dirName.startsWith(DIR_PREFIX) ? dirName.slice(DIR_PREFIX.length) : dirName;
  return stripped.toUpperCase().replaceAll('_', '-');
}

/** spec.md のパスから機能を導く。specs/changes/<id>/spec.md のように機能ディレクトリでない場合は null */
export function featureOfSpecPath(specPath) {
  const rel = relative(ROOT, specPath).split('/');
  // specs/current/<dir>/spec.md
  if (rel[0] === 'specs' && rel[1] === 'current' && rel.length === 4) return featureOfDir(rel[2]);
  return null;
}

export const ROOT = new URL('..', import.meta.url).pathname;

export function walk(dir, pred, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

/** 突合の対象になる仕様ファイル（現行と進行中の差分。releases/ は見ない） */
export function specFiles() {
  return [
    ...walk(join(ROOT, 'specs', 'current'), (p) => p.endsWith('spec.md')),
    ...walk(join(ROOT, 'specs', 'changes'), (p) => p.endsWith('spec.md')),
  ];
}

export function testFiles() {
  return [
    ...walk(join(ROOT, 'src'), (p) => p.endsWith('.test.ts')),
    ...walk(join(ROOT, 'tests'), (p) => p.endsWith('.test.ts')),
  ];
}

/**
 * ファイル群から ID を集める。戻り値は Map<ID, Set<相対パス>>。
 * `extract(text)` は 1 ファイルの本文から ID の配列を返す（重複を含んでよい）。
 */
export function collect(files, extract) {
  const where = new Map();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const id of extract(text)) {
      if (!where.has(id)) where.set(id, new Set());
      where.get(id).add(relative(ROOT, f));
    }
  }
  return where;
}

/** 見出しに現れた ID を、出現回数つきで数える。戻り値は Map<ID, Array<相対パス>>（同じファイルに 2 回あれば 2 要素） */
export function collectHeadings(files) {
  const where = new Map();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(HEADING_RE)) {
      const id = m[1];
      if (!where.has(id)) where.set(id, []);
      where.get(id).push(relative(ROOT, f));
    }
  }
  return where;
}

export { basename, dirname };

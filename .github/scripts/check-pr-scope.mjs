#!/usr/bin/env node
/**
 * PR が触ってよいパスを、ブランチ名の接頭辞で決めて検査する（AGENTS.md「PR の種類」）。
 *
 * | ブランチ        | 種類         | 変えてよいもの |
 * |-----------------|--------------|----------------|
 * | `spec/*`        | 仕様 PR      | `specs/changes/`。proposal.md の front matter が `implementation: none` なら `specs/current/` も |
 * | `spec-init/*`   | 初版起こし   | `specs/current/<dir>/spec.md` と、テスト名に仕様 ID を足すだけの変更 |
 * | それ以外        | 実装 PR など | `specs/changes/` は `specs/releases/` への移動だけ |
 *
 * 承認の記録は、ファイルの先頭の front matter で見る（spec-ids 0.3.0 の形。読み取りは `@shuji-bonji/spec-ids` の
 * `readFrontMatter`）。次のどれかが欠けていれば止める。承認日と PR 番号は人がマージの前に書く。
 * - 仕様 PR の proposal.md: `approved` と `pr`（空でないこと）
 * - どの種類でも、変わった `specs/current/<dir>/spec.md`: `approved` と `pr`（初版の承認）、
 *   または `introduced_by`（差分で作った機能）
 * front matter の書式そのもの（キーの打ち間違い、値の形、古い「- 承認日:」の行）は `spec-ids check`（spec-gate）が見る。
 *
 * 使い方（CI）: BASE_REF=origin/main HEAD_REF=<ブランチ名> node .github/scripts/check-pr-scope.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readFrontMatter } from '@shuji-bonji/spec-ids';

const ID_RE = /SPEC-[A-Z]+-[A-Z0-9-]+-[0-9]{3}/g;
const ID_WITH_SPACE_RE = /SPEC-[A-Z]+-[A-Z0-9-]+-[0-9]{3}\s*/g;
const TEST_FILE_RE = /\.test\.[cm]?[jt]s$/;
const CURRENT_SPEC_RE = /^specs\/current\/[^/]+\/spec\.md$/;
const PROPOSAL_RE = /^specs\/changes\/[^/]+\/proposal\.md$/;
/** `git diff -U0` のハンクの見出し。旧ファイルの開始行・行数と、新ファイルの開始行・行数 */
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
/** front matter の 1 行（`キー: 値` か `キー:`）。値の形は spec-ids check が見る */
const FRONT_MATTER_LINE_RE = /^[a-z_]+:( .*)?$/;
/** spec-ids migrate が proposal.md から消す行（「- 実装の変更の補足:」は含まない） */
const MIGRATE_REMOVED_RE = /^- (承認日|実装の変更):/;
/** spec-ids migrate が proposal.md に足す行（front matter 以外） */
const MIGRATE_ADDED_RE = /^- 実装の変更の補足:/;

/** front matter の値。front matter が無いファイルは空のオブジェクト（どのキーも無い）として扱う */
function frontMatterOf(text) {
  return readFrontMatter(text)?.data ?? {};
}

/** 値が空でないか（readFrontMatter は空の値を null で返す） */
function filled(value) {
  return value !== undefined && value !== null && value !== '';
}

/** 仕様 PR の proposal.md に、承認日と PR 番号があるか */
export function proposalApproved(text) {
  const fm = frontMatterOf(text);
  return filled(fm.approved) && filled(fm.pr);
}

/** proposal.md の差分が、実装の変更を要らないとしているか（`implementation: none`） */
export function noImplementation(text) {
  return frontMatterOf(text).implementation === 'none';
}

/** current の spec.md に、初版の承認（approved と pr）か、作った差分（introduced_by）があるか */
export function currentApproved(text) {
  const fm = frontMatterOf(text);
  return (filled(fm.approved) && filled(fm.pr)) || filled(fm.introduced_by);
}

/** ブランチ名から PR の種類を決める */
export function kindOf(branch) {
  if (branch.startsWith('spec/')) return 'spec';
  if (branch.startsWith('spec-init/')) return 'spec-init';
  return 'impl';
}

/** `git diff --name-status -M` の出力を { status, path, from } の配列にする */
export function parseNameStatus(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, a, b] = line.split('\t');
      return status.startsWith('R') ? { status: 'R', from: a, path: b } : { status, path: a };
    });
}

/**
 * `git diff -U0` の 1 ファイル分から、変わった行が「テスト名に仕様 ID を足しただけ」かを見る。
 * 消えた行と足された行を順に対にし、次の 3 つを満たせば true。
 * - 両方から ID を除くと同じ行になる（ID 以外の文字は変わっていない）
 * - 消えた行にあった ID は、足された行にもすべて残っている（ID を消していない）
 * - 足された行の ID の方が多い（何か足している）
 * すでに ID の付いたテスト名に、別の ID を足す場合も通す。
 */
export function onlyIdsAdded(unifiedDiff) {
  const removed = [];
  const added = [];
  for (const line of unifiedDiff.split('\n')) {
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    if (line.startsWith('-')) removed.push(line.slice(1));
    else if (line.startsWith('+')) added.push(line.slice(1));
  }
  if (removed.length !== added.length) return false;
  return added.every((a, i) => {
    const r = removed[i];
    if (a.replace(ID_WITH_SPACE_RE, '') !== r.replace(ID_WITH_SPACE_RE, '')) return false;
    const before = r.match(ID_RE) ?? [];
    const after = a.match(ID_RE) ?? [];
    return before.every((id) => after.includes(id)) && after.length > before.length;
  });
}

/** 行の並びが front matter のブロック（`---`、`キー: 値` の行、`---`）か */
function isFrontMatterBlock(lines) {
  return (
    lines.length >= 2 &&
    lines[0] === '---' &&
    lines.at(-1) === '---' &&
    lines.slice(1, -1).every((l) => FRONT_MATTER_LINE_RE.test(l))
  );
}

/**
 * spec-ids migrate の変換のための例外。pr-scope を spec-ids に取り込むとき（spec-ids#5 の後の版）に外す。
 *
 * `git diff -U0` の 1 ファイル分（`specs/changes/<id>/proposal.md`）が、spec-ids migrate の変換による書き換えだけかを見る。
 * 次の 3 つだけでできていれば true。それ以外の行の追加・削除が 1 つでもあれば false。
 * - ファイルの先頭に front matter の行（`---`、`キー: 値`、`---`）を足す（最初のハンクが旧ファイルの 0 行目の後への追加）
 * - 「- 承認日:」「- 実装の変更:」で始まる行を消す
 * - 「- 実装の変更の補足:」で始まる行を足す
 * 先頭に front matter を足していない差分（変換の前からあった front matter を書き換えたものを含む）は通さない。
 */
export function onlyMigrateConversion(unifiedDiff) {
  const hunks = [];
  for (const line of unifiedDiff.split('\n')) {
    const h = HUNK_RE.exec(line);
    if (h) {
      hunks.push({
        oldStart: Number(h[1]),
        oldCount: h[2] === undefined ? 1 : Number(h[2]),
        newStart: Number(h[3]),
        removed: [],
        added: [],
      });
      continue;
    }
    const hunk = hunks.at(-1);
    // 最初のハンクより前の見出し（diff --git・index・---・+++）、空の行、\ No newline at end of file
    if (hunk === undefined || line === '' || line.startsWith('\\')) continue;
    if (line.startsWith('-')) hunk.removed.push(line.slice(1));
    else if (line.startsWith('+')) hunk.added.push(line.slice(1));
    else return false; // -U0 に文脈の行は出ない
  }
  if (hunks.length === 0) return false;
  const [first, ...rest] = hunks;
  if (first.oldStart !== 0 || first.oldCount !== 0 || first.newStart !== 1) return false;
  if (!isFrontMatterBlock(first.added)) return false;
  return rest.every(
    (h) => h.removed.every((l) => MIGRATE_REMOVED_RE.test(l)) && h.added.every((l) => MIGRATE_ADDED_RE.test(l))
  );
}

/**
 * 変更の一覧と、ファイルを読む関数から、違反の一覧を返す。
 * @param {{ kind: string, changes: Array<{status: string, path: string, from?: string}>, read: (p: string) => string, diffOf: (p: string) => string }} input
 * @returns {string[]}
 */
export function checkScope({ kind, changes, read, diffOf }) {
  const errors = [];
  const touched = (c) => [c.path, c.from].filter(Boolean);

  if (kind === 'spec') {
    const proposals = changes.filter((c) => c.status !== 'D' && PROPOSAL_RE.test(c.path));
    const noImpl = proposals.some((c) => noImplementation(read(c.path)));
    for (const c of changes) {
      for (const p of touched(c)) {
        if (p.startsWith('specs/changes/')) continue;
        if (noImpl && CURRENT_SPEC_RE.test(p)) continue;
        errors.push(
          `仕様 PR（spec/*）は specs/changes/ だけを変えます: ${p}${
            CURRENT_SPEC_RE.test(p)
              ? '（specs/current/ を書けるのは、proposal.md の front matter が implementation: none のときだけ）'
              : ''
          }`
        );
      }
    }
    if (proposals.length === 0) {
      errors.push('仕様 PR（spec/*）に specs/changes/<id>/proposal.md がありません');
    }
    for (const c of proposals) {
      if (!proposalApproved(read(c.path))) {
        errors.push(`承認日と PR 番号がありません（マージの前に front matter の approved と pr を書く）: ${c.path}`);
      }
    }
  } else if (kind === 'spec-init') {
    for (const c of changes) {
      if (CURRENT_SPEC_RE.test(c.path) && c.status !== 'D' && c.status !== 'R') continue;
      if (TEST_FILE_RE.test(c.path) && c.status === 'M') {
        if (!onlyIdsAdded(diffOf(c.path))) {
          errors.push(`初版起こし（spec-init/*）はテスト名に仕様 ID を足すだけです。それ以外の変更があります: ${c.path}`);
        }
        continue;
      }
      for (const p of touched(c)) {
        errors.push(`初版起こし（spec-init/*）は specs/current/<dir>/spec.md とテスト名だけを変えます: ${p}`);
      }
    }
  } else {
    for (const c of changes) {
      if (c.status === 'R' && c.from.startsWith('specs/changes/') && c.path.startsWith('specs/releases/')) {
        continue;
      }
      // spec-ids migrate の変換のための例外。pr-scope を spec-ids に取り込むとき（spec-ids#5 の後の版）に外す
      if (c.status === 'M' && PROPOSAL_RE.test(c.path) && onlyMigrateConversion(diffOf(c.path))) {
        continue;
      }
      for (const p of touched(c)) {
        if (p.startsWith('specs/changes/')) {
          errors.push(`仕様 PR の外で specs/changes/ を変えています（許されるのは specs/releases/ への移動だけ）: ${p}`);
        }
      }
    }
  }

  for (const c of changes) {
    if (c.status === 'D' || !CURRENT_SPEC_RE.test(c.path)) continue;
    if (!currentApproved(read(c.path))) {
      errors.push(
        `承認日と PR 番号がありません（マージの前に front matter の approved と pr を書く。差分で作った機能なら introduced_by）: ${c.path}`
      );
    }
  }
  return [...new Set(errors)];
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function main() {
  const base = process.env.BASE_REF ?? 'origin/main';
  const branch = process.env.HEAD_REF ?? git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const kind = kindOf(branch);
  const changes = parseNameStatus(git(['diff', '--name-status', '-M', `${base}...HEAD`]));
  const errors = checkScope({
    kind,
    changes,
    read: (p) => readFileSync(p, 'utf8'),
    diffOf: (p) => git(['diff', '-U0', `${base}...HEAD`, '--', p]),
  });
  console.log(`branch: ${branch}（${kind}）、変更 ${changes.length} ファイル`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log('OK: この種類の PR が変えてよい範囲に収まっています');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

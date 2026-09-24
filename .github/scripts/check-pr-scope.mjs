#!/usr/bin/env node
/**
 * PR が触ってよいパスを、ブランチ名の接頭辞で決めて検査する（AGENTS.md「PR の種類」）。
 *
 * | ブランチ        | 種類         | 変えてよいもの |
 * |-----------------|--------------|----------------|
 * | `spec/*`        | 仕様 PR      | `specs/changes/`。proposal.md が「実装の変更: 不要」なら `specs/current/` も |
 * | `spec-init/*`   | 初版起こし   | `specs/current/<dir>/spec.md` と、テスト名に仕様 ID を足すだけの変更 |
 * | それ以外        | 実装 PR など | `specs/changes/` は `specs/releases/` への移動だけ |
 *
 * どの種類でも、変わった `specs/current/<dir>/spec.md` と仕様 PR の proposal.md に、
 * 承認日（`- 承認日: YYYY-MM-DD`）が無ければ止める。承認日は人がマージの前に書く。
 *
 * 使い方（CI）: BASE_REF=origin/main HEAD_REF=<ブランチ名> node .github/scripts/check-pr-scope.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ID_WITH_SPACE_RE = /SPEC-[A-Z]+-[A-Z0-9-]+-[0-9]{3}\s*/g;
const APPROVAL_RE = /^- 承認日: \d{4}-\d{2}-\d{2}/m;
const PR_NUMBER_RE = /#\d+/;
const NO_IMPL_RE = /^- 実装の変更: 不要/m;
const TEST_FILE_RE = /\.test\.[cm]?[jt]s$/;
const CURRENT_SPEC_RE = /^specs\/current\/[^/]+\/spec\.md$/;
const PROPOSAL_RE = /^specs\/changes\/[^/]+\/proposal\.md$/;

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
 * 消えた行と足された行を順に対にし、足された行から ID を除くと消えた行と同じなら true。
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
  return added.every((a, i) => a !== removed[i] && a.replace(ID_WITH_SPACE_RE, '') === removed[i]);
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
    const noImpl = proposals.some((c) => NO_IMPL_RE.test(read(c.path)));
    for (const c of changes) {
      for (const p of touched(c)) {
        if (p.startsWith('specs/changes/')) continue;
        if (noImpl && CURRENT_SPEC_RE.test(p)) continue;
        errors.push(
          `仕様 PR（spec/*）は specs/changes/ だけを変えます: ${p}${
            CURRENT_SPEC_RE.test(p) ? '（specs/current/ を書くなら proposal.md に「- 実装の変更: 不要」）' : ''
          }`
        );
      }
    }
    if (proposals.length === 0) {
      errors.push('仕様 PR（spec/*）に specs/changes/<id>/proposal.md がありません');
    }
    for (const c of proposals) {
      const text = read(c.path);
      if (!APPROVAL_RE.test(text) || !PR_NUMBER_RE.test(text.match(/^- 承認日:.*$/m)?.[0] ?? '')) {
        errors.push(
          `承認日と PR 番号がありません（マージの前に「- 承認日: YYYY-MM-DD（PR #N）」を書く）: ${c.path}`
        );
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
      for (const p of touched(c)) {
        if (p.startsWith('specs/changes/')) {
          errors.push(`仕様 PR の外で specs/changes/ を変えています（許されるのは specs/releases/ への移動だけ）: ${p}`);
        }
      }
    }
  }

  for (const c of changes) {
    if (c.status === 'D' || !CURRENT_SPEC_RE.test(c.path)) continue;
    if (!APPROVAL_RE.test(read(c.path))) {
      errors.push(`承認日がありません（マージの前に「- 承認日: YYYY-MM-DD」を書く）: ${c.path}`);
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

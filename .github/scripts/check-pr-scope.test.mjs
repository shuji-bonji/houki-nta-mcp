import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkScope,
  currentApproved,
  kindOf,
  noImplementation,
  onlyIdsAdded,
  onlyMigrateConversion,
  parseNameStatus,
  proposalApproved,
} from './check-pr-scope.mjs';

/** front matter を組み立てる。値が null のキーは「キー:」だけ（空の値）にする */
function fm(fields, body) {
  const lines = Object.entries(fields).map(([k, v]) => (v === null ? `${k}:` : `${k}: ${v}`));
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

const APPROVED_PROPOSAL = fm(
  { approved: '2026-09-25', pr: 60, implementation: 'required', targets: '[nta_get_tsutatsu]' },
  '# 差分\n'
);
const NO_IMPL_PROPOSAL = APPROVED_PROPOSAL.replace('implementation: required', 'implementation: none');
const APPROVED_SPEC = fm({ spec_id: 'NTA', kind: 'tool', approved: '2026-09-25', pr: 60 }, '# 機能\n');
const UNAPPROVED_SPEC = fm({ spec_id: 'NTA', kind: 'tool', approved: null, pr: null }, '# 機能\n');

/** spec-ids migrate が specs/changes/<id>/proposal.md を書き換えたときの git diff -U0（#156 の差分と同じ形） */
const CHANGES_PROPOSAL = 'specs/changes/20261009-inspect-pdf-meta-qa-jirei/proposal.md';
const MIGRATE_DIFF = [
  `diff --git a/${CHANGES_PROPOSAL} b/${CHANGES_PROPOSAL}`,
  'index 420e8a5..bce2bd8 100644',
  `--- a/${CHANGES_PROPOSAL}`,
  `+++ b/${CHANGES_PROPOSAL}`,
  '@@ -0,0 +1,6 @@',
  '+---',
  '+approved: 2026-10-09',
  '+pr: 157',
  '+implementation: none',
  '+targets: [db_schema, nta_inspect_pdf_meta]',
  '+---',
  '@@ -4,2 +9,0 @@',
  '-- 実装の変更: 不要',
  '-- 承認日: 2026-10-09（PR #157）',
  '',
].join('\n');

function run(kind, changes, files = {}, diffs = {}) {
  return checkScope({
    kind,
    changes,
    read: (p) => files[p] ?? '',
    diffOf: (p) => diffs[p] ?? '',
  });
}

test('ブランチ名の接頭辞で種類が決まる', () => {
  assert.equal(kindOf('spec/20260925-live-scope'), 'spec');
  assert.equal(kindOf('spec-init/nta-get-qa'), 'spec-init');
  assert.equal(kindOf('fix/54-live-scope'), 'impl');
});

test('name-status の rename を from / path に分ける', () => {
  assert.deepEqual(parseNameStatus('M\tsrc/a.ts\nR100\tspecs/changes/x/spec.md\tspecs/releases/v1/x/spec.md\n'), [
    { status: 'M', path: 'src/a.ts' },
    { status: 'R', from: 'specs/changes/x/spec.md', path: 'specs/releases/v1/x/spec.md' },
  ]);
});

test('仕様 PR: specs/changes だけで承認日と PR 番号があれば通る', () => {
  const p = 'specs/changes/20260925-x/proposal.md';
  const errors = run('spec', [{ status: 'A', path: p }, { status: 'A', path: 'specs/changes/20260925-x/spec.md' }], {
    [p]: APPROVED_PROPOSAL,
  });
  assert.deepEqual(errors, []);
});

test('仕様 PR: src/ を変えると止まる', () => {
  const p = 'specs/changes/20260925-x/proposal.md';
  const errors = run('spec', [{ status: 'A', path: p }, { status: 'M', path: 'src/tools/handlers.ts' }], {
    [p]: APPROVED_PROPOSAL,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /src\/tools\/handlers\.ts/);
});

test('仕様 PR: front matter の approved と pr が空なら止まる', () => {
  const p = 'specs/changes/20260925-x/proposal.md';
  const draft = fm({ approved: null, pr: null, implementation: 'required', targets: '[nta_get_qa]' }, '# 差分\n');
  const errors = run('spec', [{ status: 'A', path: p }], { [p]: draft });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /承認日と PR 番号/);
});

test('仕様 PR: approved があっても pr が空なら止まる', () => {
  const p = 'specs/changes/20260925-x/proposal.md';
  const noPr = APPROVED_PROPOSAL.replace('pr: 60', 'pr:');
  const errors = run('spec', [{ status: 'A', path: p }], { [p]: noPr });
  assert.equal(errors.length, 1);
});

test('仕様 PR: 古い形（本文の「- 承認日:」の行だけで front matter が無い）の proposal.md は止まる', () => {
  const p = 'specs/changes/20260925-x/proposal.md';
  const legacy = '# 差分\n\n- 承認日: 2026-09-25（PR #60）\n- 実装の変更: 要\n';
  const errors = run('spec', [{ status: 'A', path: p }], { [p]: legacy });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /front matter の approved と pr/);
});

test('仕様 PR: implementation: none なら specs/current も書いてよい（current の承認は要る）', () => {
  const p = 'specs/changes/20260925-x/proposal.md';
  const cur = 'specs/current/nta_get_tsutatsu/spec.md';
  const files = { [p]: NO_IMPL_PROPOSAL, [cur]: APPROVED_SPEC };
  assert.deepEqual(run('spec', [{ status: 'A', path: p }, { status: 'M', path: cur }], files), []);
  const noDate = { ...files, [cur]: UNAPPROVED_SPEC };
  assert.equal(run('spec', [{ status: 'A', path: p }, { status: 'M', path: cur }], noDate).length, 1);
});

test('仕様 PR: implementation: required で specs/current を書くと止まる', () => {
  const p = 'specs/changes/20260925-x/proposal.md';
  const cur = 'specs/current/nta_get_tsutatsu/spec.md';
  const errors = run('spec', [{ status: 'A', path: p }, { status: 'M', path: cur }], {
    [p]: APPROVED_PROPOSAL,
    [cur]: APPROVED_SPEC,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /implementation: none/);
});

test('仕様 PR: 本文の「- 実装の変更: 不要」の行だけでは specs/current を書けない', () => {
  const p = 'specs/changes/20260925-x/proposal.md';
  const cur = 'specs/current/nta_get_tsutatsu/spec.md';
  const legacy = `${APPROVED_PROPOSAL}- 実装の変更: 不要\n`;
  const errors = run('spec', [{ status: 'A', path: p }, { status: 'M', path: cur }], {
    [p]: legacy,
    [cur]: APPROVED_SPEC,
  });
  assert.equal(errors.length, 1);
});

test('実装 PR: specs/changes を releases へ移すのはよいが、書き換えると止まる', () => {
  const cur = 'specs/current/nta_get_tsutatsu/spec.md';
  const ok = run(
    'impl',
    [
      { status: 'M', path: 'src/tools/handlers.ts' },
      { status: 'M', path: cur },
      { status: 'R', from: 'specs/changes/x/spec.md', path: 'specs/releases/v0.21.0/x/spec.md' },
    ],
    { [cur]: APPROVED_SPEC }
  );
  assert.deepEqual(ok, []);
  const ng = run('impl', [{ status: 'M', path: 'specs/changes/x/spec.md' }]);
  assert.equal(ng.length, 1);
});

test('実装 PR: 取り込んだ specs/current に初版の承認が無ければ止まる', () => {
  const cur = 'specs/current/nta_get_tsutatsu/spec.md';
  const errors = run('impl', [{ status: 'M', path: cur }], { [cur]: UNAPPROVED_SPEC });
  assert.equal(errors.length, 1);
  // 古い形（本文の「- 承認日:」の行だけ）も止める
  const legacy = '# 機能\n\n- 承認日: 2026-09-25（PR #60）\n';
  assert.equal(run('impl', [{ status: 'M', path: cur }], { [cur]: legacy }).length, 1);
});

test('実装 PR: 差分で作った機能（introduced_by）は approved と pr が無くても通る', () => {
  const cur = 'specs/current/cli_status/spec.md';
  const born = fm({ spec_id: 'NTA', kind: 'cli', introduced_by: '20261004-db-location' }, '# 機能\n');
  assert.deepEqual(run('impl', [{ status: 'A', path: cur }], { [cur]: born }), []);
});

test('front matter の判定: 空の値・front matter の無い本文を「無い」とみなす', () => {
  assert.equal(proposalApproved(APPROVED_PROPOSAL), true);
  assert.equal(proposalApproved('# 差分\n'), false);
  assert.equal(noImplementation(NO_IMPL_PROPOSAL), true);
  assert.equal(noImplementation(APPROVED_PROPOSAL), false);
  assert.equal(currentApproved(APPROVED_SPEC), true);
  assert.equal(currentApproved(UNAPPROVED_SPEC), false);
});

// spec-ids migrate の変換のための例外（Q23' の案 A）。pr-scope を spec-ids に取り込むときにテストごと外す
test('実装 PR: specs/changes の proposal.md を spec-ids migrate の変換だけで書き換えたなら通る', () => {
  const changes = [{ status: 'M', path: CHANGES_PROPOSAL }];
  assert.deepEqual(run('impl', changes, {}, { [CHANGES_PROPOSAL]: MIGRATE_DIFF }), []);
  // 「- 実装の変更:」の括弧書きを「- 実装の変更の補足:」に移した形も通る
  const withNote = MIGRATE_DIFF.replace('-- 実装の変更: 不要', '-- 実装の変更: 要（受入テストを足す）').replace(
    '@@ -4,2 +9,0 @@',
    '@@ -4,2 +9 @@'
  );
  const noteDiff = withNote.replace(
    '-- 承認日: 2026-10-09（PR #157）\n',
    '-- 承認日: 2026-10-09（PR #157）\n+- 実装の変更の補足: 受入テストを足す\n'
  );
  assert.equal(onlyMigrateConversion(noteDiff), true);
  assert.deepEqual(run('impl', changes, {}, { [CHANGES_PROPOSAL]: noteDiff }), []);
});

test('実装 PR: specs/changes の proposal.md の本文の行を変えていれば、変換と一緒でも止まる', () => {
  const changes = [{ status: 'M', path: CHANGES_PROPOSAL }];
  // 変換の書き換えに加えて、本文の「- 対象 Issue:」の行を書き換えた
  const bodyEdited = `${MIGRATE_DIFF}${[
    '@@ -12 +15 @@',
    '-- 対象 Issue: houki-nta-mcp #156',
    '+- 対象 Issue: houki-nta-mcp #156、#158',
    '',
  ].join('\n')}`;
  assert.equal(onlyMigrateConversion(bodyEdited), false);
  const errors = run('impl', changes, {}, { [CHANGES_PROPOSAL]: bodyEdited });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /specs\/changes\//);
});

test('変換の例外: front matter を先頭に足していない書き換えは通さない', () => {
  // 「- 承認日:」の行を消しただけ（front matter が無い）
  const removeOnly = ['@@ -5 +4,0 @@', '-- 承認日: 2026-10-09（PR #157）', ''].join('\n');
  assert.equal(onlyMigrateConversion(removeOnly), false);
  // front matter の形の行を、先頭ではない位置に足した
  const notAtTop = MIGRATE_DIFF.replace('@@ -0,0 +1,6 @@', '@@ -2,0 +3,6 @@');
  assert.equal(onlyMigrateConversion(notAtTop), false);
  // 先頭に足した行が front matter の形でない
  const notFrontMatter = MIGRATE_DIFF.replace('+pr: 157', '+この差分は承認済み');
  assert.equal(onlyMigrateConversion(notFrontMatter), false);
  // 「- 実装の変更の補足:」以外の行を足した
  const extraLine = `${MIGRATE_DIFF}@@ -6,0 +10 @@\n+- 状態: 取り込み済み\n`;
  assert.equal(onlyMigrateConversion(extraLine), false);
  // 空の diff
  assert.equal(onlyMigrateConversion(''), false);
});

test('変換の例外: specs/changes の proposal.md の書き換え（M）にだけ使い、ほかのファイルや追加（A）には使わない', () => {
  const other = 'specs/changes/20261009-inspect-pdf-meta-qa-jirei/spec.md';
  const errors = run('impl', [{ status: 'M', path: other }], {}, { [other]: MIGRATE_DIFF });
  assert.equal(errors.length, 1);
  const added = run('impl', [{ status: 'A', path: CHANGES_PROPOSAL }], {}, { [CHANGES_PROPOSAL]: MIGRATE_DIFF });
  assert.equal(added.length, 1);
});

test('初版起こし: spec.md の追加と、テスト名に ID を足すだけの変更は通る', () => {
  const cur = 'specs/current/nta_get_qa/spec.md';
  const t = 'src/tools/handlers.test.ts';
  const diff = [
    `--- a/${t}`,
    `+++ b/${t}`,
    '@@ -1 +1 @@',
    "-  it('未対応 topic はエラー', async () => {",
    "+  it('SPEC-NTA-GET-QA-001 未対応 topic はエラー', async () => {",
  ].join('\n');
  const errors = run(
    'spec-init',
    [{ status: 'A', path: cur }, { status: 'M', path: t }],
    { [cur]: APPROVED_SPEC },
    { [t]: diff }
  );
  assert.deepEqual(errors, []);
});

test('初版起こし: すでに ID の付いたテスト名に別の ID を足すのは通す', () => {
  const diff = [
    '@@ -1 +1 @@',
    "-  it('SPEC-NTA-SEARCH-TSUTATSU-001 inputSchema に無い引数は INVALID_ARGUMENT', async () => {",
    "+  it('SPEC-NTA-SEARCH-TSUTATSU-001 SPEC-NTA-COMMON-ERRORS-004 inputSchema に無い引数は INVALID_ARGUMENT', async () => {",
  ].join('\n');
  assert.equal(onlyIdsAdded(diff), true);
});

test('初版起こし: テスト名から既存の ID を消すと止まる', () => {
  const removeOnly = [
    '@@ -1 +1 @@',
    "-  it('SPEC-NTA-GET-QA-001 未対応 topic はエラー', async () => {",
    "+  it('未対応 topic はエラー', async () => {",
  ].join('\n');
  assert.equal(onlyIdsAdded(removeOnly), false);
  const swap = [
    '@@ -1 +1 @@',
    "-  it('SPEC-NTA-GET-QA-001 未対応 topic はエラー', async () => {",
    "+  it('SPEC-NTA-GET-QA-002 未対応 topic はエラー', async () => {",
  ].join('\n');
  assert.equal(onlyIdsAdded(swap), false);
});

test('初版起こし: テストの期待値を変えると止まる', () => {
  const t = 'src/tools/handlers.test.ts';
  const diff = ['@@ -1 +1 @@', "-    expect(r.error).toContain('未対応');", "+    expect(r.error).toContain('対応');"].join('\n');
  assert.equal(onlyIdsAdded(diff), false);
  const errors = run('spec-init', [{ status: 'M', path: t }], {}, { [t]: diff });
  assert.equal(errors.length, 1);
});

test('初版起こし: 承認日が無ければ止まる、src/ の実装を変えると止まる', () => {
  const cur = 'specs/current/nta_get_qa/spec.md';
  const errors = run('spec-init', [
    { status: 'A', path: cur },
    { status: 'M', path: 'src/tools/handlers.ts' },
  ], { [cur]: UNAPPROVED_SPEC });
  assert.equal(errors.length, 2);
});

test('specs に触れない PR（docs など）はそのまま通る', () => {
  assert.deepEqual(run('impl', [{ status: 'M', path: 'README.md' }]), []);
});

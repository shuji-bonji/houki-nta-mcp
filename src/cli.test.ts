/**
 * Phase 2e: CLI フラグ拡張のテスト。
 *
 * `--bulk-download-all` / `--refresh-stale=<日数>` / `--apply` などのパース確認。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatBulkEstimates,
  formatInvalidTaxonomyValues,
  parseArgs,
  runCliIfRequested,
} from './cli.js';

// v0.10.2: --refresh が bulkDownloadTsutatsu の forceReload に渡ることを確認するため、
// 実際の DL は mock する (国税庁サイトには触れない)
vi.mock('./services/bulk-downloader.js', () => ({
  bulkDownloadTsutatsu: vi.fn(async () => ({ sections: 0, clauses: 0 })),
}));
// v0.10.4: 残り 5 種別の downloader にも forceReload が渡ることを確認する
const emptyBulkResult = () => ({
  totalEntries: 0,
  documentsFetched: 0,
  documentsFailed: 0,
  durationMs: 0,
  perTaxonomy: {},
  perTopic: {},
});
vi.mock('./services/bunshokaitou-bulk-downloader.js', () => ({
  bulkDownloadBunshokaitou: vi.fn(async () => emptyBulkResult()),
}));
vi.mock('./services/jimu-unei-bulk-downloader.js', () => ({
  bulkDownloadJimuUnei: vi.fn(async () => emptyBulkResult()),
}));
vi.mock('./services/tax-answer-bulk-downloader.js', () => ({
  bulkDownloadTaxAnswer: vi.fn(async () => emptyBulkResult()),
}));
vi.mock('./services/qa-bulk-downloader.js', () => ({
  bulkDownloadQa: vi.fn(async () => emptyBulkResult()),
}));
vi.mock('./services/kaisei-bulk-downloader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/kaisei-bulk-downloader.js')>();
  return { ...actual, bulkDownloadKaisei: vi.fn(async () => emptyBulkResult()) };
});

import { bulkDownloadTsutatsu } from './services/bulk-downloader.js';
import { bulkDownloadBunshokaitou } from './services/bunshokaitou-bulk-downloader.js';
import { bulkDownloadJimuUnei } from './services/jimu-unei-bulk-downloader.js';
import { bulkDownloadKaisei } from './services/kaisei-bulk-downloader.js';
import { bulkDownloadQa } from './services/qa-bulk-downloader.js';
import { bulkDownloadTaxAnswer } from './services/tax-answer-bulk-downloader.js';

describe('parseArgs', () => {
  it('SPEC-NTA-CLI-ENTRY-001 既定値', () => {
    const a = parseArgs([]);
    expect(a.bulkDownload).toBe(false);
    expect(a.bulkDownloadAll).toBe(false);
    expect(a.staleDays).toBeUndefined();
    expect(a.refreshStale).toBe(false);
    expect(a.tsutatsu).toBe('消費税法基本通達');
    expect(a.help).toBe(false);
    expect(a.version).toBe(false);
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-001 --bulk-download-all', () => {
    const a = parseArgs(['--bulk-download-all']);
    expect(a.bulkDownloadAll).toBe(true);
    expect(a.bulkDownload).toBe(false);
  });

  it('SPEC-NTA-CLI-REFRESH-004 --refresh-stale=30 で staleDays が 30 になる', () => {
    const a = parseArgs(['--refresh-stale=30']);
    expect(a.staleDays).toBe(30);
    expect(a.refreshStale).toBe(false); // dry-run（未 --apply）
  });

  it('SPEC-NTA-CLI-REFRESH-005 --refresh-stale=30 --apply で再 DL モード', () => {
    const a = parseArgs(['--refresh-stale=30', '--apply']);
    expect(a.staleDays).toBe(30);
    expect(a.refreshStale).toBe(true);
  });

  // 差分 20261003-db-cli（#106）: 0 以上の整数でない日数は値のエラー（v0.23.x は無視して undefined）
  it('SPEC-NTA-CLI-REFRESH-006 不正な --refresh-stale 値は値の誤りとして集め、staleDays は undefined', () => {
    for (const v of ['abc', '-5']) {
      const a = parseArgs([`--refresh-stale=${v}`]);
      expect(a.staleDays).toBeUndefined();
      expect(a.argError?.kind).toBe('value');
      expect(a.argError?.messages).toEqual([
        `[houki-nta-mcp] --refresh-stale="${v}" は使えません。0 以上の整数の日数を指定してください（例: --refresh-stale=90）`,
      ]);
    }
  });

  it('SPEC-NTA-CLI-ENTRY-004 SPEC-NTA-CLI-BULK-DOWNLOAD-002 --db-path / --tsutatsu の併用', () => {
    const a = parseArgs([
      '--bulk-download',
      '--tsutatsu=所得税基本通達',
      '--db-path=/tmp/cache.db',
    ]);
    expect(a.bulkDownload).toBe(true);
    expect(a.tsutatsu).toBe('所得税基本通達');
    expect(a.dbPath).toBe('/tmp/cache.db');
  });

  it('SPEC-NTA-CLI-ENTRY-002 SPEC-NTA-CLI-ENTRY-003 --help / --version', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--version']).version).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
  });
});

describe('--refresh → forceReload (v0.10.2)', () => {
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  afterEach(() => {
    vi.mocked(bulkDownloadTsutatsu).mockClear();
  });

  it('SPEC-NTA-CLI-REFRESH-001 parseArgs: --refresh で refresh が true', () => {
    expect(parseArgs([]).refresh).toBe(false);
    expect(parseArgs(['--refresh']).refresh).toBe(true);
  });

  it('SPEC-NTA-CLI-REFRESH-001 --bulk-download --refresh は forceReload: true で bulkDownloadTsutatsu を呼ぶ', async () => {
    const handled = await runCliIfRequested(['--bulk-download', '--refresh', '--db-path=:memory:']);
    expect(handled).toBe(true);
    expect(bulkDownloadTsutatsu).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bulkDownloadTsutatsu).mock.calls[0][1]).toMatchObject({
      formalName: '消費税法基本通達',
      forceReload: true,
    });
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-002 --bulk-download だけなら forceReload: false (差分更新)', async () => {
    await runCliIfRequested(['--bulk-download', '--db-path=:memory:']);
    expect(vi.mocked(bulkDownloadTsutatsu).mock.calls[0][1]).toMatchObject({ forceReload: false });
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-001 SPEC-NTA-CLI-REFRESH-001 --bulk-download-all --refresh も各通達に forceReload: true を渡す', async () => {
    await runCliIfRequested(['--bulk-download-all', '--refresh', '--db-path=:memory:']);
    const calls = vi.mocked(bulkDownloadTsutatsu).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) expect(c[1]).toMatchObject({ forceReload: true });
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe('--refresh → forceReload: 通達以外の 5 種別 (v0.10.4)', () => {
  // v0.10.2 の修正は bulkDownloadTsutatsu の 3 呼び出しだけで、この 5 経路には
  // forceReload が渡っていなかった。--refresh を付けても 304 で parse がスキップされ、
  // パーサーを直しても DB が更新されない (v0.10.3 の文書回答事例で発覚: 510 件全部 304)
  const cases = [
    ['--bulk-download-bunshokaitou', bulkDownloadBunshokaitou],
    ['--bulk-download-jimu-unei', bulkDownloadJimuUnei],
    ['--bulk-download-tax-answer', bulkDownloadTaxAnswer],
    ['--bulk-download-qa', bulkDownloadQa],
    ['--bulk-download-kaisei', bulkDownloadKaisei],
  ] as const;

  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    for (const [, fn] of cases) vi.mocked(fn).mockClear();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  for (const [flag, fn] of cases) {
    it(`SPEC-NTA-CLI-REFRESH-002 ${flag} --refresh は forceReload: true を渡す`, async () => {
      await runCliIfRequested([flag, '--refresh', '--db-path=:memory:']);
      const calls = vi.mocked(fn).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const c of calls) expect(c[1]).toMatchObject({ forceReload: true });
    });

    it(`SPEC-NTA-CLI-BULK-DOWNLOAD-003 ${flag} だけなら forceReload: false (差分更新)`, async () => {
      await runCliIfRequested([flag, '--db-path=:memory:']);
      const calls = vi.mocked(fn).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const c of calls) expect(c[1]).toMatchObject({ forceReload: false });
    });
  }

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-004 SPEC-NTA-CLI-REFRESH-003 --bulk-download-everything --refresh は 6 種別すべてに forceReload: true を渡す', async () => {
    await runCliIfRequested(['--bulk-download-everything', '--refresh', '--db-path=:memory:']);
    for (const fn of [bulkDownloadTsutatsu, ...cases.map(([, f]) => f)]) {
      const calls = vi.mocked(fn).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const c of calls) expect(c[1]).toMatchObject({ forceReload: true });
    }
  });
});

describe('Issue #25: 税目フラグの値を検証する (v0.14.2)', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const written: string[] = [];

  beforeEach(() => {
    written.length = 0;
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.mocked(bulkDownloadBunshokaitou).mockClear();
    vi.mocked(bulkDownloadQa).mockClear();
    vi.mocked(bulkDownloadTaxAnswer).mockClear();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-008 正しい税目はこれまでどおり渡る', () => {
    const a = parseArgs(['--bunsho-taxonomy=shotoku,hojin']);
    expect(a.bunshoTaxonomies).toEqual(['shotoku', 'hojin']);
    expect(a.invalidTaxonomyValues).toEqual([]);
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-009 --bunsho-taxonomy の国税局の別表記は本庁の表記に直す', () => {
    const a = parseArgs(['--bunsho-taxonomy=souzoku,gensenshotoku,joto_sanrin']);
    expect(a.bunshoTaxonomies).toEqual(['sozoku', 'gensen', 'joto-sanrin']);
    expect(a.invalidTaxonomyValues).toEqual([]);
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-008 --bunsho-taxonomy に一覧に無い値を渡すと invalidTaxonomyValues に入る', () => {
    const a = parseArgs(['--bunsho-taxonomy=zzz']);
    expect(a.bunshoTaxonomies).toEqual([]);
    expect(a.invalidTaxonomyValues).toHaveLength(1);
    expect(a.invalidTaxonomyValues[0]).toMatchObject({ flag: '--bunsho-taxonomy', value: 'zzz' });
    expect(a.invalidTaxonomyValues[0].allowed).toContain('shotoku');
    expect(a.invalidTaxonomyValues[0].aliases).toContain('souzoku');
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-008 --tax-answer-taxonomy と --qa-topic も検証する', () => {
    const a = parseArgs(['--tax-answer-taxonomy=shohi,zzz', '--qa-topic=shohi,ZZZ']);
    expect(a.taxAnswerTaxonomies).toEqual(['shohi']);
    expect(a.qaTopics).toEqual(['shohi']);
    expect(a.invalidTaxonomyValues.map((i) => i.flag)).toEqual([
      '--tax-answer-taxonomy',
      '--qa-topic',
    ]);
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-008 質疑応答事例の税目は --qa-topic の一覧で判定する（文書回答事例の税目は通さない）', () => {
    // zoyo は文書回答事例にはあるが、質疑応答事例には無い
    const a = parseArgs(['--qa-topic=zoyo']);
    expect(a.qaTopics).toEqual([]);
    expect(a.invalidTaxonomyValues).toHaveLength(1);
  });

  // 差分 20261003-db-cli（#106）: 引数の誤りの終了コードは 2（v0.23.x は 1）
  it('SPEC-NTA-CLI-BULK-DOWNLOAD-010 一覧に無い値があると、投入せずに exit code 2 で終わる', async () => {
    const handled = await runCliIfRequested([
      '--bulk-download-bunshokaitou',
      '--bunsho-taxonomy=zzz',
      '--db-path=:memory:',
    ]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(2);
    expect(bulkDownloadBunshokaitou).not.toHaveBeenCalled();
    expect(written.join('')).toContain('--bunsho-taxonomy="zzz" は使えません');
    expect(written.join('')).toContain('shotoku');
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-010 複数指定で 1 つだけ誤っていても投入しない', async () => {
    await runCliIfRequested(['--bulk-download-qa', '--qa-topic=shohi,zzz', '--db-path=:memory:']);
    expect(process.exitCode).toBe(2);
    expect(bulkDownloadQa).not.toHaveBeenCalled();
  });

  // 差分 20261003-db-cli（#106）: --help とほかの引数は一緒に渡すとエラー。値の誤りがあれば値のエラーを先に出す
  it('SPEC-NTA-CLI-ENTRY-005 --help と一覧に無い値は、値のエラーを出して exit code 2（v0.23.x は使い方を出して 0）', async () => {
    const handled = await runCliIfRequested(['--help', '--qa-topic=zzz']);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(2);
    expect(written.join('')).toContain(
      '[houki-nta-mcp] --qa-topic="zzz" は使えません。使える値: shotoku, gensen'
    );
    const help = vi
      .mocked(stdoutSpy)
      .mock.calls.map((c) => String(c[0]))
      .join('');
    expect(help).not.toContain('使い方:');
  });

  it('SPEC-NTA-CLI-ENTRY-002 --help だけなら使える値を表示する', async () => {
    const handled = await runCliIfRequested(['--help']);
    expect(handled).toBe(true);
    expect(process.exitCode).toBeUndefined();
    const help = vi
      .mocked(stdoutSpy)
      .mock.calls.map((c) => String(c[0]))
      .join('');
    expect(help).toContain('--qa-topic の値: shotoku, gensen');
    expect(help).toContain('--bunsho-taxonomy の値: shotoku, gensen, joto-sanrin');
  });

  // 差分 20261003-source-paths（#128）: --tax-answer-taxonomy の一覧は国税庁の索引の税目フォルダ 13 個
  const TAX_ANSWER_FOLDERS = [
    'shotoku',
    'gensen',
    'joto',
    'sozoku',
    'zoyo',
    'hyoka',
    'hojin',
    'shohi',
    'inshi',
    'hotei',
    'fufuku',
    'saigai',
    'osirase',
  ];

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-008 --tax-answer-taxonomy は国税庁の索引の税目フォルダ 13 個を受け付ける（saigai・zoyo・hyoka・hotei・fufuku を足した）', async () => {
    await runCliIfRequested([
      '--bulk-download-tax-answer',
      '--tax-answer-taxonomy=saigai,zoyo,hyoka,hotei,fufuku',
      '--db-path=:memory:',
    ]);
    expect(written.join('')).not.toContain('は使えません');
    expect(bulkDownloadTaxAnswer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bulkDownloadTaxAnswer).mock.calls[0][1]).toMatchObject({
      taxonomies: ['saigai', 'zoyo', 'hyoka', 'hotei', 'fufuku'],
    });
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-008 SPEC-NTA-CLI-BULK-DOWNLOAD-010 --tax-answer-taxonomy=saigai,zzz は zzz だけを使えない値として出し、使える値に 13 個を並べる（v0.23.0 では saigai も使えない値だった）', async () => {
    await runCliIfRequested([
      '--bulk-download-tax-answer',
      '--tax-answer-taxonomy=saigai,zzz',
      '--db-path=:memory:',
    ]);
    const err = written.join('');
    expect(err).toContain('--tax-answer-taxonomy="zzz" は使えません');
    expect(err).not.toContain('--tax-answer-taxonomy="saigai"');
    const allowed = err.match(/使える値: (.+)/)?.[1]?.split(', ') ?? [];
    expect([...allowed].sort()).toEqual([...TAX_ANSWER_FOLDERS].sort());
    expect(bulkDownloadTaxAnswer).not.toHaveBeenCalled();
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-010 formatInvalidTaxonomyValues は 1 件につき 1 行', () => {
    const text = formatInvalidTaxonomyValues([
      { flag: '--qa-topic', value: 'zzz', allowed: ['shohi'], aliases: [] },
      { flag: '--bunsho-taxonomy', value: 'yyy', allowed: ['sozoku'], aliases: ['souzoku'] },
    ]);
    expect(text.trimEnd().split('\n')).toHaveLength(2);
    expect(text).toContain('[houki-nta-mcp] --qa-topic="zzz" は使えません。使える値: shohi');
    expect(text).toContain('（国税局の別表記 souzoku も使えます）');
  });
});

describe('--quickstart: まず数分で試す入口 (Issue #35)', () => {
  // describe 直下で spyOn すると、前の describe が mockRestore した時点で同じ spy が外れ、
  // 出力が記録されない。他の describe と同じく、テストごとに張り直して written に集める
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const stdoutWritten: string[] = [];
  const stderrWritten: string[] = [];

  beforeEach(() => {
    stdoutWritten.length = 0;
    stderrWritten.length = 0;
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutWritten.push(String(chunk));
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWritten.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    vi.mocked(bulkDownloadTsutatsu).mockClear();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-006 parseArgs: 既定は false、--quickstart で true', () => {
    expect(parseArgs([]).quickstart).toBe(false);
    expect(parseArgs(['--quickstart']).quickstart).toBe(true);
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-006 --quickstart は消費税法基本通達 1 本だけを差分更新で投入する', async () => {
    const handled = await runCliIfRequested(['--quickstart', '--db-path=:memory:']);
    expect(handled).toBe(true);
    expect(bulkDownloadTsutatsu).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bulkDownloadTsutatsu).mock.calls[0][1]).toMatchObject({
      formalName: '消費税法基本通達',
      forceReload: false,
    });
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-006 --quickstart --tsutatsu=<正式名> で別の通達 1 本にできる', async () => {
    await runCliIfRequested(['--quickstart', '--tsutatsu=所得税基本通達', '--db-path=:memory:']);
    expect(bulkDownloadTsutatsu).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bulkDownloadTsutatsu).mock.calls[0][1]).toMatchObject({
      formalName: '所得税基本通達',
    });
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-007 --quickstart は実行前と完了後に、所要時間と次の一手を stderr に出す', async () => {
    await runCliIfRequested(['--quickstart', '--db-path=:memory:']);
    const out = stderrWritten.join('');
    expect(out).toContain('約 3〜5 分');
    expect(out).toContain('nta_search_tsutatsu');
    expect(out).toContain('--bulk-download-everything');
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-005 formatBulkEstimates: 6 種別と合計 約 100 分、--quickstart への案内を含む', () => {
    const text = formatBulkEstimates();
    expect(text).toContain('合計 約 100 分');
    expect(text).toContain('--quickstart');
    for (const label of [
      '通達本体',
      '改正通達',
      '事務運営指針',
      '文書回答事例',
      'タックスアンサー',
      '質疑応答事例',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-005 --bulk-download-everything は開始時に目安表を出す', async () => {
    await runCliIfRequested(['--bulk-download-everything', '--db-path=:memory:']);
    const out = stderrWritten.join('');
    expect(out).toContain('合計 約 100 分');
  });

  it('SPEC-NTA-CLI-ENTRY-002 --help に「まず試す」と --quickstart がある', async () => {
    await runCliIfRequested(['--help']);
    const out = stdoutWritten.join('');
    expect(out).toContain('まず試す');
    expect(out).toContain('--quickstart');
    expect(out.indexOf('--quickstart')).toBeLessThan(out.indexOf('--bulk-download-everything'));
  });
});

import { describe, expect, it } from 'vitest';

import {
  classifyDrift,
  computeTaxKey,
  detectBaselineDrift,
  findNewerGenerationSiblings,
} from './baseline-drift.js';
import type { MenuEntry } from './menu-parser.js';

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** menuEntries のミニ DSL */
function entry(url: string, kihonSegments: string[], isMainBody = true): MenuEntry {
  return {
    url,
    label: '',
    isKihon: kihonSegments.length > 0,
    isMainBody,
    kihonSegments,
  };
}

/* -------------------------------------------------------------------------- */
/* computeTaxKey                                                              */
/* -------------------------------------------------------------------------- */

describe('computeTaxKey', () => {
  it('shohi/01.htm → "shohi"', () => {
    expect(computeTaxKey(['shohi', '01.htm'])).toBe('shohi');
  });

  it('shohi/01/04.htm → "shohi" (純粋数字ディレクトリは除外)', () => {
    expect(computeTaxKey(['shohi', '01', '04.htm'])).toBe('shohi');
  });

  it('sisan/sozoku2/01.htm → "sisan/sozoku2"', () => {
    expect(computeTaxKey(['sisan', 'sozoku2', '01.htm'])).toBe('sisan/sozoku2');
  });

  it('hojin/01/01_03.htm → "hojin" (法基通の章/節区切り)', () => {
    expect(computeTaxKey(['hojin', '01', '01_03.htm'])).toBe('hojin');
  });

  it('sisan/sozoku/kaisei/kaisei_a.htm → "sisan/sozoku/kaisei"', () => {
    expect(computeTaxKey(['sisan', 'sozoku', 'kaisei', 'kaisei_a.htm'])).toBe(
      'sisan/sozoku/kaisei'
    );
  });

  it('空配列は null', () => {
    expect(computeTaxKey([])).toBeNull();
  });

  it('数字とファイル名しかない場合は null', () => {
    expect(computeTaxKey(['01', '02.htm'])).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* findNewerGenerationSiblings                                                */
/* -------------------------------------------------------------------------- */

describe('findNewerGenerationSiblings', () => {
  it('数字サフィックス新世代を検出 (sozoku → sozoku2)', () => {
    const result = findNewerGenerationSiblings({
      baselineTaxKey: 'sisan/sozoku',
      menuTaxKeys: new Set(['sisan/sozoku2', 'sisan/hyoka_new', 'shohi']),
    });
    expect(result).toEqual(['sozoku2']);
  });

  it('_new サフィックス新世代を検出 (hyoka → hyoka_new)', () => {
    const result = findNewerGenerationSiblings({
      baselineTaxKey: 'sisan/hyoka',
      menuTaxKeys: new Set(['sisan/hyoka_new', 'sisan/sozoku2']),
    });
    expect(result).toEqual(['hyoka_new']);
  });

  it('複数の新世代があれば全て返す', () => {
    const result = findNewerGenerationSiblings({
      baselineTaxKey: 'sisan/sozoku',
      menuTaxKeys: new Set(['sisan/sozoku2', 'sisan/sozoku3', 'sisan/sozoku_new']),
    });
    expect(result.sort()).toEqual(['sozoku2', 'sozoku3', 'sozoku_new']);
  });

  it('baseline 自身と同名のものは除外', () => {
    const result = findNewerGenerationSiblings({
      baselineTaxKey: 'sisan/sozoku2',
      menuTaxKeys: new Set(['sisan/sozoku2', 'sisan/hyoka_new']),
    });
    expect(result).toEqual([]);
  });

  it('親 prefix が違うものは除外 (shohi vs sisan/sozoku2)', () => {
    const result = findNewerGenerationSiblings({
      baselineTaxKey: 'sisan/sozoku',
      menuTaxKeys: new Set(['shohi2', 'hojin_new']),
    });
    expect(result).toEqual([]);
  });

  it('base 名が違うものは除外 (sozoku vs hyoka_new)', () => {
    const result = findNewerGenerationSiblings({
      baselineTaxKey: 'sisan/sozoku',
      menuTaxKeys: new Set(['sisan/hyoka_new']),
    });
    expect(result).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* classifyDrift                                                              */
/* -------------------------------------------------------------------------- */

describe('classifyDrift', () => {
  const menuEntries: MenuEntry[] = [
    entry('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01.htm', ['shohi', '01.htm']),
    entry('https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/01.htm', ['shotoku', '01.htm']),
    entry('https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01.htm', ['hojin', '01.htm']),
    entry('https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/01.htm', [
      'sisan',
      'sozoku2',
      '01.htm',
    ]),
    entry('https://www.nta.go.jp/law/tsutatsu/kihon/sisan/hyoka_new/01.htm', [
      'sisan',
      'hyoka_new',
      '01.htm',
    ]),
    entry(
      'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei_a.htm',
      ['shohi', 'kaisei', 'kaisei_a.htm'],
      false
    ),
    entry(
      'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku/kaisei/kaisei_a.htm',
      ['sisan', 'sozoku', 'kaisei', 'kaisei_a.htm'],
      false
    ),
  ];

  it('現役本体 (shohi/01/04.htm) は ok 判定', () => {
    const r = classifyDrift({
      doc_type: 'tsutatsu-shohi',
      label: '消基通',
      baselineUrl: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm',
      menuEntries,
    });
    expect(r.status).toBe('ok');
  });

  it('現役の sozoku2 (sisan/sozoku2/01.htm) は ok 判定', () => {
    const r = classifyDrift({
      doc_type: 'tsutatsu-sozoku',
      label: '相基通',
      baselineUrl: 'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/01.htm',
      menuEntries,
    });
    expect(r.status).toBe('ok');
  });

  it('旧 sozoku (sisan/sozoku/01.htm) は missing + newer=sozoku2 を返す', () => {
    const r = classifyDrift({
      doc_type: 'tsutatsu-sozoku-old',
      label: '相基通 (旧)',
      baselineUrl: 'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku/01.htm',
      menuEntries,
    });
    expect(r.status).toBe('missing');
    expect(r.newerGenerations).toEqual(['sozoku2']);
  });

  it('旧 hyoka (sisan/hyoka/01.htm) は missing + newer=hyoka_new を返す', () => {
    const r = classifyDrift({
      doc_type: 'tsutatsu-hyoka-old',
      label: '財産評価 (旧)',
      baselineUrl: 'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/hyoka/01.htm',
      menuEntries,
    });
    expect(r.status).toBe('missing');
    expect(r.newerGenerations).toEqual(['hyoka_new']);
  });

  it('存在しない税目は missing (newer 候補なし)', () => {
    const r = classifyDrift({
      doc_type: 'tsutatsu-bogus',
      label: '存在しない通達',
      baselineUrl: 'https://www.nta.go.jp/law/tsutatsu/kihon/zzz/01.htm',
      menuEntries,
    });
    expect(r.status).toBe('missing');
    expect(r.newerGenerations).toBeUndefined();
  });

  it('改正履歴 (shohi/kaisei/...) も taxKey 一致で ok 判定', () => {
    const r = classifyDrift({
      doc_type: 'kaisei',
      label: '改正通達 索引（消基通）',
      baselineUrl: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei_a.htm',
      menuEntries,
    });
    expect(r.status).toBe('ok');
  });

  it('kihon/ 配下でない baseline は対象外 (ok)', () => {
    const r = classifyDrift({
      doc_type: 'qa-jirei',
      label: '質疑応答事例',
      baselineUrl: 'https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm',
      menuEntries,
    });
    expect(r.status).toBe('ok');
    expect(r.message).toContain('drift 検知対象外');
  });

  it('現役だが新世代併存 → generation-drift (将来 sisan/sozoku2 が menu に出続けたまま sisan/sozoku3 が出た場合)', () => {
    const future: MenuEntry[] = [
      ...menuEntries,
      entry('https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku3/01.htm', [
        'sisan',
        'sozoku3',
        '01.htm',
      ]),
    ];
    const r = classifyDrift({
      doc_type: 'tsutatsu-sozoku',
      label: '相基通 (現 sozoku2)',
      baselineUrl: 'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/01.htm',
      menuEntries: future,
    });
    expect(r.status).toBe('generation-drift');
    expect(r.newerGenerations).toEqual(['sozoku3']);
  });
});

/* -------------------------------------------------------------------------- */
/* detectBaselineDrift (integration with parser, fetch をスキップ)               */
/* -------------------------------------------------------------------------- */

describe('detectBaselineDrift (menuHtml 直接渡し)', () => {
  const SAMPLE_MENU = `
    <html><body>
      <a href="/law/tsutatsu/kihon/shohi/01.htm">消基通</a>
      <a href="/law/tsutatsu/kihon/sisan/sozoku2/01.htm">相続税</a>
      <a href="/law/tsutatsu/kihon/sisan/hyoka_new/01.htm">財産評価 新</a>
    </body></html>
  `;

  it('menuHtml を直接渡せば fetch なしで動作する', async () => {
    const result = await detectBaselineDrift({
      menuHtml: SAMPLE_MENU,
      menuUrl: 'https://www.nta.go.jp/law/tsutatsu/menu.htm',
      targets: [
        {
          doc_type: 'tsutatsu-shohi',
          label: '消基通 第1章 第4節',
          url: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm',
        },
        {
          doc_type: 'tsutatsu-sozoku-old',
          label: '相基通 (旧)',
          url: 'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku/01.htm',
        },
      ],
    });

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.status).toBe('ok');
    expect(result.entries[1]?.status).toBe('missing');
    expect(result.entries[1]?.newerGenerations).toEqual(['sozoku2']);
    expect(result.driftCount).toBe(1);
  });
});

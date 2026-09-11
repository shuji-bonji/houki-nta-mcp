/**
 * Issue #22 (v0.12.0): 質疑応答事例の【関係法令通達】欄の分解。
 * 入力は houki-nta-mcp のローカル DB の質疑応答事例（2026-09-11）に実在する書き方。
 */
import { describe, expect, it } from 'vitest';
import { parseRelatedReferences } from './related-law-parser.js';

const laws = (p: string[]) =>
  parseRelatedReferences(p).related_laws.map(({ raw: _raw, ...rest }) => rest);
const tsutatsu = (p: string[]) =>
  parseRelatedReferences(p).related_tsutatsu.map(({ raw: _raw, ...rest }) => rest);

describe('parseRelatedReferences — 法令', () => {
  it('法令名 + 条・項・号（shohi/02/19）', () => {
    expect(laws(['消費税法第2条第1項第8号、消費税法基本通達5-1-1'])).toEqual([
      { law_name: '消費税法', article: '2', paragraph: 1, item: 8 },
    ]);
  });

  it('「、第N条」は直前の法令の条（shotoku/02/01）', () => {
    expect(laws(['所得税法第27条、第34条、第37条、所得税基本通達34-1(4)'])).toEqual([
      { law_name: '所得税法', article: '27' },
      { law_name: '所得税法', article: '34' },
      { law_name: '所得税法', article: '37' },
    ]);
  });

  it('「、第N項」は直前の条の項、「の」付きの条（sozoku/18/34）', () => {
    expect(laws(['租税特別措置法第70条の6第1項、第9項'])).toEqual([
      { law_name: '租税特別措置法', article: '70の6', paragraph: 1 },
      { law_name: '租税特別措置法', article: '70の6', paragraph: 9 },
    ]);
  });

  it('「、第N号」は直前の条・項の号（shohi/13/01）', () => {
    expect(laws(['消費税法第2条第1項第8号、第12号'])).toEqual([
      { law_name: '消費税法', article: '2', paragraph: 1, item: 8 },
      { law_name: '消費税法', article: '2', paragraph: 1, item: 12 },
    ]);
  });

  it('枝番号の号（「第12号の8」）は item に入れない（hojin/33/56）', () => {
    expect(laws(['法人税法第2条第12号の8ハ'])).toEqual([{ law_name: '法人税法', article: '2' }]);
  });

  it('別表は appendix に入れる（shohi/10/05）', () => {
    expect(laws(['消費税法別表第二第7号ハ、消費税法施行令第14条の3第1号'])).toEqual([
      { law_name: '消費税法', appendix: '別表第二第7号ハ' },
      { law_name: '消費税法施行令', article: '14の3', item: 1 },
    ]);
  });

  it('全角数字は半角にして読む', () => {
    expect(laws(['所得税法第３３条第１項'])).toEqual([
      { law_name: '所得税法', article: '33', paragraph: 1 },
    ]);
  });

  it('箇条書きの番号は法令名に含めない', () => {
    expect(laws(['1 相続税法第23条'])).toEqual([{ law_name: '相続税法', article: '23' }]);
  });

  it('条約も法令として読む（案内の要否は呼び出し側で決める）', () => {
    expect(laws(['日・ハンガリー租税条約第12条第2項(b)'])).toEqual([
      { law_name: '日・ハンガリー租税条約', article: '12', paragraph: 2 },
    ]);
  });
});

describe('parseRelatedReferences — 通達', () => {
  it('通達名 + 番号、「、N-N」は直前の通達の番号（gensen/01/02）', () => {
    expect(tsutatsu(['所得税法施行令第14条、第15条、所得税基本通達2-1、3-3'])).toEqual([
      { name: '所得税基本通達', clause: '2-1' },
      { name: '所得税基本通達', clause: '3-3' },
    ]);
  });

  it('括弧書きの編名を通達名に含める（hojin/08/07）', () => {
    expect(tsutatsu(['租税特別措置法関係通達（法人税編）65の7(1)-22'])).toEqual([
      { name: '租税特別措置法関係通達（法人税編）', clause: '65の7(1)-22' },
    ]);
  });

  it('番号だけの通達（財産評価基本通達）の続き（hyoka/08/05）', () => {
    expect(tsutatsu(['財産評価基本通達5、185、186'])).toEqual([
      { name: '財産評価基本通達', clause: '5' },
      { name: '財産評価基本通達', clause: '185' },
      { name: '財産評価基本通達', clause: '186' },
    ]);
  });

  it('区切りが抜けた「…第3項消費税法基本通達…」は法令と通達に分ける', () => {
    const r = parseRelatedReferences(['消費税法施行令第45条第3項消費税法基本通達15-2-1']);
    expect(r.related_laws.map((l) => [l.law_name, l.article, l.paragraph])).toEqual([
      ['消費税法施行令', '45', 3],
    ]);
    expect(r.related_tsutatsu.map((t) => [t.name, t.clause])).toEqual([
      ['消費税法基本通達', '15-2-1'],
    ]);
  });
});

describe('parseRelatedReferences — 読み取らないもの', () => {
  it('告示・説明文・［参考］は unparsed に残し、推測で法令にしない', () => {
    const r = parseRelatedReferences([
      '平成17年厚生労働省告示第128号「消費税法施行令第14条の3第1号の規定に基づき…」',
      '［参考］',
      'マンション管理組合に関する税務上の取扱いについては、本質疑応答事例のほか',
    ]);
    expect(r.related_laws).toEqual([]);
    expect(r.related_tsutatsu).toEqual([]);
    expect(r.unparsed.length).toBeGreaterThan(0);
  });

  it('読み取れない要素の後ろの「第N条」は、法令名が分からないので読まない', () => {
    const r = parseRelatedReferences(['令和7年改正法附則第22条、第52条']);
    expect(r.related_laws).toEqual([]);
    expect(r.unparsed).toEqual(['令和7年改正法附則第22条', '第52条']);
  });

  it('raw には元の要素が入る', () => {
    const r = parseRelatedReferences(['所得税法第27条、第34条']);
    expect(r.related_laws.map((l) => l.raw)).toEqual(['所得税法第27条', '第34条']);
  });
});

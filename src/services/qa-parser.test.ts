/**
 * Issue #22 (v0.12.0): 質疑応答事例ページの「注記」を関係法令から分ける
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseQaJirei } from './qa-parser.js';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../../tests/fixtures', name), 'utf8');

describe('parseQaJirei — Issue #22: 注記を relatedLaws から分ける', () => {
  it('shohi/02/19: relatedLaws は関係法令だけ、注記は notice と basisDate', () => {
    const qa = parseQaJirei({
      html: fixture('www.nta.go.jp_law_shitsugi_shohi_02_19.htm'),
      sourceUrl: 'https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm',
      topic: 'shohi',
      category: '02',
      id: '19',
    });
    expect(qa.relatedLaws).toEqual(['消費税法第2条第1項第8号、消費税法基本通達5-1-1']);
    expect(qa.notice).toContain('令和7年8月1日現在の法令・通達等に基づいて作成しています');
    expect(qa.notice).toContain('異なる課税関係が生ずることがある');
    expect(qa.notice?.startsWith('注記')).toBe(false);
    expect(qa.basisDate).toBe('2025-08-01');
  });

  it('【関係法令通達】が無いページでは、【回答要旨】の後ろの注記を分ける', () => {
    const html = `<html><body><div class="imp-cnt-tsutatsu" id="bodyArea">
      <h1>テスト事例</h1>
      <h2>【照会要旨】</h2><p>照会の本文</p>
      <h2>【回答要旨】</h2><p>回答の本文</p>
      <p class="red"><strong>注記<br>令和7年8月1日現在の法令・通達等に基づいて作成しています。</strong></p>
    </div></body></html>`;
    const qa = parseQaJirei({
      html,
      sourceUrl: 'https://www.nta.go.jp/law/shitsugi/sozoku/03/05.htm',
      topic: 'sozoku',
      category: '03',
      id: '05',
    });
    expect(qa.answer).toEqual(['回答の本文']);
    expect(qa.relatedLaws).toEqual([]);
    expect(qa.notice).toBe('令和7年8月1日現在の法令・通達等に基づいて作成しています。');
    expect(qa.basisDate).toBe('2025-08-01');
  });

  it('注記が無いページでは notice / basisDate を付けない', () => {
    const html = `<html><body><div class="imp-cnt-tsutatsu" id="bodyArea">
      <h1>テスト</h1><h2>【照会要旨】</h2><p>Q</p><h2>【回答要旨】</h2><p>A</p>
      <h2>【関係法令通達】</h2><p>所得税法第36条</p></div></body></html>`;
    const qa = parseQaJirei({
      html,
      sourceUrl: 'https://x/',
      topic: 'shotoku',
      category: '01',
      id: '01',
    });
    expect(qa.relatedLaws).toEqual(['所得税法第36条']);
    expect(qa.notice).toBeUndefined();
    expect(qa.basisDate).toBeUndefined();
  });
});

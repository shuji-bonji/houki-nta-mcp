import { describe, expect, it } from 'vitest';

import {
  ALL_PDF_KINDS,
  extractPdfKind,
  PDF_KIND_EMOJI,
  PDF_KIND_LABEL,
  type PdfKind,
} from './pdf-meta.js';

describe('extractPdfKind', () => {
  describe('comparison (新旧対照表)', () => {
    it.each([
      ['新旧対照表'],
      ['新旧対照表（PDF/470KB）'],
      ['消費税法基本通達 新旧対照表'],
      ['対比表'],
      ['新旧対比表'],
    ])('classifies "%s" as comparison', (title) => {
      expect(extractPdfKind(title)).toBe('comparison');
    });
  });

  describe('qa-pdf (Q&A)', () => {
    it.each([
      ['Q&A'],
      ['インボイス Q&A'],
      ['Q & A'], // スペースあり
      ['Ｑ&Ａ'], // 全角
      ['消費税の質疑応答'],
      ['FAQ'],
      ['ＦＡＱ'], // 全角
    ])('classifies "%s" as qa-pdf', (title) => {
      expect(extractPdfKind(title)).toBe('qa-pdf');
    });
  });

  describe('attachment (別紙・別表・様式)', () => {
    it.each([
      ['別紙'],
      ['別紙1 計算明細書'],
      ['別表'],
      ['別表第1'],
      ['様式'],
      ['申告書様式'],
      ['付録'],
      ['付録A'],
      ['添付資料'],
    ])('classifies "%s" as attachment', (title) => {
      expect(extractPdfKind(title)).toBe('attachment');
    });
  });

  describe('notice (通知・お知らせ・連絡)', () => {
    it.each([
      ['通知'],
      ['改正通達の取扱いについて（通知）'],
      ['お知らせ'],
      ['重要なお知らせ'],
      ['連絡'],
    ])('classifies "%s" as notice', (title) => {
      expect(extractPdfKind(title)).toBe('notice');
    });
  });

  describe('related (参考資料・関連資料)', () => {
    it.each([['参考資料'], ['参考'], ['関連資料']])('classifies "%s" as related', (title) => {
      expect(extractPdfKind(title)).toBe('related');
    });
  });

  describe('unknown (フォールバック)', () => {
    it.each([
      [''],
      ['PDF'],
      ['資料'],
      ['資料1'], // 「参考」がないので unknown
      ['消費税.pdf'],
      ['全文'],
    ])('classifies "%s" as unknown', (title) => {
      expect(extractPdfKind(title)).toBe('unknown');
    });
  });

  describe('優先順位', () => {
    it('comparison が attachment より優先される', () => {
      // 「新旧対照表別紙」のようなケースは comparison 優先
      expect(extractPdfKind('新旧対照表別紙')).toBe('comparison');
    });

    it('qa-pdf が attachment より優先される', () => {
      // 「Q&A 別紙」のようなケースは qa-pdf 優先
      expect(extractPdfKind('Q&A 別紙')).toBe('qa-pdf');
    });

    it('attachment が notice より優先される', () => {
      // 「別紙の通知」は attachment が先にマッチ
      expect(extractPdfKind('別紙の通知')).toBe('attachment');
    });
  });

  describe('Normalize-everywhere 対応', () => {
    it('全角英数を含むタイトルも分類できる', () => {
      expect(extractPdfKind('Ｑ＆Ａ')).toBe('qa-pdf');
    });

    it('全角スペースを含むタイトルも分類できる', () => {
      expect(extractPdfKind('新旧 対照表')).toBe('comparison'); // 全角空白
    });

    it('null / undefined / 空文字列を安全に扱う', () => {
      expect(extractPdfKind('')).toBe('unknown');
      // @ts-expect-error: null チェック
      expect(extractPdfKind(null)).toBe('unknown');
      // @ts-expect-error: undefined チェック
      expect(extractPdfKind(undefined)).toBe('unknown');
    });
  });
});

describe('PDF_KIND_EMOJI / PDF_KIND_LABEL', () => {
  it('全 6 kind に絵文字が定義されている', () => {
    for (const kind of ALL_PDF_KINDS) {
      expect(PDF_KIND_EMOJI[kind]).toBeDefined();
      expect(PDF_KIND_EMOJI[kind].length).toBeGreaterThan(0);
    }
  });

  it('全 6 kind にラベルが定義されている', () => {
    for (const kind of ALL_PDF_KINDS) {
      expect(PDF_KIND_LABEL[kind]).toBeDefined();
      expect(PDF_KIND_LABEL[kind].length).toBeGreaterThan(0);
    }
  });
});

describe('ALL_PDF_KINDS', () => {
  it('全 6 kind を含む', () => {
    expect(ALL_PDF_KINDS).toEqual([
      'comparison',
      'attachment',
      'qa-pdf',
      'related',
      'notice',
      'unknown',
    ]);
  });

  it('TypeScript の型と整合する', () => {
    const k: PdfKind = ALL_PDF_KINDS[0];
    expect(k).toBe('comparison');
  });
});

import { describe, expect, it } from 'vitest';

import {
  ALL_PDF_KINDS,
  buildReaderHintExamples,
  extractPdfKind,
  fillMissingKinds,
  PDF_KIND_EMOJI,
  PDF_KIND_LABEL,
  renderAttachedPdfsMarkdown,
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
      // 「対照」と「対応」の両表記を吸収する（v0.7.2 で追加）。
      // 例: 国税庁 kaisei /shohi/kaisei/pdf/b0025003-111.pdf
      ['新旧対応表'],
      ['【参考】令和８年11月１日から適用される「消費税法基本通達（第８章）」の構成及び新旧対応表'],
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

describe('renderAttachedPdfsMarkdown', () => {
  it('空配列なら空配列を返す', () => {
    expect(renderAttachedPdfsMarkdown([])).toEqual([]);
  });

  it('1 件の comparison: ヘッダ + 表 + 呼び出し例を返す', () => {
    const out = renderAttachedPdfsMarkdown([
      { title: '新旧対照表', url: 'https://x/a.pdf', sizeKb: 470, kind: 'comparison' },
    ]);
    const md = out.join('\n');
    expect(md).toContain('## 添付 PDF (1 件)');
    expect(md).toContain('`pdf-reader-mcp` の `read_text`');
    expect(md).toContain('| 種別 | タイトル | サイズ | URL |');
    expect(md).toContain('🔄 新旧対照表');
    expect(md).toContain('470KB');
    expect(md).toContain('[link](https://x/a.pdf)');
    expect(md).toContain('### pdf-reader-mcp 呼び出し例');
    expect(md).toContain('```json');
    expect(md).toContain('// 新旧対照表を読む');
    expect(md).toContain('"url": "https://x/a.pdf"');
  });

  it('kind 優先度でソートされる: comparison → attachment → unknown', () => {
    const out = renderAttachedPdfsMarkdown([
      { title: '別紙', url: 'https://x/b.pdf', kind: 'attachment' },
      { title: 'その他', url: 'https://x/c.pdf', kind: 'unknown' },
      { title: '新旧対照表', url: 'https://x/a.pdf', kind: 'comparison' },
    ]);
    const md = out.join('\n');
    // 表の中で comparison が一番先に登場、unknown が一番後
    const compIdx = md.indexOf('🔄 新旧対照表');
    const attIdx = md.indexOf('📎 別紙');
    const unkIdx = md.indexOf('📄 その他');
    expect(compIdx).toBeGreaterThan(0);
    expect(compIdx).toBeLessThan(attIdx);
    expect(attIdx).toBeLessThan(unkIdx);
    // 呼び出し例は先頭（comparison）の URL
    expect(md).toContain('"url": "https://x/a.pdf"');
  });

  it('kind 未指定（v0.6.0 以前のレコード）は unknown として描画される', () => {
    const out = renderAttachedPdfsMarkdown([{ title: '何か', url: 'https://x/q.pdf' }]);
    const md = out.join('\n');
    expect(md).toContain('📄 その他');
    expect(md).toContain('// この PDF を読む');
  });

  it('sizeKb が無い場合はダッシュ表記', () => {
    const out = renderAttachedPdfsMarkdown([
      { title: '別紙', url: 'https://x/n.pdf', kind: 'attachment' },
    ]);
    expect(out.join('\n')).toMatch(/\|\s*—\s*\|/);
  });

  it('タイトル内のパイプ文字はエスケープされる', () => {
    const out = renderAttachedPdfsMarkdown([
      { title: 'A|B', url: 'https://x/p.pdf', kind: 'attachment' },
    ]);
    expect(out.join('\n')).toContain('A\\|B');
  });

  it('件数表示が正しい', () => {
    const pdfs = Array.from({ length: 5 }, (_, i) => ({
      title: `別紙${i}`,
      url: `https://x/${i}.pdf`,
      kind: 'attachment' as PdfKind,
    }));
    expect(renderAttachedPdfsMarkdown(pdfs)[0]).toBe('## 添付 PDF (5 件)');
  });

  it('comparison PDF は extract_tables 呼び出し例を出力する (v0.7.2)', () => {
    const out = renderAttachedPdfsMarkdown([
      { title: '新旧対照表', url: 'https://x/c.pdf', kind: 'comparison' },
    ]);
    const md = out.join('\n');
    expect(md).toContain('"tool": "extract_tables"');
    expect(md).toContain('"url": "https://x/c.pdf"');
  });

  it('attachment PDF も extract_tables を推奨する (v0.7.2)', () => {
    const out = renderAttachedPdfsMarkdown([
      { title: '別紙1', url: 'https://x/a.pdf', kind: 'attachment' },
    ]);
    expect(out.join('\n')).toContain('"tool": "extract_tables"');
  });

  it('qa-pdf / related / notice / unknown は read_text を出す (v0.7.2)', () => {
    for (const kind of ['qa-pdf', 'related', 'notice', 'unknown'] as const) {
      const out = renderAttachedPdfsMarkdown([{ title: kind, url: `https://x/${kind}.pdf`, kind }]);
      const md = out.join('\n');
      expect(md).toContain('"tool": "read_text"');
      expect(md).not.toContain('"tool": "extract_tables"');
    }
  });

  it('複数 kind が混在すると kind 別に複数の呼び出し例を出す (v0.7.2)', () => {
    const out = renderAttachedPdfsMarkdown([
      { title: '新旧対照表', url: 'https://x/c.pdf', kind: 'comparison' },
      { title: '別紙', url: 'https://x/a.pdf', kind: 'attachment' },
      { title: '参考', url: 'https://x/r.pdf', kind: 'related' },
    ]);
    const md = out.join('\n');
    // comparison / attachment は extract_tables、related は read_text
    expect(md.match(/"tool": "extract_tables"/g) ?? []).toHaveLength(2);
    expect(md.match(/"tool": "read_text"/g) ?? []).toHaveLength(1);
    // comparison が先頭
    expect(md.indexOf('https://x/c.pdf')).toBeLessThan(md.indexOf('https://x/a.pdf'));
    expect(md.indexOf('https://x/a.pdf')).toBeLessThan(md.indexOf('https://x/r.pdf'));
  });
});

describe('buildReaderHintExamples (v0.7.2)', () => {
  it('空配列なら空配列を返す', () => {
    expect(buildReaderHintExamples([])).toEqual([]);
  });

  it('comparison / attachment は extract_tables、それ以外は read_text', () => {
    const examples = buildReaderHintExamples([
      { title: '新旧対照表', url: 'https://x/c.pdf', kind: 'comparison' },
      { title: '別紙', url: 'https://x/a.pdf', kind: 'attachment' },
      { title: 'Q&A', url: 'https://x/q.pdf', kind: 'qa-pdf' },
      { title: '参考', url: 'https://x/r.pdf', kind: 'related' },
      { title: '通知', url: 'https://x/n.pdf', kind: 'notice' },
    ]);
    expect(examples.map((e) => e.tool)).toEqual([
      'extract_tables', // comparison
      'extract_tables', // attachment
      'read_text', // qa-pdf
      'read_text', // related
      'read_text', // notice
    ]);
  });

  it('kind 未指定の PDF はタイトルから動的に推定される', () => {
    // kind フィールドなしの input
    const examples = buildReaderHintExamples([
      { title: '新旧対応表（PDF/399KB）', url: 'https://x/c.pdf' },
    ]);
    expect(examples).toHaveLength(1);
    expect(examples[0].kind).toBe('comparison');
    expect(examples[0].tool).toBe('extract_tables');
  });

  it('同 kind 内では最初に出現した PDF が代表例になる', () => {
    const examples = buildReaderHintExamples([
      { title: '別紙1', url: 'https://x/a1.pdf', kind: 'attachment' },
      { title: '別紙2', url: 'https://x/a2.pdf', kind: 'attachment' },
    ]);
    expect(examples).toHaveLength(1);
    expect(examples[0].args.url).toBe('https://x/a1.pdf');
  });

  it('出力は kind 優先度順 (comparison が先頭)', () => {
    const examples = buildReaderHintExamples([
      { title: '通知', url: 'https://x/n.pdf', kind: 'notice' },
      { title: '新旧対照表', url: 'https://x/c.pdf', kind: 'comparison' },
      { title: '別紙', url: 'https://x/a.pdf', kind: 'attachment' },
    ]);
    expect(examples.map((e) => e.kind)).toEqual(['comparison', 'attachment', 'notice']);
  });
});

describe('fillMissingKinds (v0.7.2)', () => {
  it('kind 未指定の PDF はタイトルから推定して補完する', () => {
    const filled = fillMissingKinds([
      { title: '新旧対応表', url: 'https://x/c.pdf' },
      { title: '別紙1', url: 'https://x/a.pdf' },
      { title: 'よくわからない資料', url: 'https://x/u.pdf' },
    ]);
    expect(filled[0].kind).toBe('comparison');
    expect(filled[1].kind).toBe('attachment');
    expect(filled[2].kind).toBe('unknown');
  });

  it('既に kind が設定されているレコードは触らない', () => {
    const filled = fillMissingKinds([
      // タイトルは notice にマッチしうるが、kind=related が既設定なら維持
      { title: '通知', url: 'https://x/p.pdf', kind: 'related' },
    ]);
    expect(filled[0].kind).toBe('related');
  });

  it('入力配列はミューテートしない (純関数)', () => {
    const input: { title: string; url: string; kind?: PdfKind }[] = [
      { title: '新旧対照表', url: 'https://x/c.pdf' },
    ];
    const out = fillMissingKinds(input);
    expect(input[0].kind).toBeUndefined();
    expect(out[0].kind).toBe('comparison');
  });
});

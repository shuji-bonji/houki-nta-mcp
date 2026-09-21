import { describe, expect, it } from 'vitest';

import {
  ALL_PDF_KINDS,
  buildPdfNextActions,
  describePdfReading,
  extractPdfKind,
  fillMissingKinds,
  isBareAppendixTitle,
  PDF_KIND_EMOJI,
  PDF_KIND_LABEL,
  type PdfKind,
  refinePdfKindsForDoc,
  renderAttachedPdfsMarkdown,
  withPdfReading,
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
    expect(md).toContain('houki-nta-mcp は PDF の本文を読みません');
    expect(md).toContain('| 種別 | タイトル | サイズ | 読み方 | URL |');
    expect(md).toContain('🔄 新旧対照表');
    expect(md).toContain('470KB');
    expect(md).toContain('| 表として取る |');
    expect(md).toContain('[link](https://x/a.pdf)');
    expect(md).toContain('### 読み方');
    expect(md).toContain('- 新旧対照表: 改正後と改正前を左右 2 列に並べた表');
    expect(md).not.toContain('```json');
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
  });

  it('kind 未指定（v0.6.0 以前のレコード）は unknown として描画される', () => {
    const out = renderAttachedPdfsMarkdown([{ title: '何か', url: 'https://x/q.pdf' }]);
    const md = out.join('\n');
    expect(md).toContain('📄 その他');
    expect(md).toContain('| 先頭を見て決める |');
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

  it('読み方の節は kind ごとに 1 行、kind 優先度順 (v0.19.0)', () => {
    const out = renderAttachedPdfsMarkdown([
      { title: '参考', url: 'https://x/r.pdf', kind: 'related' },
      { title: '新旧対照表', url: 'https://x/c.pdf', kind: 'comparison' },
      { title: '別紙1', url: 'https://x/a1.pdf', kind: 'attachment' },
      { title: '別紙2', url: 'https://x/a2.pdf', kind: 'attachment' },
    ]);
    const md = out.join('\n');
    const section = md.slice(md.indexOf('### 読み方'));
    const bullets = section.split('\n').filter((l) => l.startsWith('- '));
    expect(bullets.map((l) => l.slice(2, l.indexOf(':')))).toEqual([
      '新旧対照表',
      '別紙・別表',
      '参考資料',
    ]);
  });
});

describe('describePdfReading / withPdfReading (v0.19.0)', () => {
  it('comparison / attachment は tables、qa-pdf / related / notice は text、unknown は sample', () => {
    expect(ALL_PDF_KINDS.map((k) => describePdfReading(k).read_strategy)).toEqual([
      'tables',
      'tables',
      'text',
      'text',
      'text',
      'sample',
    ]);
  });

  it('layout_note は道具の名前を含まない', () => {
    for (const kind of ALL_PDF_KINDS) {
      const note = describePdfReading(kind).layout_note;
      expect(note).not.toMatch(/pdf-reader|extract_tables|read_text|read_url/);
      expect(note.length).toBeGreaterThan(10);
    }
  });

  it('withPdfReading は kind を補い read_strategy / layout_note を付ける（入力は変えない）', () => {
    const input = [{ title: '新旧対応表', url: 'https://x/c.pdf' }];
    const out = withPdfReading(input);
    expect(out[0]).toMatchObject({ kind: 'comparison', read_strategy: 'tables' });
    expect(out[0].layout_note).toContain('改正後');
    expect(input[0]).toEqual({ title: '新旧対応表', url: 'https://x/c.pdf' });
  });
});

describe('buildPdfNextActions (v0.19.0)', () => {
  it('空配列なら空配列を返す', () => {
    expect(buildPdfNextActions([])).toEqual([]);
  });

  it('未保存: kind ごとに read_url 1 件 + 汎用 read_pdf。comparison だけ split_columns: 2', () => {
    const actions = buildPdfNextActions([
      { title: '新旧対照表', url: 'https://x/c.pdf', kind: 'comparison' },
      { title: '別紙', url: 'https://x/a.pdf', kind: 'attachment' },
      { title: 'Q&A', url: 'https://x/q.pdf', kind: 'qa-pdf' },
      { title: '資料', url: 'https://x/u.pdf', kind: 'unknown' },
    ]);
    expect(actions.map((a) => a.action)).toEqual([
      'pdf-reader-mcp:read_url',
      'pdf-reader-mcp:read_url',
      'pdf-reader-mcp:read_url',
      'pdf-reader-mcp:read_url',
      'read_pdf',
    ]);
    expect(actions[0].example).toEqual({ url: 'https://x/c.pdf', split_columns: 2 });
    expect(actions[0].reason).toContain('save: true');
    expect(actions[1].example).toEqual({ url: 'https://x/a.pdf' });
    expect(actions[2].example).toEqual({ url: 'https://x/q.pdf' });
    expect(actions[3].example).toEqual({ url: 'https://x/u.pdf', pages: '1' });
    expect(actions[4].example).toEqual({ url: 'https://x/c.pdf' });
  });

  it('保存済み: tables → extract_tables、text → read_text、sample → summarize（file_path）', () => {
    const saved = new Map([
      ['https://x/c.pdf', '/files/c.pdf'],
      ['https://x/q.pdf', '/files/q.pdf'],
      ['https://x/u.pdf', '/files/u.pdf'],
    ]);
    const actions = buildPdfNextActions(
      [
        { title: '新旧対照表', url: 'https://x/c.pdf', kind: 'comparison' },
        { title: 'Q&A', url: 'https://x/q.pdf', kind: 'qa-pdf' },
        { title: '資料', url: 'https://x/u.pdf', kind: 'unknown' },
      ],
      saved
    );
    expect(actions.map((a) => [a.action, a.example])).toEqual([
      ['pdf-reader-mcp:extract_tables', { file_path: '/files/c.pdf' }],
      ['pdf-reader-mcp:read_text', { file_path: '/files/q.pdf' }],
      ['pdf-reader-mcp:summarize', { file_path: '/files/u.pdf' }],
      ['read_pdf', { url: 'https://x/c.pdf', path: '/files/c.pdf' }],
    ]);
  });

  it('保存に失敗した PDF は URL の経路のまま（保存済みと混在できる）', () => {
    const actions = buildPdfNextActions(
      [
        { title: '新旧対照表', url: 'https://x/c.pdf', kind: 'comparison' },
        { title: '別紙', url: 'https://x/a.pdf', kind: 'attachment' },
      ],
      new Map([['https://x/c.pdf', '/files/c.pdf']])
    );
    expect(actions[0].action).toBe('pdf-reader-mcp:extract_tables');
    expect(actions[1].action).toBe('pdf-reader-mcp:read_url');
  });

  it('kind 未指定の PDF はタイトルから推定される', () => {
    const actions = buildPdfNextActions([
      { title: '新旧対応表（PDF/399KB）', url: 'https://x/c.pdf' },
    ]);
    expect(actions[0].example).toEqual({ url: 'https://x/c.pdf', split_columns: 2 });
  });

  it('同 kind 内では最初に出現した PDF が代表になり、出力は kind 優先度順', () => {
    const actions = buildPdfNextActions([
      { title: '通知', url: 'https://x/n.pdf', kind: 'notice' },
      { title: '別紙1', url: 'https://x/a1.pdf', kind: 'attachment' },
      { title: '別紙2', url: 'https://x/a2.pdf', kind: 'attachment' },
      { title: '新旧対照表', url: 'https://x/c.pdf', kind: 'comparison' },
    ]);
    expect(actions.map((a) => a.example?.url)).toEqual([
      'https://x/c.pdf',
      'https://x/a1.pdf',
      'https://x/n.pdf',
      'https://x/c.pdf',
    ]);
  });

  it('example に mcp / tool を入れない', () => {
    const actions = buildPdfNextActions(
      [{ title: '新旧対照表', url: 'https://x/c.pdf', kind: 'comparison' }],
      new Map([['https://x/c.pdf', '/files/c.pdf']])
    );
    for (const a of actions) {
      expect(a.example).not.toHaveProperty('mcp');
      expect(a.example).not.toHaveProperty('tool');
    }
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

describe('isBareAppendixTitle / refinePdfKindsForDoc (#44, v0.20.0)', () => {
  it('「別紙」と番号（とサイズ）だけのタイトルを見分ける', () => {
    for (const t of [
      '別紙',
      '別紙1',
      '別紙１',
      '別紙 １',
      '（別紙2）',
      '別紙1（PDF/221KB）',
      '別紙２(PDFファイル/76KB)',
      '別紙1-2',
    ]) {
      expect(isBareAppendixTitle(t), t).toBe(true);
    }
    for (const t of [
      '',
      '別紙1 計算明細書',
      '別紙 新旧対照表',
      '別表1',
      '新旧対照表（別紙）',
      '様式',
    ]) {
      expect(isBareAppendixTitle(t), t).toBe(false);
    }
  });

  it('kaisei では「別紙 N」だけの attachment を comparison にし、他は変えない', () => {
    const pdfs = [
      { title: '別紙1（PDF/221KB）', url: 'https://x/01.pdf', kind: 'attachment' as const },
      { title: '別紙2 様式', url: 'https://x/02.pdf', kind: 'attachment' as const },
      { title: '参考資料', url: 'https://x/03.pdf', kind: 'related' as const },
      { title: '別紙3', url: 'https://x/04.pdf' }, // kind なし（v0.6.0 期）
    ];
    const out = refinePdfKindsForDoc(pdfs, 'kaisei');
    expect(out.map((p) => p.kind)).toEqual(['comparison', 'attachment', 'related', 'comparison']);
    // 入力は変えない
    expect(pdfs[0].kind).toBe('attachment');
    expect(pdfs[3].kind).toBeUndefined();
  });

  it('kaisei 以外の docType では何も変えない', () => {
    const pdfs = [{ title: '別紙1', url: 'https://x/01.pdf', kind: 'attachment' as const }];
    for (const docType of ['jimu-unei', 'bunshokaitou', 'tax-answer']) {
      expect(refinePdfKindsForDoc(pdfs, docType).map((p) => p.kind)).toEqual(['attachment']);
    }
  });

  it('comparison の layout_note に丸括弧と墨付き括弧の両方の記号がある', () => {
    const note = describePdfReading('comparison').layout_note;
    for (const sym of [
      '（同左）',
      '（省略）',
      '（新設）',
      '（削除）',
      '【新設】',
      '【削除】',
      '【一部改正】',
    ]) {
      expect(note).toContain(sym);
    }
  });
});

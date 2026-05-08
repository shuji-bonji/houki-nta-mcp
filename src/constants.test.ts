/**
 * Tests for src/constants.ts
 *
 * v0.9.1 (Issue #1, #2): docType 別 legal_status 一元化の検証
 */

import { describe, expect, it } from 'vitest';
import {
  BUNSHOKAITOU_LEGAL_STATUS,
  LEGAL_STATUS_BY_DOCTYPE,
  NTA_GENERAL_INFO_LEGAL_STATUS,
  TSUTATSU_LEGAL_STATUS,
} from './constants.js';

describe('LEGAL_STATUS_BY_DOCTYPE — docType 別の legal_status (Issue #1)', () => {
  it('5 つの document docType すべてが定義されている', () => {
    expect(LEGAL_STATUS_BY_DOCTYPE.kaisei).toBeDefined();
    expect(LEGAL_STATUS_BY_DOCTYPE['jimu-unei']).toBeDefined();
    expect(LEGAL_STATUS_BY_DOCTYPE.bunshokaitou).toBeDefined();
    expect(LEGAL_STATUS_BY_DOCTYPE['tax-answer']).toBeDefined();
    expect(LEGAL_STATUS_BY_DOCTYPE['qa-jirei']).toBeDefined();
  });

  it('kaisei / jimu-unei は通達系 (binds_tax_office: true)', () => {
    expect(LEGAL_STATUS_BY_DOCTYPE.kaisei.binds_tax_office).toBe(true);
    expect(LEGAL_STATUS_BY_DOCTYPE['jimu-unei'].binds_tax_office).toBe(true);
    expect(LEGAL_STATUS_BY_DOCTYPE.kaisei.note).toContain('通達');
    expect(LEGAL_STATUS_BY_DOCTYPE['jimu-unei'].note).toContain('通達');
  });

  it('bunshokaitou は文書回答事例固有 (binds_tax_office: false + 専用文言)', () => {
    expect(LEGAL_STATUS_BY_DOCTYPE.bunshokaitou.binds_tax_office).toBe(false);
    expect(LEGAL_STATUS_BY_DOCTYPE.bunshokaitou.binds_citizens).toBe(false);
    expect(LEGAL_STATUS_BY_DOCTYPE.bunshokaitou.binds_courts).toBe(false);
    // Issue #2: note に「文書回答事例」を含む
    expect(LEGAL_STATUS_BY_DOCTYPE.bunshokaitou.note).toContain('文書回答事例');
    // タックスアンサー文言 (NTA_GENERAL_INFO_LEGAL_STATUS) を再利用していない
    expect(LEGAL_STATUS_BY_DOCTYPE.bunshokaitou).not.toBe(NTA_GENERAL_INFO_LEGAL_STATUS);
  });

  it('tax-answer / qa-jirei は解説資料系 (binds_tax_office: false)', () => {
    expect(LEGAL_STATUS_BY_DOCTYPE['tax-answer'].binds_tax_office).toBe(false);
    expect(LEGAL_STATUS_BY_DOCTYPE['qa-jirei'].binds_tax_office).toBe(false);
    expect(LEGAL_STATUS_BY_DOCTYPE['tax-answer']).toBe(NTA_GENERAL_INFO_LEGAL_STATUS);
    expect(LEGAL_STATUS_BY_DOCTYPE['qa-jirei']).toBe(NTA_GENERAL_INFO_LEGAL_STATUS);
  });

  it('bunshokaitou の note にタックスアンサー固有文言が含まれていない (Issue #2 回帰防止)', () => {
    // 旧 bug: bunshokaitou の note が「タックスアンサー・質疑応答事例は…」と返っていた
    expect(LEGAL_STATUS_BY_DOCTYPE.bunshokaitou.note).not.toContain('タックスアンサー');
    // bunshokaitou には「個別事案」というキーフレーズが入っているべき
    expect(LEGAL_STATUS_BY_DOCTYPE.bunshokaitou.note).toContain('個別事案');
  });
});

describe('TSUTATSU_LEGAL_STATUS / NTA_GENERAL_INFO_LEGAL_STATUS / BUNSHOKAITOU_LEGAL_STATUS', () => {
  it('TSUTATSU_LEGAL_STATUS は通達文言 (現行 v0.9.0 互換)', () => {
    expect(TSUTATSU_LEGAL_STATUS.binds_citizens).toBe(false);
    expect(TSUTATSU_LEGAL_STATUS.binds_tax_office).toBe(true);
    expect(TSUTATSU_LEGAL_STATUS.note).toContain('通達');
    expect(TSUTATSU_LEGAL_STATUS.note).toContain('昭和43.12.24');
  });

  it('NTA_GENERAL_INFO_LEGAL_STATUS は解説資料文言 (現行 v0.9.0 互換)', () => {
    expect(NTA_GENERAL_INFO_LEGAL_STATUS.binds_tax_office).toBe(false);
    expect(NTA_GENERAL_INFO_LEGAL_STATUS.note).toContain('タックスアンサー');
    expect(NTA_GENERAL_INFO_LEGAL_STATUS.note).toContain('質疑応答事例');
  });

  it('BUNSHOKAITOU_LEGAL_STATUS は v0.9.1 で新設された独立 const', () => {
    expect(BUNSHOKAITOU_LEGAL_STATUS.binds_tax_office).toBe(false);
    expect(BUNSHOKAITOU_LEGAL_STATUS.note).toContain('文書回答事例');
    expect(BUNSHOKAITOU_LEGAL_STATUS.note).toContain('個別事案');
  });
});

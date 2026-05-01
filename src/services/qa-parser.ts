/**
 * QA Parser — 国税庁質疑応答事例ページの cheerio パーサ
 *
 * 入力例 URL: https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm
 *
 * 想定する HTML 構造:
 *   <div class="imp-cnt-tsutatsu" id="bodyArea">  ← 通達と同じセレクタ
 *     <h1>個人事業者が所有するゴルフ会員権の譲渡</h1>
 *     <h2>【照会要旨】</h2>
 *     <p>本文...</p>
 *     <h2>【回答要旨】</h2>
 *     <p>本文...</p>
 *     <h2>【関係法令通達】</h2>
 *     <p>消基通 5-1-9 等</p>
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import type { QaTopic } from '../constants.js';
import type { QaJirei } from '../types/qa.js';
import { TsutatsuParseError } from './tsutatsu-parser.js';

export interface ParseQaInput {
  /** デコード済み HTML 文字列 */
  html: string;
  /** リクエスト URL */
  sourceUrl: string;
  /** 税目フォルダ。例: "shohi" */
  topic: QaTopic;
  /** カテゴリ番号。例: "02" */
  category: string;
  /** 事例番号。例: "19" */
  id: string;
  /** ISO 8601 時刻 */
  fetchedAt?: string;
}

/**
 * 質疑応答事例ページをパースして `QaJirei` を組み立てる。
 */
export function parseQaJirei(input: ParseQaInput): QaJirei {
  const { html, sourceUrl, topic, category, id } = input;
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();

  const $ = cheerio.load(html);
  $('br').replaceWith('\n');

  const $body =
    $('div.imp-cnt-tsutatsu#bodyArea').first().length > 0
      ? $('div.imp-cnt-tsutatsu#bodyArea').first()
      : $('#bodyArea').first();

  if ($body.length === 0) {
    throw new TsutatsuParseError(
      '質疑応答事例本体 (div.imp-cnt-tsutatsu#bodyArea) が見つかりません',
      sourceUrl
    );
  }

  $body.find('ol.breadcrumb, .page-top-link, .contents-feedback').remove();

  // タイトル: 通達と同じく page-header h1 が無い場合は body の h1
  const title =
    cleanText($body.find('.page-header h1').first().text()) ||
    cleanText($body.find('h1').first().text());

  // 各セクションを抽出
  const question = extractSectionParagraphs($, $body, '【照会要旨】');
  const answer = extractSectionParagraphs($, $body, '【回答要旨】');
  const relatedLaws = extractSectionParagraphs($, $body, '【関係法令通達】');

  return {
    topic,
    category,
    id,
    title,
    question,
    answer,
    relatedLaws,
    sourceUrl,
    fetchedAt,
  };
}

/**
 * 指定見出し(h2) 配下の段落を集める。次の h2 で打ち切り。
 */
function extractSectionParagraphs(
  $: CheerioAPI,
  $body: cheerio.Cheerio<Element>,
  headingMarker: string
): string[] {
  const paragraphs: string[] = [];
  let foundHeading = false;
  let stopAtNextH2 = false;

  $body.find('h2').each((_, h2) => {
    if (stopAtNextH2) return;
    const headingText = cleanText($(h2).text());
    if (!foundHeading) {
      if (headingText.includes(headingMarker)) {
        foundHeading = true;
        let node = h2.nextSibling;
        while (node) {
          if (node.type === 'tag') {
            const el = node as Element;
            if (el.tagName === 'h2') {
              stopAtNextH2 = true;
              break;
            }
            if (el.tagName === 'p' || el.tagName === 'div' || el.tagName === 'li') {
              const t = cleanText($(el).text());
              if (t) paragraphs.push(t);
            }
          }
          node = node.nextSibling;
        }
      }
    }
  });

  return paragraphs;
}

function cleanText(s: string): string {
  return s
    .replace(/　/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

#!/usr/bin/env node
/* ============================================================
 * 从刷题网站词表生成核心词库索引（发音/释义/词性）：
 *   输入：cet6_quiz.html 内嵌词表 data-all-words（核心词库 6526 词）
 *         + data/full-words.js（打卡词库 2920 词）
 *   输出：data/core-words.js（window.__CORE_WORDS__）
 *
 * 词群导图查看器用它把节点音标/释义统一为刷题网站词库的权威值：
 *   - 两库合并，核心词库优先（与刷题网站默认词库一致）
 *   - 核心词库发音残缺（如 "/-ize/"）时回退打卡词库
 *   - 两库都没有的词保留导图识别值（查看器端自动回退）
 *
 * 用法：node tools/build-core-words.js
 * 说明：词库数据更新后重新运行本脚本，再运行 build-offline-viewer.js 同步离线版。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'cet6_quiz.html');
const fullPath = path.join(root, 'data', 'full-words.js');
const outPath = path.join(root, 'data', 'core-words.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script type="application\/json" id="data-all-words">([\s\S]*?)<\/script>/);
if (!m) {
  console.error('[build-core-words] 未在 cet6_quiz.html 中找到 data-all-words 词表');
  process.exit(1);
}
const bank = JSON.parse(m[1]);

const fullRaw = fs.readFileSync(fullPath, 'utf8');
const fm = fullRaw.match(/window\.__FULL_WORDS_DATA__\s*=\s*(\[[\s\S]*\])/);
if (!fm) {
  console.error('[build-core-words] 未在 data/full-words.js 中找到词表');
  process.exit(1);
}
const fullWords = JSON.parse(fm[1].replace(/;\s*$/, ''));

// 发音有效性：过滤 OCR 残缺值（如 "/-ize/"、"'-zation/" 这类）
function isValidPron(p) {
  if (!p) return false;
  const s = String(p).replace(/^\//, '').replace(/\/$/, '');
  if (s.length < 3) return false;
  if (/^[-/]/.test(s)) return false;
  if (!/[a-z]/.test(s)) return false;
  return true;
}

// 第一步：核心词库
const dict = {};
for (const w of bank) {
  const e = {};
  if (w.pronunciation) e.p = w.pronunciation;
  if (w.meaning) e.m = w.meaning;
  if (w.pos) e.o = w.pos;
  dict[w.word] = e;
}

// 第二步：打卡词库补充与择优
//  - 核心库没有的词：打卡库补充
//  - 两库都有且发音不同：取"更完整"（更长）者——两库各有 OCR 残缺
//    （如 aggressive：核心残缺 /ə'gresv/ vs 打卡完整 /əˈɡresɪv/；ambition：核心完整 /æm'bɪʃn/ vs 打卡残缺 /æmˈbɪn/）
//  - 同长/核心更长：保持核心（与刷题网站核心词库默认显示一致）
let added = 0, fixed = 0, upgraded = 0;
for (const w of fullWords) {
  const key = w.word;
  const e = dict[key];
  if (!e) {
    const ne = {};
    if (w.pronunciation) ne.p = w.pronunciation;
    if (w.meaning) ne.m = w.meaning;
    dict[key] = ne;
    added++;
  } else {
    const cpS = String(e.p || '').replace(/^\//, '').replace(/\/$/, '');
    const fpS = String(w.pronunciation || '').replace(/^\//, '').replace(/\/$/, '');
    const cpOk = isValidPron(e.p), fpOk = isValidPron(w.pronunciation);
    if (cpOk && fpOk && fpS.length > cpS.length) {
      e.p = w.pronunciation;   // 打卡更完整 → 采用打卡
      upgraded++;
    } else if (!cpOk && fpOk) {
      e.p = w.pronunciation;   // 核心残缺 → 回退打卡
      fixed++;
    }
    if (!e.m && w.meaning) e.m = w.meaning;
  }
}

// 归一化映射：括号变体（如 "enrol(l)" → "enrol"、"kilometre(-ter)" → "kilometre"）供查看器兜底匹配
function normKey(s) {
  return String(s).toLowerCase().replace(/\(.*?\)/g, '').replace(/[\s\-'’]/g, '');
}
const normMap = {};
for (const k of Object.keys(dict)) {
  const nk = normKey(k);
  if (nk !== k.toLowerCase() && !(nk in dict) && !(nk in normMap)) normMap[nk] = k;
}

const out = '// 词库发音/释义/词性索引（自动生成：核心词库 ' + bank.length + ' 词 + 打卡词库补充 ' + added + ' 词，共 ' + Object.keys(dict).length + ' 词；发音择优：打卡更完整采用 ' + upgraded + ' 处、核心残缺回退 ' + fixed + ' 处；括号变体映射 ' + Object.keys(normMap).length + ' 条）\n// 重新生成：node tools/build-core-words.js\nwindow.__CORE_WORDS__=' + JSON.stringify(dict) + ';\nwindow.__CORE_WORDS_NORM__=' + JSON.stringify(normMap) + ';\n';
fs.writeFileSync(outPath, out);
console.log('[build-core-words] 已生成：data/core-words.js（' + (out.length / 1024).toFixed(0) + ' KB，共 ' + Object.keys(dict).length + ' 词，打卡库补充 ' + added + ' 词，发音择优 ' + upgraded + ' 处，残缺回退 ' + fixed + ' 处，括号变体映射 ' + Object.keys(normMap).length + ' 条）');

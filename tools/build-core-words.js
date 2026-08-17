#!/usr/bin/env node
/* ============================================================
 * 从刷题网站词表生成核心词库索引（发音/释义/词性）：
 *   输入：cet6_quiz.html 内嵌词表 <script id="data-all-words">
 *   输出：data/core-words.js（window.__CORE_WORDS__）
 *
 * 词群导图查看器用它把节点音标/释义统一为刷题网站词库的权威值
 * （词库无此词或发音残缺时回退导图识别值）。
 *
 * 用法：node tools/build-core-words.js
 * 说明：词库数据更新后重新运行本脚本，再运行 build-offline-viewer.js 同步离线版。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'cet6_quiz.html');
const outPath = path.join(root, 'data', 'core-words.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script type="application\/json" id="data-all-words">([\s\S]*?)<\/script>/);
if (!m) {
  console.error('[build-core-words] 未在 cet6_quiz.html 中找到 data-all-words 词表');
  process.exit(1);
}
const bank = JSON.parse(m[1]);

const dict = {};
for (const w of bank) {
  const e = {};
  if (w.pronunciation) e.p = w.pronunciation;
  if (w.meaning) e.m = w.meaning;
  if (w.pos) e.o = w.pos;
  dict[w.word] = e;
}

const out = '// 核心词库发音/释义/词性索引（自动生成自 cet6_quiz.html 内嵌词表 data-all-words，共 ' + bank.length + ' 词）\n// 重新生成：node tools/build-core-words.js\nwindow.__CORE_WORDS__=' + JSON.stringify(dict) + ';\n';
fs.writeFileSync(outPath, out);
console.log('[build-core-words] 已生成：data/core-words.js（' + (out.length / 1024).toFixed(0) + ' KB，' + bank.length + ' 词）');

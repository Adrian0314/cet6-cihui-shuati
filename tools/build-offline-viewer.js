#!/usr/bin/env node
/* ============================================================
 * 生成离线单文件版词群导图查看器：
 *   输入：word-maps-viewer.html（在线版模板）+ data/unit-maps.js
 *   输出：word-maps-viewer-offline.html（数据内联，单文件拷贝即用）
 *
 * 用法：node tools/build-offline-viewer.js
 * 说明：数据更新后重新运行本脚本即可同步离线版。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tplPath = path.join(root, 'word-maps-viewer.html');
const dataPath = path.join(root, 'data', 'unit-maps.js');
const outPath = path.join(root, 'word-maps-viewer-offline.html');

const tpl = fs.readFileSync(tplPath, 'utf8');
const data = fs.readFileSync(dataPath, 'utf8');

const marker = '<script src="data/unit-maps.js"></script>';
if (!tpl.includes(marker)) {
  console.error('[build-offline-viewer] 模板中未找到数据引用标记：' + marker);
  process.exit(1);
}

const inline = '<script>\n// 数据内联自 data/unit-maps.js（离线单文件版，由 tools/build-offline-viewer.js 生成）\nwindow.__UNIT_MAPS_DATA_INLINE__ = true;\n' + data + '\n</script>';

const out = tpl.replace(marker, inline);
fs.writeFileSync(outPath, out);
console.log('[build-offline-viewer] 已生成：' + path.relative(root, outPath) + '（' + (out.length / 1024).toFixed(0) + ' KB）');

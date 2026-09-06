#!/usr/bin/env node
/* ============================================================
 * 生成离线单文件版词群导图查看器：
 *   输入：word-maps-viewer.html（在线版模板）+ unit-maps.js
 *   输出：word-maps-viewer-offline.html（数据内联，单文件拷贝即用）
 *
 * 用法：node build-offline-viewer.js
 * 说明：数据更新后重新运行本脚本即可同步离线版。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
// 网站文件全部位于仓库根目录（扁平结构，无子目录）
const siteDir = root;
const tplPath = path.join(siteDir, 'word-maps-viewer.html');
const dataPath = path.join(siteDir, 'unit-maps.js');
const corePath = path.join(siteDir, 'core-words.js');
const outPath = path.join(siteDir, 'word-maps-viewer-offline.html');

const tpl = fs.readFileSync(tplPath, 'utf8');
const data = fs.readFileSync(dataPath, 'utf8');
const core = fs.readFileSync(corePath, 'utf8');

const marker = '<script src="unit-maps.js"></script>';
const markerCore = '<script src="core-words.js"></script>';
if (!tpl.includes(marker) || !tpl.includes(markerCore)) {
  console.error('[build-offline-viewer] 模板中未找到数据引用标记：' + marker + ' 或 ' + markerCore);
  process.exit(1);
}

const inlineData = '<script>\n// 数据内联自 unit-maps.js（离线单文件版，由 build-offline-viewer.js 生成）\nwindow.__UNIT_MAPS_DATA_INLINE__ = true;\n' + data + '\n</script>';
const inlineCore = '<script>\n// 词库索引内联自 core-words.js（离线单文件版，由 build-offline-viewer.js 生成）\n' + core + '\n</script>';

let out = tpl.replace(marker, inlineData).replace(markerCore, inlineCore);
fs.writeFileSync(outPath, out);
console.log('[build-offline-viewer] 已生成：' + path.relative(root, outPath) + '（' + (out.length / 1024).toFixed(0) + ' KB）');

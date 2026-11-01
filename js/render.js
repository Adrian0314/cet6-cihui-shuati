/* render.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ WORD DETAIL (助记/例句/派生词 板块) ============
// 反馈区"正确答案"为英文单词时，右侧附朗读按钮
function speakBtnFor(word, mode) {
  if (mode !== 'cn2en' || !word || !word.word) return '';
  return '<span onclick="speakWord(&quot;' + word.word + '&quot;)" style="cursor:pointer;margin-left:8px;font-size:0.95em;display:inline-block;vertical-align:middle;" title="朗读发音">\u{1F50A}</span>';
}
// 答错/跳过后显示"其余选项"：ABCD 中除正确项外的三个，每行 编号+单词+释义+朗读，选错项标注"← 你选的"
function wrongOptionsHTML(q, mode, chosenIndex) {
  var labels = ['A', 'B', 'C', 'D'];
  var rows = '';
  for (var i = 0; i < q.options.length; i++) {
    if (i === q.correctIndex) continue;
    var o = q.options[i];
    if (!o) continue;
    var speak = speakBtnFor(o, mode) ||
      '<span onclick="speakWord(&quot;' + o.word + '&quot;)" style="cursor:pointer;margin-left:8px;font-size:0.95em;display:inline-block;vertical-align:middle;" title="朗读发音">\u{1F50A}</span>';
    var picked = (typeof chosenIndex === 'number' && i === chosenIndex)
      ? ' <span style="color:var(--red);font-size:0.85em;margin-left:6px;">← 你选的</span>' : '';
    // 题目选项 en2cn 保持中文-only；答错反馈的其余选项显示英文单词、词性、音标及中文释义，便于复盘。
    // 反馈两种做题方向都使用完整词条信息，避免复盘时无法辨认选项对应的英文单词。
    var text = '<strong>' + o.word + '</strong>' +
      (o.pronunciation ? ' <span style="color:var(--text2);font-size:0.85em;">' + o.pronunciation + '</span>' : '') +
      speak + optionPosHTML(o, mode) + '<span style="color:var(--text2);">' + (getChineseOptionText(o.meaning) || '(释义待补充)') + '</span>';
    rows += '<div style="margin:4px 0;"><span style="display:inline-block;min-width:20px;font-weight:700;color:var(--text2);">' + labels[i] + '.</span> ' + text + picked + '</div>';
  }
  return rows ? '<div class="feedback-options" style="margin:8px 0 2px;"><b>其余选项：</b>' + rows + '</div>' : '';
}

// 选择题显示质量控制：P95 释义约 41 个汉字，90 个汉字可覆盖极端长词条，
// 同时保留正常多词性释义。只过滤英文→中文模式的干扰项，不改动原始词库。
var MAX_OPTION_MEANING_CJK = 90;
function chineseMeaningLength(meaning) {
  return meaningChineseKey(meaning).length;
}
function isLongOptionMeaning(word) {
  return !!word && chineseMeaningLength(word.meaning) > MAX_OPTION_MEANING_CJK;
}
function isUsableDistractor(word, correctWord, mode) {
  if (!word || !word.word || !word.meaning) return false;
  if (correctWord && word.id === correctWord.id) return false;
  // 中文选项禁止超长释义，避免 do/play/turn 等词条撑满整行。
  if (mode === 'en2cn' && (isLongOptionMeaning(word) || !getChineseOptionText(word.meaning))) return false;
  return true;
}
// 反馈补充区统一顺序：单词详解在前，易混淆词在后。调用方再接词群导图。
function confusableHTML(word, mode) {
  var confusables = getConfusableDisplay(word, mode);
  if (!confusables || confusables.length === 0) return '';
  var html = '<div class="fb-conf"><strong>⚠️ 易混淆词：</strong>';
  confusables.forEach(function(c) {
    html += '<div class="ci">• <strong>' + c.word + '</strong> — ' + c.meaning + '</div>';
  });
  return html + '</div>';
}
function appendFeedbackDetails(feedback, word, mode) {
  if (!feedback || !feedback.parentNode) return;
  // 保护重渲染/重复触发场景：同一反馈节点只保留一组补充区。
  var sib = feedback.nextSibling;
  while (sib) {
    var next = sib.nextSibling;
    if (sib.nodeType === 1 && (sib.classList.contains('word-detail') || sib.classList.contains('fb-conf') || sib.classList.contains('gmap-wrap') || sib.classList.contains('word-group-info'))) sib.remove();
    sib = next;
  }
  var holder = document.createElement('div');
  holder.innerHTML = feedbackDetailsHTML(word, mode);
  var ref = feedback.nextSibling;
  while (holder.firstChild) feedback.parentNode.insertBefore(holder.firstChild, ref);
}
function feedbackDetailsHTML(word, mode, poolName) {
  return getWordDetailHTML(word, poolName, { detailOnly: true }) + confusableHTML(word, mode) + getWordGroupInfoHTML(word, poolName) + groupMapSVG(word);
}
function favoriteButtonHTML(word, poolName) {
  if (!word || !word.id) return '';
  var pool = poolName || currentPool || 'core';
  var key = favoriteKey(word.id, pool);
  var active = isFavorite(word.id, pool);
  return '<button class="ctrl-btn favorite-toggle' + (active ? ' active' : '') + '" data-favorite-toggle data-favorite-key="' + key + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
    (active ? '★ 已标记' : '☆ 标记重点') + '</button>';
}

function getWordGroupInfoHTML(word, poolName) {
  var groupInfo = '<div class="word-group-info" style="text-align:right;margin:8px 0 4px;">' + favoriteButtonHTML(word, poolName) + '</div>';
  if (word.group_id || word.unit) {
    groupInfo = '<div class="word-group-info" style="margin:8px 0 4px;font-size:0.85em;color:var(--text2);">' +
      (word.group_id ? '📁 词群 ' + word.group_id + '「' + (word.group_name || '') + '」' : '📍') +
      (word.unit ? (word.group_id ? ' · ' : ' ') + 'Unit ' + word.unit : '') +
      (word.lesson ? ' · Lesson ' + word.lesson : '') +
      (word.isStar ? ' · 书中派生词*' : '') +
      '</div>';
  }
  return groupInfo;
}

function getWordDetailHTML(word, poolName, options) {
  var includeGroupInfo = !(options && options.detailOnly);
  var parts = [];
  // 打卡进度按词条所属词库显示（核心词库才有 8 格打卡；不能用做题页 currentPool 判断，
  // 否则单词浏览器里浏览大纲词时会误用核心词库的 id 查进度）
  if (isGridPool(poolName) && word.id) {
    var gp = gridProgressText(word.id, poolName);
    if (gp) parts.push(['\u{1F5D3}\uFE0F', '\u6253\u5361', gp, '']);
  }
  if (word.memo) parts.push(['\u{1F9E0}', '\u5DE7\u8BB0', word.memo, '']);
  if (word.example) {
    var ex = word.example;
    // 例句格式:「英文句子 + 空格 + 中文翻译」,以首个汉字为界切分,英文中文各占一行
    // 注意:英文撇号(we'll / I'm / don't)用的是弯引号 U+2019,不能当作中文引号切分,
    // 否则例句会在撇号处被拦腰截断(如 "we'll" 被切成 "we" + "'ll")
    // 顺带修正常见笔误:英文句号/问号后多打的中文句号(如 "courses.。他…")直接去掉
    ex = ex.replace(/([.!?])\u3002(?=[\u4e00-\u9fff])/g, '$1');
    var cut = -1;
    for (var ci = 0; ci < ex.length; ci++) {
      var cj = ex.charCodeAt(ci);
      if ((cj >= 0x4e00 && cj <= 0x9fff) || (cj >= 0x3400 && cj <= 0x4dbf)) { cut = ci; break; }
    }
    if (cut > 0) {
      // 中文译文若以「引号包裹的词/短语」开头(如 “我才不怕呢。”、《蜘蛛侠》/'乐观'/'childish'),
      // 向前(后引号)或向后(前引号)找到配对引号,把整段引号内容并入中文行,避免英文行残留孤立的引号
      var qOpen = /['"\u2018\u2019\u201c\u201d\u3008\u3009\u300a\u300b\u300e\u300f\u3010\u3011\u3014\u3015\u3016\u3017\u3018\u3019\u301a\u301b\uff08\uff09\uff3b\uff3d\u00ab\u00bb]/;
      while (cut > 0 && qOpen.test(ex[cut - 1])) {
        var prev = ex[cut - 1];
        if (prev === '\u2018' || prev === '\u201c' || prev === '\u300a' || prev === '\u3008' || prev === '\u300c' || prev === '\u300e' || prev === '\u3010' || prev === '\u3014' || prev === '\u3016' || prev === '\u3018' || prev === '\u301a' || prev === '\uff08' || prev === '\uff3b' || prev === '\u00ab' || prev === '"' || prev === "'") {
          // 前引号紧跟汉字:向后找配对引号
          var closeAt = -1;
          for (var k = cut; k < ex.length; k++) { if (qOpen.test(ex[k])) { closeAt = k; break; } }
          if (closeAt < 0) break;
          cut = cut - 1;
        }
        else {
          // 后引号紧跟汉字:向前找配对引号(引号内不含空白)
          var openAt = -1;
          for (var j = cut - 2; j >= 0; j--) {
            if (qOpen.test(ex[j])) { openAt = j; break; }
            if (/\s/.test(ex[j])) break;
          }
          if (openAt < 0) break;
          cut = openAt;
        }
      }
      parts.push(['\u{1F4AC}', '\u4F8B\u53E5', ex.slice(0, cut).replace(/\s+$/, ''), 'en']);
      parts.push(['', '', ex.slice(cut).replace(/^\s+/, ''), 'cn']);
    }
    else { parts.push(['\u{1F4AC}', '\u4F8B\u53E5', ex, 'en']); }
  }
  // 派生词行：仅当内容含英文单词时显示（防止纯中文释义误标为派生词）
  if (word.derivative && /[A-Za-z]{2,}/.test(word.derivative)) parts.push(['\u{1F331}', '\u6D3E\u751F\u8BCD', word.derivative, '']);
  if (parts.length === 0) return includeGroupInfo ? getWordGroupInfoHTML(word, poolName) : '';
  var html = '<div class="word-detail open"><div class="wd-head" onclick="this.parentElement.classList.toggle(\'open\')">\u{1F4D6} \u5355\u8BCD\u8BE6\u89E3 <span class="wd-arrow">\u25BE</span></div><div class="wd-body">'
    // 查单词场景也提供「朗读 / 发音练习」这一对按钮；做题反馈区（detailOnly）已有顶部按钮，不重复插入
    + ((options && options.detailOnly) ? '' : pronPracticePillRow(word.word, word.pronunciation));
  // 派生词渲染辅助:解析"单词+音标"序列,在音标后插入朗读按钮(🔊,点击朗读单词)
  // 变体词如 stabilise/-ize 统一为主形式;无音标词不加按钮;解析失败原样输出
  function derivativeHtml(t) {
    if (!t) return '';
    var esc = function(s) { return s.replace(/'/g, "\\'"); };
    // 变体词主形式:stabilise/-ize → stabilise(斜杠变体会破坏音标配对)
    t = t.replace(/([A-Za-z][A-Za-z'\-]*)\/-([A-Za-z][A-Za-z'\-]*)/g, '$1');
    return t.replace(/([A-Za-z][A-Za-z'\-]*)(\s*\/[^\/\r\n]+\/\s*)/g, function(m, w, ipa) {
      return w + ipa.replace(/\s+$/, '') +
        '<span onclick="speakWord(\'' + esc(w) + '\')" style="cursor:pointer;margin-left:5px;font-size:0.95em;display:inline-block;vertical-align:middle;" title="朗读发音">\u{1F50A}</span> ';
    });
  }
  parts.forEach(function(p) {
    if (p[1]) {
      var body = p[2];
      // 派生词行:在每个"单词+音标"的音标后插入朗读按钮
      if (p[0] === '\u{1F331}') body = derivativeHtml(body);
      html += '<div class="wd-row"><span class="wd-tag">' + p[0] + ' ' + p[1] + '</span><span class="wd-txt' + (p[3] ? ' ' + p[3] : '') + '">' + body + '</span></div>';
    }
    else html += '<div class="wd-row"><span class="wd-tag"></span><span class="wd-txt cn">' + p[2] + '</span></div>';
  });
  html += '</div></div>';
  return (includeGroupInfo ? getWordGroupInfoHTML(word, poolName) : '') + html;
}

// ============ 词群导图（新版）：书页真实导图数据（unit-maps.js），放射状 + 点击下钻 ============
// 数据来源：《你还在背单词吗（刘晓艳）》Unit1 书页导图识别（词以群记1-14），音标/释义以词库权威数据为准
var _gmapSeq = 0;
var _gmapState = {}; // id -> { unit, gid, stack:[点击过的节点词], active:当前做题词 }
// 关系类型 → 连线颜色（style 内联，CSS 变量在 attribute 中不生效）
var GMAP_REL_COLORS = {
  '扩': 'var(--green)', '同根': 'var(--blue)', '近义': 'var(--orange)',
  '相关': 'var(--text2)', '形近': 'var(--pink)', '加前缀': '#0891b2',
  '反义': 'var(--red)', '拆分': 'var(--blue)', '合成': 'var(--green)'
};
// 虚线关系（spec：形近/反义 虚线）
function gmapRelDashed(rel) { return (rel === '形近' || rel === '反义'); }

function normalizeUnitMapCoverage() {
  if (window.__UNIT_MAPS_COVERAGE_NORMALIZED__ || !window.__UNIT_MAPS_DATA__ || !Array.isArray(ALL_WORDS)) return;
  window.__UNIT_MAPS_COVERAGE_NORMALIZED__ = true;
  function walk(nodes, out) {
    (nodes || []).forEach(function(node) {
      out[String(node.word).toLowerCase()] = true;
      walk(node.children, out);
    });
  }
  ALL_WORDS.forEach(function(word) {
    var unitMap = window.__UNIT_MAPS_DATA__[word.unit];
    if (!unitMap) return;
    var words = {};
    Object.keys(unitMap).forEach(function(gid) { walk(unitMap[gid].level1Nodes, words); });
    if (words[String(word.word).toLowerCase()]) return;
    var gid = unitMap[String(word.group_id)] ? String(word.group_id) : Object.keys(unitMap)[0];
    if (!gid || !unitMap[gid]) return;
    var node = {
      word: String(word.word),
      phonetic: word.pronunciation || '',
      meaning: word.meaning || '',
      pos: ((word.meaning || '').match(/^([a-z]+\.)/i) || [])[1] || '',
      children: []
    };
    if (!Array.isArray(unitMap[gid].level1Nodes)) unitMap[gid].level1Nodes = [];
    unitMap[gid].level1Nodes.push(node);
    words[String(word.word).toLowerCase()] = true;
  });
}

function ensureUnitMaps(cb) {
  if (window.__UNIT_MAPS_DATA__) { normalizeUnitMapCoverage(); if (cb) cb(); return; }
  loadDataScript('unit-maps.js', function() { normalizeUnitMapCoverage(); if (cb) cb(); });
}

// 当前词是否可用新版导图：核心词库，或与核心词库重叠的打卡词
function canUseNewMap(word) {
  if (!word || !word.unit) return false;
  if (!window.__UNIT_MAPS_DATA__) return false;
  // 1500核心词按 List 1-50 编号，与大纲词汇 Unit 1-14 的导图数据不是同一套，禁用以免串用错图
  if (currentPool === 'c1500') return false;
  if (currentPool === 'full' && !ALL_WORDS.some(function(coreWord) {
    return String(coreWord.word).toLowerCase() === String(word.word).toLowerCase();
  })) return false;
  // 只要该 unit 有导图数据即可；词实际所在词群以书页导图划分为准（词库 group_id 可能与书页不一致）
  return !!window.__UNIT_MAPS_DATA__[word.unit];
}

// 沿下钻路径解析当前中心与一级节点
function resolveMapPath(map, stack) {
  var nodes = map.level1Nodes || [];
  var centerWord = '', centerMeaning = map.group_name;
  for (var i = 0; i < stack.length; i++) {
    var target = stack[i], found = null;
    for (var j = 0; j < nodes.length; j++) { if (nodes[j].word === target) { found = nodes[j]; break; } }
    if (!found) break;
    centerWord = found.word;
    centerMeaning = found.meaning || found.word;
    nodes = found.children || [];
  }
  return { nodes: nodes, centerWord: centerWord, centerMeaning: centerMeaning };
}

// 中心文字断行（仅主题中心用）：中文短语按显示宽度均衡两行；英文单词由 gmapCenterLayout 单行处理
function gmapCenterLines(label, isWord) {
  var fs = isWord ? 15 : 13, maxW = isWord ? 90 : 58;
  function w(s) { var r = 0; for (var k = 0; k < s.length; k++) r += (s.charCodeAt(k) > 255 ? 1 : 0.55) * fs; return r; }
  if (w(label) <= maxW) return [label];
  var cut = 0;
  while (cut < label.length && w(label.slice(0, cut + 1)) <= maxW * 2) cut++;
  var head = label.slice(0, Math.max(cut, 1));
  var best = -1, bd = Infinity;
  for (var k = 1; k < head.length; k++) {
    var lw = w(head.slice(0, k)), rw = w(head.slice(k));
    if (lw > maxW || rw > maxW) continue;
    var d = Math.abs(lw - rw);
    if (d < bd) { bd = d; best = k; }
  }
  var pk = best > 0 ? best : Math.ceil(head.length / 2);
  return [head.slice(0, pk).trim(), head.slice(pk).trim()];
}

// 中心文字布局：返回 {lines, fs, r, lh}
// 单词中心→单行、字号自适应（不低于 13）、圆随文字宽度外扩，保证长单词不被圆遮住；
// 主题中心→中文两行断行、圆默认 36
function gmapCenterLayout(label, isWord) {
  function w(s, f) { var r = 0; for (var k = 0; k < s.length; k++) r += (s.charCodeAt(k) > 255 ? 1 : 0.55) * f; return r; }
  if (!isWord) {
    var lines = gmapCenterLines(label, false);
    var maxW = 0;
    for (var k = 0; k < lines.length; k++) { var ww = w(lines[k], 13); if (ww > maxW) maxW = ww; }
    return { lines: lines, fs: 13, r: Math.max(36, Math.ceil(maxW / 2) + 9), lh: 18 };
  }
  var fs = 15;
  while (fs > 13 && w(label, fs) > 86) fs--;
  var r = Math.max(30, Math.ceil(w(label, fs) / 2) + 10);
  if (r > 68) { fs = Math.max(9, Math.floor(fs * 68 / r)); r = Math.max(30, Math.ceil(w(label, fs) / 2) + 10); }
  return { lines: [label], fs: fs, r: r, lh: fs + 3 };
}

function buildMapSVG(id, map, r, activeWord) {
  var nodes = r.nodes;
  // 触摸/窄屏适配：手机端放大节点圆与文字（无 hover，中文靠点击气泡展示）
  var COARSE = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (window.innerWidth < 600 && 'ontouchstart' in window);
  var cx = 240, cy = COARSE ? 210 : 190;
  var n = nodes.length;
  if (!n) {
    return '<div style="color:var(--text2);font-size:0.85em;padding:10px 0">末端词，无更多关联词</div>';
  }
  // 中心文字布局（单词单行自适应字号 / 主题两行断行），圆随文字宽度外扩
  var isWord = !!r.centerWord;
  var cText = isWord ? r.centerWord : (map.group_name || '词群');
  var L = gmapCenterLayout(cText, isWord);
  var centerR = L.r, cfs = L.fs, clines = L.lines, lh = L.lh;
  // 统一环带节奏：中心圆边→关系标签中心=18px，标签中心→节点圆近边=18px（对称不贴圆）
  // 节点文字按词长动态外推（见下方 txR），保证任何角度/词长下文字都不碰任何圆
  var R = centerR + (COARSE ? 62 : 51), relD = centerR + 18;
  var relFs = COARSE ? 11 : 9.5;
  var viewBox = COARSE ? '0 -20 480 460' : '0 0 480 380';
  var svg = '<svg viewBox="' + viewBox + '" style="width:100%;max-width:400px;height:auto;display:block;margin:4px auto;">';
  // 连线 + 关系标签
  for (var i = 0; i < n; i++) {
    var ang = (2 * Math.PI * i / n) - Math.PI / 2;
    var x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
    var rel = nodes[i].relation || '';
    var col = GMAP_REL_COLORS[rel] || 'var(--border)';
    var dash = gmapRelDashed(rel) ? ' stroke-dasharray="4,3"' : '';
    svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '" stroke-width="1.4" style="stroke:' + col + '"' + dash + '/>';
    if (rel) {
      var mx = cx + relD * Math.cos(ang), my = cy + relD * Math.sin(ang);
      svg += '<text x="' + mx + '" y="' + (my - 4) + '" text-anchor="middle" font-size="' + relFs + '" paint-order="stroke" style="fill:' + col + ';stroke:var(--surface);stroke-width:3">' + rel + '</text>';
    }
  }
  // 中心圆（高亮）+ 中心文字
  svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + centerR + '" style="fill:var(--accent);stroke:var(--accent2)" stroke-width="2"/>';
  var cy0 = cy - (clines.length - 1) * (lh / 2);
  svg += '<text text-anchor="middle" dominant-baseline="middle" font-size="' + cfs + '" font-weight="700" style="fill:#ffffff">';
  for (var cl = 0; cl < clines.length; cl++) {
    svg += '<tspan x="' + cx + '" y="' + (cy0 + cl * lh) + '">' + clines[cl] + '</tspan>';
  }
  svg += '</text>';
  // 节点
  var nodeFs = COARSE ? 13.5 : 10.5;
  for (var j = 0; j < n; j++) {
    var w = nodes[j];
    var ang2 = (2 * Math.PI * j / n) - Math.PI / 2;
    var x2 = cx + R * Math.cos(ang2), y2 = cy + R * Math.sin(ang2);
    // 文字水平排布且不沿径向旋转，故按词长外推：径向内侧始终距节点圆≥~10px（半宽≈len*2.9，加圆半径15+空隙）
    var txR = R + (COARSE
      ? Math.max(50, Math.round(String(w.word).length * 3.6) + 36)
      : Math.max(38, Math.round(String(w.word).length * 2.9) + 27));
    var tx = cx + txR * Math.cos(ang2), ty = cy + txR * Math.sin(ang2);
    var isActive = activeWord && (w.word.toLowerCase() === activeWord.toLowerCase());
    var childCount = (w.children && w.children.length) ? w.children.length : 0;
    var escW = String(w.word).replace(/'/g, "\\'");
    // Keep a separator even for nodes without phonetic/meaning; consumers use the first token as the node word.
    var tip = w.word + ' ' + (w.phonetic || '') + (w.meaning ? ' ' + w.meaning : '') +
      (childCount ? '（有 ' + childCount + ' 个分支，点击圆圈展开）' : '（末端词，无分支）');
    // 圆圈=展开下钻（末端词点击改为朗读）；单词文字=朗读发音；均带中文释义气泡（手机端）
    var drillClick = 'groupMapDrill(\'' + id + '\',\'' + escW + '\',' + (childCount ? 1 : 0) + ')';
    var speakClick = 'groupMapSpeak(\'' + id + '\',\'' + escW + '\')';
    var rNode = isActive ? (COARSE ? 25 : 17) : (COARSE ? 22 : 15);
    // 分支徽标：沿径向排在单词文字外侧（动态距离）。先算文字沿径向的半宽/半高，
    // 徽标圆心放在"文字远端再往外固定空位"，词越长徽标随之外移，任何角度/词长都不压字；
    // 超长词贴近视口边缘时向内收，保证徽标不裁出画布
    var badgeSvg = '';
    if (childCount) {
      var hwB = String(w.word).length * (COARSE ? 3.6 : 2.9); // 与节点文字半宽估算保持一致
      var hhB = nodeFs / 2 + 1;                               // 文字半高(近似)
      var bNum = childCount > 9 ? '9+' : String(childCount);
      var bFs = COARSE ? 11 : (childCount > 9 ? 8 : 9);
      var bCol = isActive ? '#fff' : 'var(--green)';
      badgeSvg = '<text x="' + x2 + '" y="' + (y2 + 0.5) + '" text-anchor="middle" dominant-baseline="middle" font-size="' + Math.min(bFs, 10) + '" font-weight="700" style="fill:' + bCol + ';pointer-events:none">' + bNum + '</text>';
    }
    svg += '<g onclick="' + drillClick + '" style="cursor:pointer">' +
      '<title>' + tip + '</title>' +
      '<circle cx="' + x2 + '" cy="' + y2 + '" r="' + rNode + '" style="fill:' + (isActive ? 'var(--accent)' : 'var(--surface2)') + ';stroke:var(--accent)" stroke-width="' + (isActive ? 2.6 : 1.6) + '"/>' +
      badgeSvg +
      '</g>';
    var wText = String(w.word);  // 节点文字完整显示（位置已按词长外推且视口足够，不再截断）
    var tCol = isActive ? '#ffffff' : 'var(--text)';
    var tStk = isActive ? 'rgba(0,0,0,0.6)' : 'none';
    var tW = isActive ? '2.5' : '0';
    svg += '<text x="' + tx + '" y="' + ty + '" text-anchor="middle" dominant-baseline="middle" font-size="' + nodeFs + '" font-weight="' + (isActive ? 700 : 500) + '" paint-order="stroke" style="fill:' + tCol + ';stroke:' + tStk + ';stroke-width:' + tW + ';cursor:pointer" onclick="' + speakClick + '" title="' + tip.replace(/"/g, '&quot;') + '（点击朗读发音）">' + wText + '</text>';
  }
  svg += '</svg>';
  return svg;
}

function renderGroupMap(id) {
  var st = _gmapState[id];
  var map = window.__UNIT_MAPS_DATA__[st.unit][st.gid];
  var r = resolveMapPath(map, st.stack);
  var backBtn = st.stack.length ? '<button class="gmap-back" onclick="groupMapBack(\'' + id + '\')">← 返回上级</button>' : '';
  var title = '<div class="gmap-title">🗺️ 词群导图：' + map.group_name + '（点击圆圈展开 · 点击单词发音 · 点按看中文释义）</div>';
  var legend = '<div class="gmap-legend">' +
    '<span><span class="gl-leaf"><span class="gl-badge">3</span></span>有分支：数字=分支数，点击圆圈展开</span>' +
    '<span><span class="gl-leaf"></span>末端词：无分支</span>' +
    '</div>';
  return '<div class="gmap-wrap" id="' + id + '">' + title + backBtn + legend + buildMapSVG(id, map, r, st.active) + '</div>';
}

// 在导图数据中查找 word 的节点对象（含 meaning/phonetic），找不到返回 null
function gmapFindNodeObj(map, word) {
  var target = String(word).toLowerCase();
  function s(ns) {
    for (var i = 0; i < ns.length; i++) {
      var nd = ns[i];
      if (String(nd.word).toLowerCase() === target) return nd;
      if (nd.children) { var r = s(nd.children); if (r) return r; }
    }
    return null;
  }
  return s(map.level1Nodes || []);
}
// 手机端中文释义气泡：点击圆圈/单词时显示（替代桌面悬停），3.5 秒自动消失，点气泡可关闭
function gmapShowMeaning(nodeWord, map) {
  if (!('ontouchstart' in window) && !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) return;
  var tip = document.getElementById('gmapTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'gmapTip';
    tip.onclick = function() { tip.style.display = 'none'; };
    document.body.appendChild(tip);
  }
  var nd = map ? gmapFindNodeObj(map, nodeWord) : null;
  var meaning = nd ? nd.meaning : '';
  var phon = nd ? nd.phonetic : '';
  if (!meaning && !phon) return;
  var escT = function(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  tip.innerHTML = '<b>' + escT(nodeWord) + '</b>' + (phon ? ' <span class="gmt-ph">' + escT(phon) + '</span>' : '') +
    (meaning ? '<div class="gmt-m">' + escT(meaning) + '</div>' : '');
  tip.style.display = 'block';
  clearTimeout(gmapShowMeaning._t);
  gmapShowMeaning._t = setTimeout(function() { tip.style.display = 'none'; }, 3500);
}

// 点击节点圆圈：有分支→下钻展开；末端词（无分支）→朗读发音
function groupMapDrill(id, nodeWord, hasChildren) {
  var st = _gmapState[id];
  if (!st) return;
  if (hasChildren) {
    var map1 = window.__UNIT_MAPS_DATA__[st.unit][st.gid];
    gmapShowMeaning(nodeWord, map1);   // 下钻时显示所点词中文（手机端）
    st.stack.push(nodeWord);
    var el = document.getElementById(id);
    if (el) el.innerHTML = renderGroupMap(id);
  } else {
    speakWord(nodeWord);
    gmapShowMeaning(nodeWord, window.__UNIT_MAPS_DATA__[st.unit][st.gid]);   // 末端词朗读 + 中文
  }
}
// 点击节点单词文字：朗读发音 + 中文释义气泡（手机端）
function groupMapSpeak(id, nodeWord) {
  speakWord(nodeWord);
  var st = _gmapState[id];
  if (st) gmapShowMeaning(nodeWord, window.__UNIT_MAPS_DATA__[st.unit][st.gid]);
}
function groupMapBack(id) {
  var st = _gmapState[id];
  if (!st || !st.stack.length) return;
  st.stack.pop();
  var el = document.getElementById(id);
  if (el) el.innerHTML = renderGroupMap(id);
}

// 在导图数据中查找 word 的节点路径（一级→二级→…），找不到返回 null
function findMapNodePath(map, word) {
  var target = String(word).toLowerCase();
  function search(nodes, trail) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (String(n.word).toLowerCase() === target) return trail;
      if (n.children) {
        var r = search(n.children, trail.concat([n.word]));
        if (r) return r;
      }
    }
    return null;
  }
  return search(map.level1Nodes || [], []);
}

// 在 unit 的所有词群里查找 word 实际所在的词群（以书页导图划分为准；词库 group_id 可能与书页不一致）
// 返回 {gid, path}（path 为下钻路径，一级节点为 []），找不到返回 null
function findMapGroup(unitMap, word) {
  for (var gid in unitMap) {
    var path = findMapNodePath(unitMap[gid], word);
    if (path !== null) return { gid: gid, path: path };
  }
  return null;
}

// 入口：有词群数据的核心词，及重叠的打卡词，使用新版导图
function groupMapSVG(word) {
  // Unit 11-14 是按字母分组的基础词区，不属于任何词群，不渲染词群导图
  if (!word || Number(word.unit) > 10) return '';
  if (canUseNewMap(word)) {
    var unitMap = window.__UNIT_MAPS_DATA__[word.unit];
    // 做题词的实际词群按书页划分定位（不依赖词库 group_id），并自动下钻到其所在层
    var loc = findMapGroup(unitMap, word.word);
    // 词在书页导图数据里找不到 → 不显示新版词群导图（避免出现不含当前词的图），回退旧版（旧版含当前词）
    if (!loc) return currentPool === 'core' ? legacyGroupMapSVG(word) : '';
    var id = 'gmap-' + (++_gmapSeq);
    _gmapState[id] = { unit: word.unit, gid: loc.gid, stack: loc.path, active: word.word };
    return renderGroupMap(id);
  }
  if (currentPool !== 'core') return '';
  return legacyGroupMapSVG(word);
}

// 旧版：同词群单词的放射状关系图（中心=词群主题，节点=词）
function legacyGroupMapSVG(word) {
  // 导图内容：同 Unit+Lesson 中序号（seq）最接近当前词的词（书中相邻词群关系更准确）
  if (!word || Number(word.unit) > 10 || (!word.group_id && !word.lesson)) return '';
  var members = null;
  try {
    var pool = getActivePool();
    members = pool.filter(function(w) {
      return w.unit === word.unit && w.lesson === word.lesson && w.seq > 0 && w.word !== word.word;
    });
    // 同 Lesson 词不足时补同 Unit 的词
    if (members.length < 11) {
      members = pool.filter(function(w) {
        return w.unit === word.unit && w.seq > 0 && w.word !== word.word;
      });
    }
  } catch (e) {}
  if (!members || members.length < 2) return '';
  // 按 seq 与当前词的接近程度排序，取前后共 9 个（含当前词，节点稀疏避免文字重叠）
  members.sort(function(a, b) {
    return Math.abs((a.seq || 0) - (word.seq || 0)) - Math.abs((b.seq || 0) - (word.seq || 0));
  });
  members = members.slice(0, 8);
  members.push(word);
  members.sort(function(a, b) { return (a.seq || 0) - (b.seq || 0); });
  var n = members.length;
  var cx = 180, cy = 125, R = 58, textR = 114;
  var svg = '<svg viewBox="0 0 360 250" style="width:100%;max-width:360px;height:auto;display:block;margin:8px auto;">';
  // 连线（颜色用 style，CSS 变量在 attribute 中不生效）
  for (var i = 0; i < n; i++) {
    var ang = (2 * Math.PI * i / n) - Math.PI / 2;
    var x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
    svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '" stroke-width="1.2" style="stroke:var(--border)"/>';
  }
  // 中心圆 + 词群主题：短名单行；长名按显示宽度均衡断为两行（优先在空格/斜杠处断、避免字符被截碎，超两行容量截断），任一行不溢出中心圆(半径36)被节点圆遮挡
  var gname = String(word.group_name || '词群' + word.group_id);
  var gFS = 14, gMaxW = 56;
  function gCW(ch) { return (ch.charCodeAt(0) > 255 ? 1 : 0.55) * gFS; }
  function gW(s) { var r = 0; for (var k = 0; k < s.length; k++) r += gCW(s[k]); return r; }
  var gLines;
  if (gW(gname) <= gMaxW) {
    gLines = [gname];
  } else {
    var cut = 0;
    while (cut < gname.length && gW(gname.slice(0, cut + 1)) <= gMaxW * 2) cut++;
    var head = gname.slice(0, Math.max(cut, 1));
    var best = -1, bestScore = Infinity, bCut = -1, bScore = Infinity;
    for (var gk = 1; gk < head.length; gk++) {
      var lw = gW(head.slice(0, gk)), rw = gW(head.slice(gk));
      if (lw > gMaxW || rw > gMaxW) continue;
      var isB = (head[gk - 1] === ' ' || head[gk - 1] === '/' || head[gk] === ' ' || head[gk] === '/');
      var d = Math.abs(lw - rw);
      if (isB && d < bScore) { bScore = d; bCut = gk; }
      if (d < bestScore) { bestScore = d; best = gk; }
    }
    var pk = (bCut > 0) ? bCut : (best > 0 ? best : Math.ceil(head.length / 2));
    gLines = [head.slice(0, pk).trim(), head.slice(pk).trim()];
  }
  var centerText = '<text text-anchor="middle" dominant-baseline="middle" font-size="' + gFS + '" font-weight="700" style="fill:var(--text)">';
  var gY0 = cy - (gLines.length - 1) * 9;
  for (var gl = 0; gl < gLines.length; gl++) {
    centerText += '<tspan x="' + cx + '" y="' + (gY0 + gl * 18) + '">' + gLines[gl] + '</tspan>';
  }
  centerText += '</text>';
  svg += '<circle cx="' + cx + '" cy="' + cy + '" r="36" style="fill:var(--accent);opacity:0.15"/>' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="36" fill="none" stroke-width="1.8" style="stroke:var(--accent)"/>' + centerText;
  // 节点：所有圆大小统一（避免当前词大圆压到相邻圆），单词一律标注在圆外沿径向延伸，与圆完全分离（可读性优先），颜色用 style 保证 CSS 变量生效
  for (var j = 0; j < n; j++) {
    var w = members[j];
    var ang2 = (2 * Math.PI * j / n) - Math.PI / 2;
    var x2 = cx + R * Math.cos(ang2), y2 = cy + R * Math.sin(ang2);
    var tx = cx + textR * Math.cos(ang2), ty = cy + textR * Math.sin(ang2);
    var isCur = (w.word.toLowerCase() === word.word.toLowerCase());
    var wordText = String(w.word).slice(0, 11);
    // 当前词：实心紫圆+粗边表示位置，文字同样放圆外（白字紫描边保证浅底清晰），与圆零重叠
    svg += '<circle cx="' + x2 + '" cy="' + y2 + '" r="14" style="fill:' + (isCur ? 'var(--accent)' : 'var(--surface2)') + ';stroke:var(--accent);cursor:pointer" stroke-width="' + (isCur ? 2.4 : 1.6) + '" onclick="speakWord(\'' + String(w.word).replace(/'/g, "\\'") + '\')"/>' +
      '<text x="' + tx + '" y="' + ty + '" text-anchor="middle" dominant-baseline="middle" font-size="10.5" font-weight="' + (isCur ? 700 : 500) + '" paint-order="stroke" style="fill:' + (isCur ? '#ffffff' : 'var(--text)') + ';stroke:' + (isCur ? 'rgba(0,0,0,0.6)' : 'none') + ';stroke-width:' + (isCur ? '2.5' : '0') + '">' + wordText + '</text>';
  }
  svg += '</svg>';
  return '<div style="margin:10px 0 2px;font-size:0.85em;color:var(--text2);text-align:center;">🗺️ 词群导图（点击单词朗读）</div>' + svg;
}

// ============ RENDER QUIZ CARD ============
function questionProgressHTML() {
  if (!quizState || !quizState.ids || !quizState.ids.length) return '';
  var isMemory = !!quizState.isMemory;
  var memoryResults = isMemory && Array.isArray(quizState.memoryResults) ? quizState.memoryResults : [];
  var total = isMemory ? (quizState.memTotal || quizState.ids.length) : quizState.ids.length;
  var pos = quizState.pos;
  var completed = isMemory ? Math.min(total, memoryResults.length || quizState.done || 0) : 0;
  var activeIndex = isMemory ? (isAnswered(pos) ? Math.max(0, completed - 1) : completed) : pos;
  var dots = '';
  for (var i = 0; i < total; i++) {
    var status = '';
    if (isMemory) {
      if (memoryResults[i]) status = ' ' + memoryResults[i];
      if (i === activeIndex) status += ' current';
    } else {
      var answer = quizState.answers[i];
      if (isAnswered(i)) {
        completed++;
        if (answer === 'skip') status = ' skip';
        else if (typeof answer === 'object' && answer !== null && answer.gate1 !== undefined) status = answer.gate1 ? ' correct' : ' wrong';
        else status = isAnsweredCorrectly(i) ? ' correct' : ' wrong';
      }
      if (i === pos) status += ' current';
    }
    dots += '<span class="progress-dot' + status + '" title="第 ' + (i + 1) + ' 题"></span>';
  }
  return '<div class="question-progress" aria-label="答题进度">' +
    '<div class="progress-meta"><span>答题进度</span><strong>' + completed + ' / ' + total + ' 已完成</strong></div>' +
    '<div class="progress-viewport"><div class="progress-track">' + dots + '</div></div>' +
    '</div>';
}

function refreshQuestionProgress() {
  if (!quizActive) return;
  var current = document.querySelector('.question-progress');
  if (!current) return;
  var wrapper = document.createElement('div');
  wrapper.innerHTML = questionProgressHTML();
  var next = wrapper.firstElementChild;
  if (!next) return;
  // 整轮队列可能长达数千题，每答一题整段重建进度点有卡顿风险：
  // 点数一致时仅同步各点状态与文案，点数变化（新一轮队列）才整体替换。
  var curDots = current.querySelectorAll('.progress-dot');
  var nextDots = next.querySelectorAll('.progress-dot');
  if (curDots.length === nextDots.length) {
    for (var di = 0; di < nextDots.length; di++) {
      if (curDots[di].className !== nextDots[di].className) curDots[di].className = nextDots[di].className;
    }
    var curMeta = current.querySelector('.progress-meta');
    var nextMeta = next.querySelector('.progress-meta');
    if (curMeta && nextMeta) curMeta.replaceWith(nextMeta);
    scrollQuestionProgressToCurrent(current);
    return;
  }
  current.replaceWith(next);
  scrollQuestionProgressToCurrent(next);
}

// 横向进度条重建后，将当前题保持在可视区域中央；配合 .progress-track 的对称留白，首尾题也能居中。
// 滚动发生在 .progress-viewport 上，"X / N 已完成"文字（.progress-meta）固定不滚动。
function scrollQuestionProgressToCurrent(progressEl) {
  if (!progressEl) return;
  var viewport = progressEl.querySelector('.progress-viewport') || progressEl;
  var currentDot = progressEl.querySelector('.progress-dot.current');
  if (!currentDot) return;
  var viewportRect = viewport.getBoundingClientRect();
  var dotRect = currentDot.getBoundingClientRect();
  var dotCenter = dotRect.left - viewportRect.left + viewport.scrollLeft + dotRect.width / 2;
  var target = dotCenter - viewport.clientWidth / 2;
  var maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  viewport.scrollLeft = Math.max(0, Math.min(maxScroll, Math.round(target)));
}

// 将非全屏题卡滚到吸顶导航栏下方，避免手机端导航栏盖住题卡首行和全屏按钮。
function scrollQuizCardBelowTabs(card) {
  if (!card) return;
  var tabs = document.querySelector('.tabs');
  var tabsHeight = tabs ? Math.ceil(tabs.getBoundingClientRect().height) : 0;
  var topGap = tabsHeight + 12;
  var pageTop = card.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
  window.scrollTo(0, Math.max(0, pageTop - topGap));
}

function renderQuizCard() {
  // 新题开始后允许该题正常使用“不会，跳过”。
  var card = document.getElementById('quizCard');
  if (!quizActive || !quizState.current) {
    card.innerHTML = '<div class="empty"><div class="ei">🎯</div><p>点击下方按钮开始刷题</p></div>';
    document.getElementById('startBtn').style.display = 'inline-block';
    return;
  }

  var q = quizState.current;
  var mode = quizState.mode;
  var word = q.word;
  var labels = ['A', 'B', 'C', 'D'];
  var total = quizState.ids.length;
  var pos = quizState.pos;
  var answered = isAnswered(pos);
  var answerVal = quizState.answers[pos];
  var isSkip = answered && answerVal === 'skip';
  var correctHere = isAnsweredCorrectly(pos);
  var isFS = card.classList.contains('fullscreen');
  var fsText = isFS ? '⛶ 退出全屏' : '⛶ 全屏';
  var quizFavoriteHTML = favoriteButtonHTML(word, quizState.poolType || currentPool);


  // 题目：多词性单词的每个词性统一用 badge 渲染（如 [n.]股份 [v.]分享）
  var qText = word.word;
  if (mode === 'cn2en') {
    var posEntries = splitMeaning(word.meaning);
    qText = posEntries.length > 0
      ? posEntries.map(function(e) { return (e.pos ? '<span class="pos-badge">' + e.pos + '</span>' : '') + e.cn; }).join(' ')
      : getChineseFull(word.meaning);
    // 释义仍缺失时显示占位符，不把助记(memo)当题干
    if (!qText || !qText.replace(/<[^>]*>/g, '').trim()) {
      qText = '<span style="color:var(--text2);">(释义待补充)</span>';
    }
  }
  var qPron = (mode === 'en2cn' && word.pronunciation) ? word.pronunciation : '';
  var modeLabel = (mode === 'cn2en') ? '看中文选英文' : '看英文选中文';
  var typeLabel = (currentQuizType === 'dictation') ? ' · 默写' : '';
  var prefix = quizState.isMemory ? '🧠 [记忆] ' : (quizState.isReview ? '🧠 [复习] ' : (quizState.isSmart ? '🧠 [智能] ' : (quizState.isRetry ? '\u{1F504} [重做] ' : '')));

  // 导航条：记忆模式做完即删，不提供回看/跳转
  var navBar = quizState.isMemory ? '' :
    '<div class="quiz-nav" style="display:flex;align-items:center;justify-content:center;gap:8px;margin:2px 0 12px;">' +
    '<button class="ctrl-btn" id="prevQBtn" onclick="userPrev(event)" ' + (pos <= 0 ? 'disabled style="opacity:0.4"' : '') + '>◀ 上一题</button>' +
    '<span style="color:var(--text2);font-size:0.85em;white-space:nowrap;">第 <input type="number" id="jumpInput" value="' + (pos + 1) + '" min="1" max="' + total + '" style="width:56px;padding:3px 4px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);text-align:center;font-size:0.9em;" onkeydown="if(event.key===\'Enter\'){userJump(this.value);}"> / ' + total + ' 题</span>' +
    '<button class="ctrl-btn" id="nextQBtn" onclick="userAdvance(event)">下一题 ▶</button>' +
    '</div>';

  // 闯关1：词群速记检测（认识/不认识），只在选择题类型下启用
  if (quizState.gate === 1 && !quizState.isReview && !quizState.isMemory && !quizState.isRetry && currentQuizType === 'choice') {
    var gateAnswered = answered && answerVal && typeof answerVal === 'object' && answerVal.gate1 !== undefined;
    var know = gateAnswered ? answerVal.gate1 : null;
    var gGroupName = (word.group_name || word.group_id ? '词群 ' + (word.group_id || '?') + '「' + (word.group_name || '') + '」' : '') +
      (word.unit ? ' · Unit ' + word.unit : '') + (word.lesson ? ' · Lesson ' + word.lesson : '');
    // “认识”只展示中文释义并停留在当前词，避免直接跳过或展开其他解释。
    var gateResultHTML = '';
    if (gateAnswered) {
      if (know) {
        gateResultHTML = '<div class="feedback show ok" style="margin-top:14px;"><h4>✅ 已掌握</h4>' +
          '<div style="margin:6px 0;"><b>中文释义：</b>' + getChineseFull(word.meaning) + '</div></div>';
      } else {
        gateResultHTML = '<div class="feedback show fail" style="margin-top:14px;"><h4>❌ 未掌握</h4>' +
          '<div style="margin:6px 0;"><b>释义：</b>' + getChineseFull(word.meaning) + speakBtnFor(word, mode) + '</div>' +
          wrongOptionsHTML(q, mode, -1) +
          '</div>' + feedbackDetailsHTML(word, mode);
      }
    }
    var gHtml =
      '<div class="quiz-scroll">' +
      '<div class="quiz-top-row">' +
      '<div class="q-label">' + prefix + '🏰 闯关1 速记 · 第 ' + (pos + 1) + ' / ' + total + ' 词 · ' + modeLabel + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">' +
      '<button class="toggle-fs-btn" id="toggleFsBtn" onclick="(function(e){e.stopPropagation();toggleFullscreen();})(event)">' + fsText + '</button></div>' +
      '</div>' +
      navBar +
      questionProgressHTML() +
      (gGroupName ? '<div style="font-size:0.82em;color:var(--accent2);margin-bottom:10px;text-align:center;">📁 ' + gGroupName + '</div>' : '') +
      '<div class="word-info-row"><div class="word-info-main">' +
      '<div class="q-word" style="animation:slideUp 200ms cubic-bezier(0.4,0,0.2,1) both">' + word.word + '</div>' +
      (word.pronunciation ? '<div class="q-pron" style="animation:slideUp 200ms cubic-bezier(0.4,0,0.2,1) both">' + word.pronunciation + ' <span onclick="speakWord(\'' + word.word.replace(/'/g, "\\'") + '\')" style="cursor:pointer;font-size:1.2em;" title="朗读发音">\u{1F50A}</span></div>' : '') +
      '</div><div class="word-info-actions">' + quizFavoriteHTML + '</div></div>' +
      (know === false ? '<div style="text-align:center;margin:14px auto 4px;max-width:520px;padding:14px 18px;background:var(--surface2);border-radius:12px;border:1px solid var(--border);">' + getChineseFull(word.meaning) + '</div>' : '') +
      (gateAnswered ? '' : '<div style="display:flex;gap:10px;justify-content:center;margin-top:22px;">' +
        '<button class="gate1-btn ok" id="gateKnowBtn" onclick="handleGate1(true)">✅ 认识</button>' +
        '<button class="gate1-btn no" id="gateUnknownBtn" onclick="handleGate1(false)">❌ 不认识</button>' +
        '</div>') +
      gateResultHTML +
      '</div>' +
      '<div class="quiz-actions">' +
      '<button class="next-btn' + (gateAnswered ? ' show' : '') + '" id="nextBtn" onclick="userAdvance(event)">' + (gateAnswered ? (know ? '继续 →' : '下一词 →') : '') + '</button>' +
      '</div>';
    card.innerHTML = gHtml;
    document.getElementById('startBtn').style.display = 'none';
    try {
      var scrollEl = card.querySelector('.quiz-scroll');
      if (card.classList.contains('fullscreen') && scrollEl) scrollEl.scrollTop = 0;
      else scrollQuizCardBelowTabs(card);
    } catch (e) {}
    scrollQuestionProgressToCurrent(card.querySelector('.question-progress'));
    if (card.classList.contains('fullscreen')) {
      var gateLabel = card.querySelector('.q-label');
      if (gateLabel) gateLabel.textContent = '第 ' + (pos + 1) + ' / ' + total + ' 题';
    }
    return;
  }

  if (currentQuizType === 'dictation') {
    var placeholder = (mode === 'cn2en') ? '输入英文单词...' : '输入中文意思...';
    var dictInputHTML = '';
    if (answered && typeof answerVal === 'object' && answerVal !== null) {
      // 已提交的默写：显示原答案 + 判定
      var inpCls = answerVal.correct ? 'result-green' : (answerVal.close ? 'result-orange' : 'result-red');
      dictInputHTML =
        '<input type="text" class="dict-input ' + inpCls + '" value="' + answerVal.text.replace(/"/g, '&quot;') + '" disabled style="opacity:0.9">' +
        '<div class="feedback show ' + (answerVal.correct ? 'ok' : (answerVal.close ? 'close' : 'fail')) + '">' +
        '<h4>' + (answerVal.correct ? '\u2705 \u6B63\u786E\uFF01' : (answerVal.close ? '\uD83D\uDFE1 \u63A5\u8FD1\u6B63\u786E' : '\u274C \u9519\u8BEF')) + '</h4>' +
        '<div style="margin:6px 0;"><b>\u4F60\u7684\u7B54\u6848\uFF1A</b>' + answerVal.text + '</div>' +
        '<div style="margin:6px 0;"><b>\u6B63\u786E\u7B54\u6848\uFF1A</b>' + ((mode === 'cn2en') ? word.word : getChineseOptionText(word.meaning)) + speakBtnFor(word, mode) + '</div>' +
        '</div>' +
        feedbackDetailsHTML(word, mode);
    } else if (isSkip) {
      dictInputHTML =
        '<input type="text" class="dict-input result-orange" value="' + ((mode === 'cn2en') ? word.word : getChineseOptionText(word.meaning)) + '" disabled style="opacity:0.9">' +
        '<div class="feedback show close"><h4>\u{1F6AA} \u5DF2\u8DF3\u8FC7</h4><div style="margin:6px 0;"><b>\u6B63\u786E\u7B54\u6848\uFF1A</b>' + ((mode === 'cn2en') ? word.word : getChineseOptionText(word.meaning)) + speakBtnFor(word, mode) + '</div></div>' +
        feedbackDetailsHTML(word, mode);
    } else {
      dictInputHTML =
        '<input type="text" class="dict-input" id="dictInput" placeholder="' + placeholder + '" autocomplete="off" autofocus>' +
        '<div style="display:flex;gap:8px;margin-top:10px;justify-content:center;">' +
        '<button class="dict-submit-btn" id="dictSubmitBtn" onclick="handleDictationSubmit()">提交</button>' +
        '<button class="dict-submit-btn" id="handwriteBtn" onclick="openHandwritePad()" style="background:transparent;border:1px solid var(--accent);color:var(--accent);">✍️ 手写</button>' +
        '</div>' +
        '<button class="skip-btn" id="skipBtn" onclick="handleSkip(event)" style="display:block;margin:18px auto 0;padding:10px 26px;background:transparent;border:1px dashed var(--border);color:var(--text2);border-radius:20px;cursor:pointer;font-size:0.85em;">不会，跳过</button>' +
        '<div class="feedback" id="feedback"></div>';
    }

    card.innerHTML =
      '<div class="quiz-scroll">' +
      '<div class="quiz-top-row">' +
      '<div class="q-label">' + prefix + (quizState.isMemory ? '剩余 ' + quizState.ids.length + ' 词' : '第 ' + (pos + 1) + ' / ' + total + ' 题') + ' · ' + modeLabel + typeLabel + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">' +
      '<button class="toggle-fs-btn" id="toggleFsBtn" onclick="(function(e){e.stopPropagation();toggleFullscreen();})(event)">' + fsText + '</button></div>' +
      '</div>' +
      navBar +
      questionProgressHTML() +
      '<div class="word-info-row"><div class="word-info-main">' +
      '<div class="q-word" style="animation:slideUp 200ms cubic-bezier(0.4,0,0.2,1) both">' + qText + '</div>' +
      (qPron ? '<div class="q-pron" style="animation:slideUp 200ms cubic-bezier(0.4,0,0.2,1) both">' + qPron + ' <span onclick="speakWord(\'' + word.word.replace(/'/g, "\\'") + '\')" style="cursor:pointer;font-size:1.2em;" title="朗读发音">\u{1F50A}</span></div>' : '') +
      '</div><div class="word-info-actions">' + quizFavoriteHTML + '</div></div>' +
      (mode === 'en2cn' && !qPron ? pronPracticePillRow(word.word, word.pronunciation) : '') +
      dictInputHTML +
      '</div>' +
      '<div class="quiz-actions">' +
      '<button class="next-btn" id="nextBtn" onclick="userAdvance(event)" ' + (answered || isSkip ? 'class="next-btn show"' : 'class="next-btn"') + '>' + (quizState.isMemory ? '继续学习 →' : '下一题 →') + '</button>' +
      '</div>';

    if (!answered && !isSkip) {
      setTimeout(function() {
        var inp = document.getElementById('dictInput');
        if (inp) {
          inp.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') handleDictationSubmit();
          });
          // Do not restore focus while the page is backgrounded: mobile
          // browsers may defer this timer until app return and reopen the
          // keyboard, replaying a stale key event against the new question.
          if (document.hidden || (document.visibilityState && document.visibilityState !== 'visible')) return;
          try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
        }
      }, 50);
    }
  } else {
    var optHTML = '';
    var delays = [0, 60, 120, 180];
    for (var i = 0; i < q.options.length; i++) {
      var o = q.options[i];
      var txt = (mode === 'cn2en') ? o.word : (getChineseOptionText(o.meaning) || '(释义待补充)');
      var posHTML = optionPosHTML(o, mode);
      var extra = (mode === 'cn2en') ? posHTML + ((o.pronunciation) ? ' <span style="color:var(--text2);font-size:0.85em;">' + o.pronunciation + '</span>' : '') : '';
      if (mode === 'en2cn') txt = posHTML + txt;
      var cls = 'opt-btn';
      if (answered || isSkip) {
        cls += i === q.correctIndex ? ' correct' : '';
        if (typeof answerVal === 'number' && i === answerVal && i !== q.correctIndex) cls += ' wrong';
      } else {
        cls += ' opt-entering';
      }
      optHTML += '<button class="' + cls + '" data-index="' + i + '" id="opt-' + i + '" style="animation-delay:' + delays[i] + 'ms"' +
        (answered || isSkip ? ' disabled' : '') +
        ' aria-label="' + labels[i] + ': ' + txt.replace(/<[^>]*>/g, '').replace(/"/g, '&quot;') + '">' +
        '<span class="ol" aria-hidden="true">' + labels[i] + '</span><span>' + txt + extra + '</span></button>';
    }

    var fbHTML = '<div class="feedback" id="feedback"></div>';
    if (answered || isSkip) {
      fbHTML = '<div class="feedback show ' + (isSkip ? 'close' : (correctHere ? 'ok' : 'fail')) + '">' +
        '<h4>' + (isSkip ? '\u{1F6AA} \u5DF2\u8DF3\u8FC7' : (correctHere ? '\u2705 \u56DE\u7B54\u6B63\u786E\uFF01' : '\u274C \u56DE\u7B54\u9519\u8BEF')) + '</h4>' +
        '<div style="margin:6px 0;"><b>\u6B63\u786E\u7B54\u6848\uFF1A</b>' + ((mode === 'cn2en') ? word.word : getChineseOptionText(word.meaning)) + speakBtnFor(word, mode) + '</div>' +
        (correctHere ? '' : wrongOptionsHTML(q, mode, answerVal)) +
        '</div>';
    }

    card.innerHTML =
      '<div class="quiz-scroll">' +
      '<div class="quiz-top-row">' +
      '<div class="q-label">' + prefix + (quizState.isMemory ? '剩余 ' + quizState.ids.length + ' 词' : '第 ' + (pos + 1) + ' / ' + total + ' 题') + ' · ' + modeLabel + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">' +
      '<button class="toggle-fs-btn" id="toggleFsBtn" onclick="(function(e){e.stopPropagation();toggleFullscreen();})(event)">' + fsText + '</button></div>' +
      '</div>' +
      navBar +
      questionProgressHTML() +
      '<div class="word-info-row"><div class="word-info-main">' +
      '<div class="q-word" style="animation:slideUp 200ms cubic-bezier(0.4,0,0.2,1) both">' + qText + '</div>' +
      (qPron ? '<div class="q-pron" style="animation:slideUp 200ms cubic-bezier(0.4,0,0.2,1) both">' + qPron + '</div>' : '') +
      '</div><div class="word-info-actions">' + quizFavoriteHTML + '</div></div>' +
      (mode === 'en2cn' ? pronPracticePillRow(word.word, word.pronunciation) : '') +
      '<div class="options">' + optHTML + '</div>' +
      fbHTML +
      (answered || isSkip ? feedbackDetailsHTML(word, mode) : '') +
      '</div>' +
      '<div class="quiz-actions">' +
      (answered || isSkip ? '' : '<button class="skip-btn" id="skipBtn" onclick="handleSkip(event)" style="display:block;margin:22px auto 0;padding:10px 26px;background:transparent;border:1px dashed var(--border);color:var(--text2);border-radius:20px;cursor:pointer;font-size:0.85em;">不会，跳过</button>') +
      '<button class="next-btn' + (answered || isSkip ? ' show' : '') + '" id="nextBtn" onclick="userAdvance(event)">' + (quizState.isMemory ? '继续学习 →' : '下一题 →') + '</button>' +
      '</div>';

    card.querySelectorAll('.opt-btn').forEach(function(btn) {
      btn.addEventListener('click', function(ev) {
        if (!gestureAllows(ev)) return;   // 文档级闸门已拦过一道，这里兜底
        spendGesture();
        handleAnswer(parseInt(this.dataset.index));
      });
    });
    // Remove opt-entering after animation completes (animationend, not setTimeout)
    var animOpts = card.querySelectorAll('.opt-entering');
    if (animOpts.length > 0) {
      animOpts[animOpts.length - 1].addEventListener('animationend', function() {
        card.querySelectorAll('.opt-btn').forEach(function(o) { o.classList.remove('opt-entering'); });
      }, { once: true });
    }
  }

  // 全屏窄屏顶部只保留题号，避免复习/智能/闯关等上下文标签撑高选项区域。
  if (card.classList.contains('fullscreen')) {
    var compactLabel = card.querySelector('.q-label');
    if (compactLabel) compactLabel.textContent = quizState.isMemory
      ? ('剩余 ' + quizState.ids.length + ' 词')
      : ('第 ' + (pos + 1) + ' / ' + total + ' 题');
  }
  document.getElementById('startBtn').style.display = 'none';

  // 翻题/切题后回到题目顶部，避免停留在上一题的滚动位置
  try {
    var scrollEl = card.querySelector('.quiz-scroll');
    if (card.classList.contains('fullscreen') && scrollEl) {
      scrollEl.scrollTop = 0;
    } else {
      scrollQuizCardBelowTabs(card);
    }
  } catch (e) {}
  scrollQuestionProgressToCurrent(card.querySelector('.question-progress'));
  bindQuizSwipe(card);
}

// Mobile navigation: horizontal swipes anywhere on the quiz card switch questions
// (fullscreen or not) while vertical scrolling, option taps, inputs, maps and
// canvases keep their native behaviour. Memory mode is excluded: finishing a
// question removes it from the queue, so a swipe must not skip it. The listener
// is bound once because the quiz card's innerHTML is replaced on every question.
function bindQuizSwipe(card) {
  if (!card || card._quizSwipeBound) return;
  card._quizSwipeBound = true;
  var start = null;
  function blockedTarget(target) {
    return !!(target && target.closest &&
      target.closest('button,input,textarea,select,a,canvas,.gmap-wrap,.question-progress,.skip-btn'));
  }
  function blockedPoint(point) {
    if (!point || !document.elementFromPoint) return false;
    return blockedTarget(document.elementFromPoint(point.clientX, point.clientY));
  }
  card.addEventListener('touchstart', function(e) {
    start = null;
    if (!quizActive || quizState.isMemory || e.touches.length !== 1) return;
    var g = _gesture;
    if (!g || g.stale) return;       // 切后台补发的旧触摸不作为滑动手势起点
    if (blockedTarget(e.target)) return;
    var t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, at: perfNow(), blocked: blockedPoint(t) };
  }, { passive: true });
  card.addEventListener('touchmove', function(e) {
    if (!start || e.touches.length !== 1) return;
    var t = e.touches[0];
    if (blockedTarget(e.target) || blockedPoint(t)) start.blocked = true;
  }, { passive: true });
  card.addEventListener('touchend', function(e) {
    var s = start;
    start = null;
    if (!s || e.changedTouches.length !== 1) return;
    if (!quizActive || quizState.isMemory) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - s.x;
    var dy = t.clientY - s.y;
    if (s.blocked || blockedTarget(e.target) || blockedPoint(t)) return;
    if (perfNow() - s.at > 700) return;                                  // 长按不当作滑动
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.3) return;  // 未达阈值 / 以竖向滚动为主
    if (!gestureAllows(e, { allowMoved: true })) return;                 // 统一手势闸门
    spendGesture();
    e.preventDefault();
    // 右滑回上一题、左滑到下一题（与题卡滚动方向一致）
    if (dx > 0) prevQuestion(); else advanceQuestion();
  }, { passive: false });
}

function recordStat(word, mode, isCorrect, isClose, isDictation) {
  var st = state.stats;
  var statPool = (quizState && quizState.poolType) || currentPool || 'core';
  st.totalAttempts++;
  st[mode].attempts++;
  if (isDictation) {
    st.dictation.attempts++;
    st[mode + '_dict'].attempts++;
  }
  if (isCorrect) {
    st.totalCorrect++;
    st[mode].correct++;
    if (isDictation) {
      st.dictation.correct++;
      st[mode + '_dict'].correct++;
    }
    st.streak.current++;
    if (st.streak.current > st.streak.best) st.streak.best = st.streak.current;
  } else {
    st.totalWrong++;
    st[mode].wrong++;
    if (isDictation) {
      st.dictation.wrong++;
      st[mode + '_dict'].wrong++;
      if (isClose) {
        st.dictation.close++;
        st[mode + '_dict'].close++;
      }
    }
    st.streak.current = 0;
  }

  var today = localDateKey(new Date());
  if (!st.dailyHistory[today]) {
    st.dailyHistory[today] = { attempts: 0, correct: 0, wrong: 0, dict_attempts: 0, dict_correct: 0 };
  }
  st.dailyHistory[today].attempts++;
  if (isDictation) {
    st.dailyHistory[today].dict_attempts = (st.dailyHistory[today].dict_attempts || 0) + 1;
    if (isCorrect) st.dailyHistory[today].dict_correct = (st.dailyHistory[today].dict_correct || 0) + 1;
  }
  if (isCorrect) st.dailyHistory[today].correct++;
  else st.dailyHistory[today].wrong++;

  var waKey = wordStateKey(word.id, statPool);
  var wa = st.wordAttempts[waKey];
  if (!wa) { wa = st.wordAttempts[waKey] = { attempts: 0, correct: 0, wrong: 0 }; }
  wa.attempts++;
  if (isCorrect) wa.correct++;
  else wa.wrong++;
  // ===== 双书记忆调度 =====
  var _now = Date.now();
  if (!wa.learnedAt) wa.learnedAt = _now; // 首次作答时间（8格周期起点）
  if (isGridPool(statPool)) {
    if (!wa.grid) wa.grid = [0, 0, 0, 0, 0, 0, 0];
    // Both review entry points share one chained stage transition.
    if (quizState && (quizState.isReview || quizState.isMemory)) advanceFullGridReview(wa, isCorrect, _now);
  }
  wa.lastTime = _now; // 兼容旧逻辑
}

function handleDictationSubmit() {
  if (!quizActive || !quizState.current) return;
  if (isAnswered(quizState.pos)) return; // 已答题不可重复作答
  var _skipBtn0 = document.getElementById('skipBtn');
  if (_skipBtn0) _skipBtn0.style.display = 'none'; // 提交后隐藏"不会，跳过"

  var q = quizState.current;
  var word = q.word;
  var mode = quizState.mode;
  var input = document.getElementById('dictInput');
  if (!input) return;
  var userAnswer = input.value.trim();
  if (!userAnswer) return;
  input.disabled = true;
  document.getElementById('dictSubmitBtn').disabled = true;

  var isCorrect = false;
  var isClose = false;

  if (mode === 'cn2en') {
    var correctEng = word.word.trim().toLowerCase();
    var userEng = userAnswer.toLowerCase().replace(/[^a-zA-Z\-']/g, '');
    if (userEng === correctEng) {
      isCorrect = true;
    } else {
      var dist = levenshtein(userEng, correctEng);
      if (dist <= 2 && userEng.length >= 2) {
        isClose = true;
      }
    }
  } else {
    var correctCn = getChinese(word.meaning);
    var cnChars = correctCn.replace(/[^\u4e00-\u9fff]/g, '');
    var userCnChars = userAnswer.replace(/[^\u4e00-\u9fff]/g, '');
    if (cnChars.length > 0 && userCnChars.length > 0) {
      // Bigram overlap for order-sensitive matching
      var cnBigrams = {};
      for (var ci = 0; ci < cnChars.length - 1; ci++) {
        var bg = cnChars[ci] + cnChars[ci + 1];
        cnBigrams[bg] = (cnBigrams[bg] || 0) + 1;
      }
      var overlap = 0, totalBigrams = 0;
      var ubgSeen = {};
      for (var ui = 0; ui < userCnChars.length - 1; ui++) {
        var uBg = userCnChars[ui] + userCnChars[ui + 1];
        totalBigrams++;
        if (cnBigrams[uBg] && !ubgSeen[uBg]) {
          overlap++;
          ubgSeen[uBg] = true;
        }
      }
      var bigramScore = totalBigrams > 0 ? overlap / Math.max(totalBigrams, cnChars.length - 1) : 0;
      if (bigramScore >= 0.8) isCorrect = true;
      else if (bigramScore >= 0.4) isClose = true;
    } else if (userAnswer === correctCn) {
      isCorrect = true;
    }
  }

  quizState.done++;
  if (quizState.isMemory && !isCorrect) quizState.memWrong++;
  quizState.answers[quizState.pos] = { text: userAnswer, correct: isCorrect, close: isClose };
  recordMemoryProgress(isCorrect ? 'correct' : 'wrong');
  recordStat(word, mode, isCorrect, isClose, true);
  trackEbbingPlanQuestion(word);

  var correctAnswerText = (mode === 'cn2en') ? word.word : getChineseOptionText(word.meaning);
  var now = nowStr();

  if (!isCorrect) {
    state.wrongHistory.unshift({
      wordId: word.id, pool: (quizState.poolType || currentPool), mode: mode, timestamp: now, type: 'dictation',
      questionText: (mode === 'cn2en') ? getChineseFull(word.meaning) : word.word,
      userAnswer: userAnswer, correctAnswer: correctAnswerText,
      isClose: isClose
    });
    if (!state.wrongWordIds[wwKey(mode)]) state.wrongWordIds[wwKey(mode)] = {};
    state.wrongWordIds[wwKey(mode)][word.id] = true;
  }

  if (quizState.isRetry) {
    var existingRetries = state.retryHistory.filter(function(h) { return h.wordId === word.id && recordPool(h) === (quizState.poolType || currentPool) && h.mode === mode; }).length;
    state.retryHistory.unshift({
      wordId: word.id, pool: (quizState.poolType || currentPool), mode: mode, timestamp: now,
      questionText: (mode === 'cn2en') ? getChineseFull(word.meaning) : word.word,
      userAnswer: userAnswer, correctAnswer: correctAnswerText,
      isCorrect: isCorrect, isClose: isClose, type: 'dictation',
      attemptNum: existingRetries + 1
    });
    if (isCorrect) { delete state.wrongWordIds[wwKey(mode)][word.id]; }
  }

  saveActiveQuizProgress();
  checkDailyGoal();

  // Dictation input result color animation
  var dictInp = document.getElementById('dictInput');
  if (dictInp) {
    var inpCls = isCorrect ? 'result-green' : (isClose ? 'result-orange' : 'result-red');
    dictInp.classList.add(inpCls);
    setTimeout(function() { dictInp.classList.remove(inpCls); }, 500);
  }

  var fb = document.getElementById('feedback');
  var resultLabel = isCorrect ? '\u2705 \u6B63\u786E\uFF01' : (isClose ? '\uD83D\uDFE1 \u63A5\u8FD1\u6B63\u786E' : '\u274C \u9519\u8BEF');
  var resultClass = isCorrect ? 'ok' : (isClose ? 'close' : 'fail');

  fb.className = 'feedback show ' + resultClass;
  fb.innerHTML =
    '<h4>' + resultLabel + '</h4>' +
    '<div style="margin:6px 0;"><b>\u4F60\u7684\u7B54\u6848\uFF1A</b>' + userAnswer + '</div>' +
    '<div style="margin:6px 0;"><b>\u6B63\u786E\u7B54\u6848\uFF1A</b>' + correctAnswerText + speakBtnFor(word, mode) + '</div>' +
    (isClose ? '<div style="margin:6px 0;color:var(--text2);">\u63D0\u793A\uFF1A\u62FC\u5199\u63A5\u8FD1\uFF0C\u7EE7\u7EED\u52A0\u6CB9\uFF01</div>' : '');
  appendFeedbackDetails(fb, word, mode);

  document.getElementById('nextBtn').classList.add('show');
  refreshQuestionProgress();
  renderAll();
}
// 闯关1速记：认识后显示中文释义并等待手动继续；不认识显示讲解。
function handleGate1(know) {
  if (!quizActive || !quizState.current) return;
  if (isAnswered(quizState.pos)) return;
  var q = quizState.current;
  var word = q.word;
  var mode = quizState.mode;
  quizState.done++;
  quizState.answers[quizState.pos] = { gate1: !!know };
  recordMemoryProgress(know ? 'correct' : 'wrong');
  recordStat(word, mode, !!know, false, false);
  trackEbbingPlanQuestion(word);
  if (know) {
    // 认识：停留在当前词，直接显示中文释义，等待用户手动继续。
    saveActiveQuizProgress();
    checkDailyGoal();
    renderQuizCard();
    renderAll();
    return;
  }
  if (!know) {
    var now = nowStr();
    var labels = ['A', 'B', 'C', 'D'];
    state.wrongHistory.unshift({
      wordId: word.id, pool: (quizState.poolType || currentPool), mode: mode, timestamp: now,
      questionText: word.word,
      userAnswer: '不认识', correctAnswer: getChineseFull(word.meaning),
      options: []
    });
    if (!state.wrongWordIds[wwKey(mode)]) state.wrongWordIds[wwKey(mode)] = {};
    state.wrongWordIds[wwKey(mode)][word.id] = true;
  }
  saveActiveQuizProgress();
  checkDailyGoal();
  renderQuizCard();
  renderAll();
}

function handleAnswer(chosenIndex) {
  if (!quizActive || !quizState.current) return;
  if (isAnswered(quizState.pos)) return; // 已答题不可重复作答
  var _skipBtn0 = document.getElementById('skipBtn');
  if (_skipBtn0) _skipBtn0.style.display = 'none'; // 答题后隐藏"不会，跳过"

  var q = quizState.current;
  var word = q.word;
  var mode = quizState.mode;
  var isCorrect = (chosenIndex === q.correctIndex);
  var now = nowStr();
  var labels = ['A', 'B', 'C', 'D'];

  quizState.done++;
  if (quizState.isMemory && !isCorrect) quizState.memWrong++;
  quizState.answers[quizState.pos] = chosenIndex;
  recordMemoryProgress(isCorrect ? 'correct' : 'wrong');
  if (quizState.isReview) quizState.reviewCorrect = (quizState.reviewCorrect || 0) + (isCorrect ? 1 : 0);

  // Disable buttons & highlight
  document.querySelectorAll('.opt-btn').forEach(function(b) { b.disabled = true; });
  var correctBtn = document.getElementById('opt-' + q.correctIndex);
  correctBtn.classList.add('correct', 'opt-flash-green');
  setTimeout(function() { correctBtn.classList.remove('opt-flash-green'); }, 300);
  if (!isCorrect) {
    var wrongBtn = document.getElementById('opt-' + chosenIndex);
    wrongBtn.classList.add('wrong', 'opt-shake');
    setTimeout(function() { wrongBtn.classList.remove('opt-shake'); }, 400);
  }

  recordStat(word, mode, isCorrect, false, false);
  trackEbbingPlanQuestion(word);

  var userAnswerText = (mode === 'cn2en') ? q.options[chosenIndex].word : getChineseOptionText(q.options[chosenIndex].meaning);
  var correctAnswerText = (mode === 'cn2en') ? word.word : getChineseOptionText(word.meaning);

  // Record wrong
  if (!isCorrect) {
    state.wrongHistory.unshift({
      wordId: word.id, pool: (quizState.poolType || currentPool), mode: mode, timestamp: now,
      questionText: (mode === 'cn2en') ? getChineseFull(word.meaning) : word.word,
      userAnswer: userAnswerText, correctAnswer: correctAnswerText,
      options: q.options.map(function(o, i) { return { label: labels[i], text: (mode === 'cn2en') ? o.word : getChineseOptionText(o.meaning), isCorrect: i === q.correctIndex }; })
    });
    if (!state.wrongWordIds[wwKey(mode)]) state.wrongWordIds[wwKey(mode)] = {};
    state.wrongWordIds[wwKey(mode)][word.id] = true;
  }

  // Retry tracking
  if (quizState.isRetry) {
    var existingRetries = state.retryHistory.filter(function(h) { return h.wordId === word.id && recordPool(h) === (quizState.poolType || currentPool) && h.mode === mode; }).length;
    state.retryHistory.unshift({
      wordId: word.id, pool: (quizState.poolType || currentPool), mode: mode, timestamp: now,
      questionText: (mode === 'cn2en') ? getChineseFull(word.meaning) : word.word,
      userAnswer: userAnswerText, correctAnswer: correctAnswerText,
      isCorrect: isCorrect,
      options: q.options.map(function(o, i) { return { label: labels[i], text: (mode === 'cn2en') ? o.word : getChineseOptionText(o.meaning), isCorrect: i === q.correctIndex }; }),
      attemptNum: existingRetries + 1
    });
    if (isCorrect) { delete state.wrongWordIds[wwKey(mode)][word.id]; }
  }

  saveActiveQuizProgress();
  checkDailyGoal();

  // Feedback
  var fb = document.getElementById('feedback');
  fb.className = 'feedback show ' + (isCorrect ? 'ok' : 'fail');
  fb.innerHTML =
    '<h4>' + (isCorrect ? '✅ 回答正确！' : '❌ 回答错误') + '</h4>' +
    '<div style="margin:6px 0;"><b>题目：</b>' + (mode === 'cn2en' ? getChineseFull(word.meaning) : word.word) + '</div>' +
    '<div style="margin:6px 0;"><b>正确答案：</b>' + (mode === 'cn2en' ? word.word : getChineseOptionText(word.meaning)) + speakBtnFor(word, mode) + '</div>' +
    (isCorrect ? '' : wrongOptionsHTML(q, mode, chosenIndex));
  appendFeedbackDetails(fb, word, mode);

  document.getElementById('nextBtn').classList.add('show');
  refreshQuestionProgress();
  renderAll();
}

// ============ RENDER ALL ============
function renderAll() {
  renderQuizStats();
  renderWrongHistory();
  renderFavorites();
  renderRetryHistory();
  renderStatsPage();
  renderReviewBar();
  renderEbbingPlan();
}

function renderReviewBar() {
  var bar = document.getElementById('reviewBar');
  if (!bar) return;
  if (quizActive && (quizState.isReview || quizState.isMemory)) { bar.classList.remove('show'); return; }
  var infoEl = document.getElementById('reviewInfo');
  if (isGridPool(currentPool)) {
    var n = dueWordsByGrid(currentPool).length;
    if (n > 0) {
      infoEl.textContent = poolLabel(currentPool) + '今天有 ' + n + ' 个单词到期复习（8格打卡：5分/30分/12时/1天/2天/4天/7天）';
      bar.classList.add('show');
    } else {
      bar.classList.remove('show');
    }
  } else {
    if (!state.ebbingActive) { bar.classList.remove('show'); return; }  // 纯刷题：不提醒 ebbing 复习
    var dueUnits = dueUnitsByEbbing();
    if (dueUnits.length > 0) {
      infoEl.textContent = '大纲词汇 4周25天计划今天待学习/复习：Unit ' + dueUnits.join('、');
      bar.classList.add('show');
    } else {
      bar.classList.remove('show');
    }
  }
}

// 大纲词汇：按书 4周25天打卡表的每日学习计划提示
function renderEbbingPlan(now) {
  var el = document.getElementById('ebbingPlan');
  if (!el) return;
  if (currentPool !== 'core') { el.style.display = 'none'; return; }

  // —— 未激活：纯刷题模式，显示「开始打卡表」入口 ——
  if (!state.ebbingActive) {
    el.innerHTML =
      '<button class="ctrl-btn accent" onclick="activateEbbing()" ' +
      'style="font-size:0.85em;padding:4px 12px;">▶ 开始 4周25天打卡表</button>' +
      '<span style="color:var(--text2);margin-left:6px;">大纲词汇 Unit 1-14「4周25天计划」 · 复习计划未开启（纯刷题）</span>';
    el.style.display = 'block';
    return;
  }

  // —— 激活：显示每日计划 + 停止按钮 ——
  var dayN = ebbingDayIndex(now);
  if (!dayN) { el.style.display = 'none'; return; }
  var todayUnit = ebbingTodayNewUnit(state.ebbingPlan);
  var due = dueUnitsByEbbing(now);
  var txt = '📖 大纲词汇「4周25天计划」第 ' + dayN + ' 天：';
  if (todayUnit) txt += '今天该学 Unit ' + todayUnit;
  else txt += '新词已学完（Unit 1-14），按表继续复习';
  if (state.ebbingPlan && state.ebbingPlan.dayKey && state.ebbingPlan.dayKey !== dayKeyStr(now)) {
    txt += ' · ⏳ 该日计划尚未完成，进度延续中（不清空、完成后才进入下一天）';
  }
  if (due.length) txt += ' · 待学习/复习 Unit ' + due.join('、');
  if (isEbbingPlanComplete(state.ebbingPlan)) txt += ' · 当天目标已完成';
  el.innerHTML = txt +
    '<button class="ctrl-btn" onclick="stopEbbing()" ' +
    'style="font-size:0.75em;padding:2px 8px;margin-left:8px;">⏹ 停止打卡表</button>';
  el.style.display = 'block';
}

// 手动开启 4周25天打卡表：当天设为起始日
function activateEbbing() {
  if (state.ebbingActive) return;
  state.ebbingActive = true;
  state.ebbingStart = dayKeyStr(new Date());
  state.ebbingPlan = { day: 1, dayKey: state.ebbingStart, completedUnits: [] };
  saveState();
  renderAll();
}

// 手动停止 4周25天打卡表：清除起始日与进度，回到纯刷题
function stopEbbing() {
  if (!confirm('停止 4周25天打卡表？将清除打卡起始日与复习进度，之后可随时重新开始。')) return;
  state.ebbingActive = false;
  state.ebbingStart = null;
  state.ebbingUnitLog = {};
  state.ebbingPlan = null;
  saveState();
  renderAll();
}

function renderQuizStats() {
  var c = document.getElementById('quizStats');
  var st = state.stats;
  var total = st.totalAttempts, correct = st.totalCorrect, wrong = st.totalWrong;
  var rate = total > 0 ? Math.round(correct / total * 100) : 0;
  c.innerHTML =
    '<div class="sc"><div class="sv" style="color:var(--green)">' + rate + '%</div><div class="sl">正确率</div></div>' +
    '<div class="sc"><div class="sv" style="color:var(--blue)">' + total + '</div><div class="sl">总题数</div></div>' +
    '<div class="sc"><div class="sv" style="color:var(--green)">' + correct + '</div><div class="sl">正确</div></div>' +
    '<div class="sc"><div class="sv" style="color:var(--red)">' + wrong + '</div><div class="sl">错误</div></div>' +
    '<div class="sc"><div class="sv" style="color:var(--orange)">' + st.streak.current + '</div><div class="sl">当前连对</div></div>' +
    '<div class="sc"><div class="sv" style="color:#a78bfa">' + st.streak.best + '</div><div class="sl">最佳连对</div></div>';
}

function renderWrongHistory() {
  var container = document.getElementById('wrongHistory');
  var countEl = document.getElementById('wrongCount');
  var hist = state.wrongHistory;
  var query = (document.getElementById('wrongSearch').value || '').toLowerCase().trim();

  var filtered = hist;
  if (query) {
    filtered = hist.filter(function(item) {
      var w = recordWord(item);
      if (!w) return false;
      return w.word.toLowerCase().indexOf(query) !== -1 ||
             getChinese(w.meaning).indexOf(query) !== -1 ||
             item.questionText.toLowerCase().indexOf(query) !== -1;
    });
  }

  countEl.textContent = hist.length + ' 条' + (query ? '（筛选 ' + filtered.length + ' 条）' : '');

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty"><div class="ei">' + (query ? '🔍' : '🎉') + '</div><p>' + (query ? '没有匹配的错题记录' : '还没有错题，继续加油！') + '</p></div>';
    return;
  }

  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var item = filtered[i];
    var w = recordWord(item);
    var idx = hist.indexOf(item);
    var isDict = item.type === 'dictation';
    var actionLabel = isDict ? '你写' : '你选';
    html +=
      '<div class="hi">' +
      '<div>' + (isDict ? '<span class="badge rb">默写</span> ' : '') +
      '<span class="badge wb">错题 #' + (hist.length - idx) + '</span> ' +
      '<span class="hw">' + (w ? w.word : '?') + '</span> ' +
      '<span style="color:var(--text2);">' + (item.mode === 'cn2en' ? '🇨🇳→🇬🇧' : '🇬🇧→🇨🇳') + '</span></div>' +
      '<div class="hd">📝 ' + item.questionText + ' → ' + actionLabel + '：<span style="color:var(--red);">' + item.userAnswer + '</span> → 正确：<span style="color:var(--green);">' + item.correctAnswer + '</span></div>' +
      '<div class="ht">🕐 ' + item.timestamp + '</div>' +
      '</div>';
  }
  container.innerHTML = html;
}

function renderRetryHistory() {
  var container = document.getElementById('retryHistory');
  var countEl = document.getElementById('retryCount');
  var hist = state.retryHistory;
  var query = (document.getElementById('retrySearch').value || '').toLowerCase().trim();

  var filtered = hist;
  if (query) {
    filtered = hist.filter(function(item) {
      var w = recordWord(item);
      if (!w) return false;
      return w.word.toLowerCase().indexOf(query) !== -1 ||
             getChinese(w.meaning).indexOf(query) !== -1 ||
             item.questionText.toLowerCase().indexOf(query) !== -1;
    });
  }

  countEl.textContent = hist.length + ' 条' + (query ? '（筛选 ' + filtered.length + ' 条）' : '');

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty"><div class="ei">' + (query ? '🔍' : '📭') + '</div><p>' + (query ? '没有匹配的重做记录' : '还没有重做记录') + '</p></div>';
    return;
  }

  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var item = filtered[i];
    var w = recordWord(item);
    var isDict = item.type === 'dictation';
    var actionLabel = isDict ? '你写' : '你选';
    html +=
      '<div class="hi retry">' +
      '<div>' + (isDict ? '<span class="badge rb">默写</span> ' : '') +
      '<span class="badge rb">重做</span> <span class="hw">' + (w ? w.word : '?') + '</span> ' +
      '<span style="color:var(--text2);">· 第' + (item.attemptNum || 1) + '次重做</span> ' +
      (item.isCorrect ? '✅' : (item.isClose ? '🟡' : '❌')) + '</div>' +
      '<div class="hd">📝 ' + item.questionText + ' → ' + actionLabel + '：<span style="color:' + (item.isCorrect ? 'var(--green)' : (item.isClose ? 'var(--orange)' : 'var(--red)')) + ';">' + item.userAnswer + '</span> → 正确：<span style="color:var(--green);">' + item.correctAnswer + '</span></div>' +
      '<div class="ht">🕐 ' + item.timestamp + '</div>' +
      '</div>';
  }
  container.innerHTML = html;
}

function renderStatsPage() {
  if (document.getElementById('tab-stats-page').style.display === 'none') return;

  var st = state.stats;
  var total = st.totalAttempts, correct = st.totalCorrect, wrong = st.totalWrong;
  var rate = total > 0 ? Math.round(correct / total * 100) : 0;
  var cn2enR = st.cn2en.attempts > 0 ? Math.round(st.cn2en.correct / st.cn2en.attempts * 100) : 0;
  var en2cnR = st.en2cn.attempts > 0 ? Math.round(st.en2cn.correct / st.en2cn.attempts * 100) : 0;
  var cn2enW = wrongWordCount('cn2en');
  var en2cnW = wrongWordCount('en2cn');
  var today = localDateKey(new Date());
  var td = st.dailyHistory[today] || { attempts: 0, correct: 0, wrong: 0 };
  var todayR = td.attempts > 0 ? Math.round(td.correct / td.attempts * 100) : 0;
  // 同步目标输入框
  var goalInp = document.getElementById('goalInput');
  if (goalInp && parseInt(goalInp.value) !== (state.dailyGoal || 30)) goalInp.value = state.dailyGoal || 30;

  document.getElementById('overallStats').innerHTML =
    '<div class="sdc"><div class="sdv" style="color:var(--accent2)">' + getActivePool().length + '</div><div class="sdl">当前词库</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--blue)">' + total + '</div><div class="sdl">总做题数</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--green)">' + rate + '%</div><div class="sdl">总体正确率</div><div class="pbar"><div class="fill g" style="transform:scaleX(' + ((rate)/100) + ')"></div></div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--green)">' + correct + '</div><div class="sdl">正确数</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--red)">' + wrong + '</div><div class="sdl">错误数</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--red)">' + (total > 0 ? Math.round(wrong/total*100) : 0) + '%</div><div class="sdl">错误率</div><div class="pbar"><div class="fill r" style="transform:scaleX(' + (((total > 0 ? Math.round(wrong/total*100) : 0))/100) + ')"></div></div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--orange)">' + state.wrongHistory.length + '</div><div class="sdl">累计错题记录</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--pink)">' + (cn2enW + en2cnW) + '</div><div class="sdl">待重做错词</div></div>' +
    '<div class="sdc"><div class="sdv">' + td.attempts + '</div><div class="sdl">今日做题</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--green)">' + todayR + '%</div><div class="sdl">今日正确率</div><div class="pbar"><div class="fill g" style="transform:scaleX(' + ((todayR)/100) + ')"></div></div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--accent)">' + td.attempts + '/' + (state.dailyGoal || 30) + '</div><div class="sdl">今日目标</div><div class="pbar"><div class="fill" style="transform:scaleX(' + (Math.min(100, td.attempts / (state.dailyGoal || 30) * 100)/100) + ');background:var(--accent)"></div></div></div>' +
    '<div class="sdc"><div class="sdv" style="color:#a78bfa">' + st.streak.best + '</div><div class="sdl">最佳连对</div></div>' +
    '<div class="sdc"><div class="sdv">' + state.retryHistory.length + '</div><div class="sdl">重做总次数</div></div>';

  document.getElementById('modeStats').innerHTML =
    '<div class="sdc"><div class="sdv" style="color:var(--blue)">' + st.cn2en.attempts + '</div><div class="sdl">🇨🇳→🇬🇧 做题数</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--green)">' + cn2enR + '%</div><div class="sdl">🇨🇳→🇬🇧 正确率</div><div class="pbar"><div class="fill g" style="transform:scaleX(' + ((cn2enR)/100) + ')"></div></div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--red)">' + cn2enW + '</div><div class="sdl">🇨🇳→🇬🇧 待重做</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--blue)">' + st.en2cn.attempts + '</div><div class="sdl">🇬🇧→🇨🇳 做题数</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--green)">' + en2cnR + '%</div><div class="sdl">🇬🇧→🇨🇳 正确率</div><div class="pbar"><div class="fill g" style="transform:scaleX(' + ((en2cnR)/100) + ')"></div></div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--red)">' + en2cnW + '</div><div class="sdl">🇬🇧→🇨🇳 待重做</div></div>';

  // Weekly
  var weeklyHTML = '';
  for (var d = 6; d >= 0; d--) {
    var dt = new Date(); dt.setDate(dt.getDate() - d);
    var key = localDateKey(dt);
    var ds = st.dailyHistory[key] || { attempts: 0, correct: 0, wrong: 0 };
    var dr = ds.attempts > 0 ? Math.round(ds.correct / ds.attempts * 100) : 0;
    var dn = ['日','一','二','三','四','五','六'][dt.getDay()];
    var isT = (key === today);
    weeklyHTML += '<div class="sdc"' + (isT ? ' style="border:1px solid var(--accent);"' : '') + '>' +
      '<div class="sdv" style="font-size:1.05em;">' + (isT ? '📌' : '') + key.slice(5) + ' 周' + dn + '</div>' +
      '<div class="sdl">' + ds.attempts + '题 | ✅' + ds.correct + ' ❌' + ds.wrong + ' | ' + dr + '%</div>' +
      '<div class="pbar"><div class="fill ' + (dr >= 60 ? 'g' : 'r') + '" style="transform:scaleX(' + ((Math.max(dr, 5))/100) + ')"></div></div></div>';
  }
  document.getElementById('weeklyStats').innerHTML = weeklyHTML;

  // Recent
  var recent = document.getElementById('recentHistory');
  var combined = [];
  state.wrongHistory.slice(0, 15).forEach(function(h) { combined.push({ item: h, type: 'wrong' }); });
  state.retryHistory.slice(0, 15).forEach(function(h) { combined.push({ item: h, type: 'retry' }); });
  combined.sort(function(a, b) { return b.item.timestamp.localeCompare(a.item.timestamp); });
  combined = combined.slice(0, 30);

  var rh = '';
  if (combined.length === 0) {
    rh = '<div class="empty"><p>还没有活动记录</p></div>';
  } else {
    combined.forEach(function(e) {
      var w = recordWord(e.item);
      rh += '<div class="hi ' + (e.type === 'retry' ? 'retry' : '') + '">' +
        '<span class="badge ' + (e.type === 'retry' ? 'rb' : 'wb') + '">' + (e.type === 'retry' ? '重做' : '错题') + '</span> ' +
        '<span class="hw">' + (w ? w.word : '?') + '</span> ' +
        '<span style="color:var(--text2);">' + (e.item.mode === 'cn2en' ? '🇨🇳→EN' : 'EN→🇨🇳') + '</span> ' +
        (e.item.isCorrect === false ? '❌' : (e.item.isCorrect === true ? '✅' : '')) +
        '<span class="ht">' + e.item.timestamp + '</span></div>';
    });
  }
  recent.innerHTML = rh;

  // Mastery
  var mc = document.getElementById('masteryStats');
  var wordEntries = wordAttemptEntries(currentPool);
  wordEntries.sort(function(a, b) { return (b[1].wrong || 0) - (a[1].wrong || 0); });
  var mastered = wordEntries.filter(function(e) { return e[1].correct >= 2 && e[1].wrong === 0; }).length;
  var struggling = wordEntries.filter(function(e) { return (e[1].wrong || 0) >= 2; }).length;
  var untouched = Math.max(0, getActivePool().length - wordEntries.length);
  var touched = wordEntries.length;

  mc.innerHTML =
    '<div class="sdc"><div class="sdv" style="color:var(--green)">' + mastered + '</div><div class="sdl">已掌握（≥2正确且无错）</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--red)">' + struggling + '</div><div class="sdl">薄弱词汇（≥2错误）</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--blue)">' + touched + '</div><div class="sdl">已练习词数</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--text2)">' + untouched + '</div><div class="sdl">未练习词数</div></div>' +
    '<div class="sdc"><div class="sdv" style="color:var(--accent2)">' + Math.round(touched / getActivePool().length * 100) + '%</div><div class="sdl">词库覆盖率</div><div class="pbar"><div class="fill b" style="transform:scaleX(' + ((Math.round(touched / getActivePool().length * 100))/100) + ')"></div></div></div>';


  // === Frequency-based statistics ===
  renderFreqStats();

  // === Dictation statistics ===
  var dictContainer = document.getElementById('dictStats');
  var dictSec = document.getElementById('dictStatsSec');
  if (dictContainer && dictSec) {
    var d = st.dictation || { attempts: 0, correct: 0, wrong: 0, close: 0 };
    var dRate = d.attempts > 0 ? Math.round(d.correct / d.attempts * 100) : 0;
    var cd = st.cn2en_dict || { attempts: 0, correct: 0, wrong: 0, close: 0 };
    var ed = st.en2cn_dict || { attempts: 0, correct: 0, wrong: 0, close: 0 };
    var cdR = cd.attempts > 0 ? Math.round(cd.correct / cd.attempts * 100) : 0;
    var edR = ed.attempts > 0 ? Math.round(ed.correct / ed.attempts * 100) : 0;
    if (d.attempts > 0) {
      dictContainer.innerHTML =
        '<div class="sdc"><div class="sdv" style="color:var(--blue)">' + d.attempts + '</div><div class="sdl">默写总题数</div></div>' +
        '<div class="sdc"><div class="sdv" style="color:var(--green)">' + dRate + '%</div><div class="sdl">默写正确率</div><div class="pbar"><div class="fill g" style="transform:scaleX(' + ((dRate)/100) + ')"></div></div></div>' +
        '<div class="sdc"><div class="sdv" style="color:var(--green)">' + d.correct + '</div><div class="sdl">完全正确</div></div>' +
        '<div class="sdc"><div class="sdv" style="color:var(--orange)">' + (d.close || 0) + '</div><div class="sdl">接近正确</div></div>' +
        '<div class="sdc"><div class="sdv" style="color:var(--red)">' + d.wrong + '</div><div class="sdl">错误</div></div>' +
        '<div class="sdc"><div class="sdv" style="color:var(--blue)">' + cd.attempts + '</div><div class="sdl">🇨🇳→EN 默写</div></div>' +
        '<div class="sdc"><div class="sdv" style="color:var(--green)">' + cdR + '%</div><div class="sdl">🇨🇳→EN 正确率</div><div class="pbar"><div class="fill g" style="transform:scaleX(' + ((cdR)/100) + ')"></div></div></div>' +
        '<div class="sdc"><div class="sdv" style="color:var(--blue)">' + ed.attempts + '</div><div class="sdl">EN→🇨🇳 默写</div></div>' +
        '<div class="sdc"><div class="sdv" style="color:var(--green)">' + edR + '%</div><div class="sdl">EN→🇨🇳 正确率</div><div class="pbar"><div class="fill g" style="transform:scaleX(' + ((edR)/100) + ')"></div></div></div>';
      dictSec.style.display = 'block';
    } else {
      dictSec.style.display = 'none';
    }
  }

  // Top 5 problem words
  if (struggling > 0) {
    var top5 = wordEntries.filter(function(e) { return e[1].wrong >= 2; }).slice(0, 5);
    var topHTML = '<div style="margin-top:12px;"><strong>🔴 最需复习 Top 5：</strong></div>';
    top5.forEach(function(t) {
      var tw = getWord(wordIdFromStateKey(t[0]), wordPoolFromStateKey(t[0]));
      if (tw) topHTML += '<div class="ci" style="padding:6px 0;font-size:0.9em;">• <strong>' + tw.word + '</strong> — ' + tw.meaning + ' <span style="color:var(--red);">(' + t[1].wrong + '次错误)</span></div>';
    });
    mc.innerHTML += topHTML;
  }

  // Staggered card entry animation
  var allSdc = document.querySelectorAll('#tab-stats-page .sdc');
  allSdc.forEach(function(card, idx) {
    card.style.opacity = '0';
    card.style.animation = 'slideUp 300ms cubic-bezier(0.4,0,0.2,1) both';
    card.style.animationDelay = (idx * 40) + 'ms';
    setTimeout(function() { card.style.opacity = ''; }, idx * 40 + 350);
  });

  // Render all charts
  setTimeout(function() { renderAllCharts(); }, 100);
}

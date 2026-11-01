/* words.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ WORD UTILS ============
function escapeHTML(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function getWord(id, poolName) {
  var pool = poolName || currentPool || 'core';
  if (!isKnownPool(pool)) pool = 'core';
  ensurePool(pool);
  var maps = window._wordMaps[pool];
  return (maps && maps.get(id)) || null;
}

function favoriteKey(id, poolName) {
  return wordStateKey(id, poolName || currentPool || 'core');
}

function isFavorite(id, poolName) {
  return !!(state && state.favorites && state.favorites[favoriteKey(id, poolName)]);
}

function refreshFavoriteButtons() {
  document.querySelectorAll('[data-favorite-toggle]').forEach(function(btn) {
    var key = btn.getAttribute('data-favorite-key');
    var active = !!(state.favorites && state.favorites[key]);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.textContent = active ? '★ 已标记' : '☆ 标记重点';
    btn.title = active ? '取消重点词' : '标记为重点词';
  });
}

function toggleFavorite(id, poolName) {
  var key = favoriteKey(id, poolName);
  if (!state.favorites) state.favorites = {};
  var added = !state.favorites[key];
  if (added) state.favorites[key] = true;
  else delete state.favorites[key];
  saveState();
  refreshFavoriteButtons();
  if (typeof renderFavorites === 'function') renderFavorites();
  return added;
}

function favoriteEntries(poolName) {
  var pool = poolName || null;
  return Object.keys(state.favorites || {}).filter(function(key) {
    return !pool || wordPoolFromStateKey(key) === pool;
  }).map(function(key) {
    var p = wordPoolFromStateKey(key);
    return { key: key, pool: p, id: wordIdFromStateKey(key), word: getWord(wordIdFromStateKey(key), p) };
  }).filter(function(entry) { return !!entry.word; });
}

function getSmartQueueIds(poolName, limit, sourceIds) {
  var pool = poolName || currentPool || 'core';
  var candidates;
  if (Array.isArray(sourceIds)) {
    candidates = sourceIds.map(function(id) { return getWord(id, pool); }).filter(Boolean);
  } else if (pool === currentPool) {
    candidates = getActivePool().filter(function(word) { return !!getWord(word.id, pool); });
  } else {
    ensureFullWords();
    var raw = pool === 'full' ? (FULL_WORDS || []) : ALL_WORDS;
    candidates = raw.filter(function(word) { return !!getWord(word.id, pool); });
  }
  var due = {};
  var dueIds = pool === 'full' ? dueWordsByGrid() : dueUnitWordIds();
  dueIds.forEach(function(id) { due[id] = true; });
  var attempts = state.stats.wordAttempts || {};
  var ranked = candidates.map(function(word, index) {
    var wa = attempts[wordStateKey(word.id, pool)] || {};
    var tried = Number(wa.attempts) || 0;
    var wrong = Number(wa.wrong) || 0;
    var score = 0;
    if (due[word.id]) score += 50000;
    if (isFavorite(word.id, pool)) score += 100000;
    if (tried === 0) score += 1000;
    else score += Math.round((wrong / tried) * 10000) + wrong * 100;
    return { id: word.id, score: score, index: index };
  });
  ranked.sort(function(a, b) { return b.score - a.score || a.index - b.index; });
  var count = finiteInt(limit, ranked.length, 1, ranked.length);
  return ranked.slice(0, count).map(function(item) { return item.id; });
}

function startSmartQuiz(mode, sourceIds) {
  var ids = getSmartQueueIds(currentPool, 0, sourceIds);
  if (ids.length === 0) { alert('当前筛选范围没有可练习的单词。'); return; }
  var words = ids.map(function(id) { return getWord(id, currentPool); }).filter(Boolean);
  buildQuiz(mode || currentMode, words);
  quizState.isRetry = false;
  quizState.isSmart = true;
  document.getElementById('retryInfo').classList.remove('show');
  advanceQuestion();
  renderAll();
}

function renderFavorites() {
  var list = document.getElementById('favoriteList');
  var count = document.getElementById('favoriteCount');
  if (!list || !count) return;
  var entries = favoriteEntries();
  count.textContent = entries.length + ' 个';
  if (entries.length === 0) {
    list.innerHTML = '<div class="empty"><div class="ei">⭐</div><p>还没有重点词，做题或浏览词库时可以随手标记。</p></div>';
    return;
  }
  list.innerHTML = entries.map(function(entry) {
    var word = entry.word;
    var entryPoolLabel = poolLabel(entry.pool);
    return '<div class="hi" style="border-left-color:var(--orange);display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
      '<div><strong class="hw">' + escapeHTML(word.word) + '</strong> <span style="color:var(--text2);font-size:0.85em;">' + escapeHTML(word.pronunciation || '') + '</span>' +
      '<div style="color:var(--text2);margin-top:3px;">' + escapeHTML(getChineseFull(word.meaning)) + ' · ' + entryPoolLabel + '</div></div>' +
      '<button class="ctrl-btn favorite-toggle active" data-favorite-toggle data-favorite-key="' + entry.key + '" aria-pressed="true">★ 已标记</button></div>';
  }).join('');
}

function getChinese(meaning) {
  // 1. Strip leading POS tag(s), e.g. "v./ n.改革" → "改革"
  var cleaned = meaning.replace(/^[a-z]+\.\s*(?:\/\s*[a-z]+\.?\s*)?/i, '');
  // 2. Remove embedded pronunciations, e.g. "影响 /ɪm'pækt/ v.有影响" → "影响  v.有影响"
  cleaned = stripPronunciation(cleaned);
  // 3. Collapse whitespace and trim
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  return cleaned;
}
// Remove slash-delimited pronunciation only when the segment is phonetic text.
// Chinese slash-separated alternatives (e.g. "他/她/它们") must remain intact.
function stripPronunciation(text) {
  var source = String(text || '');
  source = source.replace(/第\s*\d+\s*页\s*[,，]?\s*共\s*\d+\s*页/g, '');
  // 词库中偶有“in'kwaɪə(r)/ v.询问”这类缺失开头斜杠的音标前缀；
  // 仅在后面紧跟词性标记时移除，中文释义中的“他/她/它们”等斜杠保持不变。
  source = source.replace(/^\s*[^\s\u3400-\u9fff\/.]{2,40}\s*\/\s*(?=[a-z]+(?:\s*&\s*[a-z]+)?\.)/i, '');
  return source.replace(/\/([^\/]+)\//g, function(match, inner) {
    var hasLatinOrIpa = /[A-Za-zəɪɔʊɑɛɒʌɜːʃʒθðŋɡɹɻɾɞɐɒˈˌ'()]/.test(inner);
    var hasCjk = /[\u3400-\u9fff]/.test(inner);
    return hasLatinOrIpa && !hasCjk ? ' ' : match;
  });
}
// 显示用：保留全部词性标记（多词性单词完整展示，如 "v.快速增长 n.火箭"），只剥离音标
function getChineseFull(meaning) {
  return stripPronunciation(meaning).replace(/\s{2,}/g, ' ').trim();
}

// 英文→中文选择题专用显示文本：只保留中文释义和标点。
// 词库释义中的英文括注（如 "(play at)"、"（Sure）"）、POS 缩写、残留音标均不展示。
function getChineseOptionText(meaning) {
  var s = getChineseFull(meaning);
  // 词条自带的「汉字+空格+汉字」是录入噪声（如 narrative 的“叙 述”），不是义项分界。
  // 先替换成哨兵 \u0003 保留到末尾直接连接，避免被下方的“义项补逗号”规则误切成
  // “叙，述”这类假标点（真正的义项分界由词性标记决定，见函数末尾的说明）。
  s = s.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1\u0003');
  // 含拉丁字母的中英文括号说明整体移除；中文括号内容保留。
  s = s.replace(/\([^()]*[A-Za-z][^()]*\)/g, ' ')
       .replace(/（[^（）]*[A-Za-z][^（）]*）/g, ' ');
  // 再移除所有拉丁字母/音标字符，避免 bike、Sure、be supposed to 等残留。
  s = s.replace(/[A-Za-zəɪɔʊɑɛɒʌɜːʃʒθðŋɡɹɻɾɞɐˈˌ]/g, '');
  // 清掉字母移除后遗留的 POS 点号、空括号及多余空格。
  s = s.replace(/[()（）]/g, '').replace(/\.{1,}/g, ' ')
       .replace(/[&＆]/g, ' ')
       // 词性写法 "n./v." 清洗后会残留斜杠（如 patrol 曾显示「/ 巡逻，巡查」），
       // 但中文义项之间的斜杠是释义分隔符（如 "他/她/它们"），必须原样保留：
       // 先把「汉字/汉字」的斜杠临时保护起来，清完残留斜杠再还原。
       .replace(/([\u3400-\u9fff])\s*\/+\s*(?=[\u3400-\u9fff])/g, '$1\u0000')
       .replace(/\s*\/+\s*/g, ' ')
       .replace(/\u0000/g, '/')
       .replace(/\s+([,.;!?，。；！？])/g, '$1')
       .replace(/\s{2,}/g, ' ').trim();
  // 多词性释义去掉 POS 后可能只剩空格相连的中文片段，补中文逗号
  // 以免出现“跌倒 跌倒”或“人 人类的”难以辨认的拼接。
  // 只处理「词性标记被移除后留下的空格」这个真正的义项分界；
  // 词条自带的词内噪声空格已在函数开头转成 \u0003，不受本规则影响。
  s = s.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1，')
       .replace(/\u0003/g, '');
  // 覆盖拉丁扩展与全角字母，防止非 ASCII 英文残留绕过上面的清洗。
  s = s.replace(/[\u00c0-\u024f\u1e00-\u1eff\uff21-\uff3a\uff41-\uff5a]/g, '')
       .replace(/\s{2,}/g, ' ').trim();
  return /[\u3400-\u9fff]/.test(s) ? s : '';
}

var POS_LABELS = {
  n: true, v: true, adj: true, adv: true, prep: true, conj: true,
  pron: true, num: true, art: true, det: true, aux: true, modal: true,
  vt: true, vi: true, phr: true, phrase: true, interj: true,
  // 感叹词 / 缩写标记：词库中使用 int.（please、hello、hey）、exclam.（hi、fuck）、
  // abbr.（AD、BC、CD、DVD、etc）撰写，此前未收录导致这些选项不显示词性。
  int: true, exclam: true, abbr: true
};
function wordPartOfSpeech(word) {
  if (!word || !word.meaning) return [];
  var result = [];
  // Read all POS markers, including compact forms such as "n.&v." and
  // spaced forms "n. & v." that may appear across multiple Chinese senses.
  var source = String(word.meaning);
  var matches = source.toLowerCase().match(/[a-z]{1,10}\./g) || [];
  matches.forEach(function(marker) {
    var pos = marker.slice(0, -1);
    // Ignore incidental abbreviations such as “e.g.” in a definition;
    // only recognised part-of-speech markers become option labels.
    if (POS_LABELS[pos] && result.indexOf(pos) === -1) result.push(pos);
  });
  return result;
}
function optionPosHTML(word, mode) {
  var pos = wordPartOfSpeech(word);
  if (!pos.length) return '';
  var label = pos.map(function(p) { return p + '.'; }).join(' / ');
  return '<span class="option-pos">' + label + '</span>';
}

// 用于选择题去重的中文释义键：只保留汉字，避免词性、音标和标点差异
// 让“询问，打听”与“ɪn'kwaɪə(r)/ v.询问，打听”被误判为不同选项。
function meaningChineseKey(meaning) {
  // 词典噪声（【名】…人名 等标注）同样剔除，不参与同根判断。
  return getChinese(meaning).replace(/【[^】]*】/g, '').replace(/人名/g, '').replace(/[^\u3400-\u9fff]/g, '');
}

// 释义比较用的高频通用字（词典套话）惰性统计：出现在超过 2% 词条释义
// 中的二字片段不参与同根判断，避免“指/尤其”一类套话造成误伤。
var _meaningStopGrams = null;
var _meaningStopGramsHasFull = false;
function buildMeaningStopGrams() {
  var hasFull = !!(window.FULL_WORDS && FULL_WORDS.length);
  var banks = hasFull ? [ALL_WORDS, FULL_WORDS] : [ALL_WORDS];
  var df = Object.create(null);
  var total = 0;
  banks.forEach(function(bank) {
    bank.forEach(function(w) {
      var k = meaningChineseKey(w && w.meaning);
      if (!k) return;
      total++;
      var seen = Object.create(null);
      for (var i = 0; i < k.length - 1; i++) {
        var g = k.substring(i, i + 2);
        if (!seen[g]) { seen[g] = true; df[g] = (df[g] || 0) + 1; }
      }
    });
  });
  var cap = Math.max(30, total * 0.02);
  var out = Object.create(null);
  Object.keys(df).forEach(function(g) { if (df[g] >= cap) out[g] = true; });
  _meaningStopGrams = out;
  _meaningStopGramsHasFull = hasFull;
}
function getMeaningStopGrams() {
  var hasFull = !!(window.FULL_WORDS && FULL_WORDS.length);
  if (!_meaningStopGrams || (hasFull && !_meaningStopGramsHasFull)) buildMeaningStopGrams();
  return _meaningStopGrams;
}

// 判断两个释义是否过于接近（对称）：完全相同，或共用任何一个非通用
// 二字汉字片段（同根词，如 发明者/发明物、木制的/木头、可能的/可能）
// 即判为过近，同一道英文选中文题只保留一个，避免用户无法凭释义作答。
// 旧版按分段包含关系判定，比较方向不同结果不同（“可能的；可能存在的”
// 与“可能；或许”只有先传短释义才命中），同根干扰项因此漏进同一道题。
function meaningsTooClose(a, b) {
  var ka = meaningChineseKey(a && a.meaning != null ? a.meaning : a);
  var kb = meaningChineseKey(b && b.meaning != null ? b.meaning : b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.length < 2 || kb.length < 2) return false;
  var stop = getMeaningStopGrams();
  var grams = Object.create(null);
  for (var i = 0; i < ka.length - 1; i++) grams[ka.substring(i, i + 2)] = true;
  for (var j = 0; j < kb.length - 1; j++) {
    var gram = kb.substring(j, j + 2);
    if (grams[gram] && !stop[gram]) return true;
  }
  return false;
}


function splitMeaning(meaning) {
  // 剥离音标（/.../ 对），折叠空格
  var s = stripPronunciation(meaning).replace(/\s{2,}/g, ' ').trim();
  if (!s) return [];
  // 在词性标记前插入哨兵，切分多词性条目（如 "n.手指 v.告发" → 两个条目）
  var marked = s.replace(/\s+(?=[a-z]+\.(?:\s*\/\s*[a-z]+\.?)?)/g, '\u0001');
  var parts = marked.split('\u0001').map(function(p) { return p.trim(); }).filter(Boolean);
  var entries = [];
  // 允许词性标记前带括号注记（如 "(= phone) n.电话"、"(=exam)n.考试"、"（= burger） n.汉堡包"）：
  // 注记归入中文文本、词性照常生成 badge，避免整段因注记而判定为「无词性」。
  var posRe = /^([（(][^）)]{0,30}[）)]\s*)?([a-z]+\.(?:\s*\/\s*[a-z]+\.?)?)\s*([\s\S]*)$/i;
  for (var i = 0; i < parts.length; i++) {
    var pm = parts[i].match(posRe);
    if (pm) {
      var _note = pm[1] ? pm[1].trim() : '';
      entries.push({ pos: pm[2].trim(), cn: (_note ? _note + ' ' : '') + pm[3].trim() });
    }
    else if (entries.length > 0) entries[entries.length - 1].cn += ' ' + parts[i];
    else entries.push({ pos: '', cn: parts[i] });
  }
  // 前置括号注记（如 "(= phone)"、"( = burger)"）被空格切分成独立段时，
  // 与紧随其后的词性段合并，避免整段判定为「无词性」。
  var _k = 0;
  while (_k < entries.length - 1) {
    if (!entries[_k].pos && /^[（(][^）)]*[）)]$/.test(entries[_k].cn) && entries[_k + 1].pos) {
      entries[_k + 1].cn = entries[_k].cn + ' ' + entries[_k + 1].cn;
      entries.splice(_k, 1);
    } else {
      _k++;
    }
  }
  return entries;
}

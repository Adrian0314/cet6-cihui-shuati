/* data.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// Load word data from JSON blocks (ALL_WORDS eagerly, FULL_WORDS lazily)
var ALL_WORDS = JSON.parse(document.getElementById('data-all-words').textContent);
function repairWordData(list) {
  // 只保留「数据文件本身残缺、必须运行时补齐」的词条（都在 20 字内）。
  // 注意：数据已修好的词（way / bunch / family / sweet / ought / animal /
  // their / hear / manoeuvre 等）不再在此覆盖——此前 repair 表里留着这些词的
  // 旧长释义，会在运行时把它们又改回长文本，导致词库精简失效。
  // 说明：tempo / intake / mineral / wall / disarm 等条目原本在词库数据里只剩词性标记，
  // 靠本表在运行时临时补释义；现已把正确释义直接写回词库数据，故此处不再覆盖
  // （否则运行时的旧值会把已修好的数据又改回去，词库精简同样会失效）。
  var repairs = {
    // fibre 的原始释义混入了 OCR 识别出的音标，选择题中应只显示中文释义。
    fibre: { meaning: 'n.(食物的)纤维素;(布绳的)纤维' },
    // optimum 与 optimal 原始释义完全相同；补充 optimum 的名词义，避免选择题出现两个相同答案。
    optimum: { meaning: 'n. 最优值；最佳状态' }
  };
  (list || []).forEach(function(word) {
    var fix = repairs[String(word.word || '').toLowerCase()];
    if (fix) Object.keys(fix).forEach(function(key) { word[key] = fix[key]; });
    // OCR 偶尔会把没有对应释义的词性标记留在末尾，避免它进入选择题选项。
    if (word.meaning) word.meaning = String(word.meaning).replace(/\s+(?:n|v|adj|adv|prep|pron|conj|num|art|aux|vi|vt)\.$/i, '').trim();
  });
  return list;
}
repairWordData(ALL_WORDS);
// 剥离释义中 OCR 残留的 emoji（原书重点词标记被识别为 🔥，非书籍文字内容）。运行时清洗，数据块 JSON 保持原样可追溯；_wordMap 持有 ALL_WORDS 对象引用，故清洗对所有显示路径（选项/题干/详解/词库浏览）生效，同时避免前导 emoji 挡住 POS 词性检测
ALL_WORDS.forEach(function(w) { if (w.meaning) w.meaning = String(w.meaning).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').trim(); });
// ============ EXTERNAL DATA LOADER (数据外置：打卡词库动态加载，本地 file:// 与线上通用，sw.js 管理资源缓存) ============
var _dataLoadState = {};
function loadDataScript(src, cb) {
  var st = _dataLoadState[src] || (_dataLoadState[src] = { loading: false, loaded: false, waiters: [], retried: false });
  if (st.loaded) { if (cb) cb(); return; }
  if (typeof cb === 'function') st.waiters.push(cb);
  if (st.loading) return;
  st.loading = true;
  function fire() { var w = st.waiters.splice(0); w.forEach(function(f) { f(); }); }
  function attempt() {
    var sc = document.createElement('script');
    sc.src = src;
    sc.onload = function() { st.loading = false; st.loaded = true; fire(); };
    sc.onerror = function() {
      if (!st.retried) { st.retried = true; attempt(); }  // 网络抖动重试一次，仍失败则通知 waiters（调用方降级）
      else { st.loading = false; fire(); }
    };
    document.head.appendChild(sc);
  }
  attempt();
}

var FULL_WORDS = null; // 核心词汇，外置 full-words.js 动态加载（详解已随数据合并）
// ===== 1500 核心词：外置 core1500-words.js 动态加载（与 full-words.js 同一加载模式） =====
var C1500_WORDS = null;
var _c1500Loaded = false;
var _c1500Loading = false;
var _c1500Failed = false;
var _c1500Waiters = [];
function indexC1500Words() {
  if (_c1500Loaded || !window.__C1500_WORDS_DATA__) return;
  C1500_WORDS = repairWordData(window.__C1500_WORDS_DATA__);
  _c1500Loaded = true;
  C1500_WORDS.forEach(function(w) {
    addWordIndex('c1500', w);
  });
}
function ensureC1500Words(cb) {
  if (_c1500Loaded) { if (cb) cb(); return; }
  if (_c1500Failed) { if (cb) cb(); return; }  // 已加载失败，不再自动重试（调用方降级）
  if (window.__C1500_WORDS_DATA__) { indexC1500Words(); if (cb) cb(); return; }
  if (typeof cb === 'function') _c1500Waiters.push(cb);
  if (_c1500Loading) return;
  _c1500Loading = true;
  loadDataScript('core1500-words.js', function() {
    _c1500Loading = false;
    if (window.__C1500_WORDS_DATA__) indexC1500Words();
    else _c1500Failed = true;
    var w = _c1500Waiters.splice(0);
    w.forEach(function(f) { f(); });
    if (currentPool === 'c1500' && typeof updateFreqCount === 'function') updateFreqCount();
  });
}

// ===== 外置词库统一入口 =====
function isExternalPool(poolName) { return poolName === 'full' || poolName === 'c1500'; }
function isPoolLoaded(poolName) {
  if (poolName === 'c1500') return !!C1500_WORDS;
  if (poolName === 'full') return !!FULL_WORDS;
  return true;
}
function ensurePool(poolName, cb) {
  if (poolName === 'c1500') { ensureC1500Words(cb); return; }
  if (poolName === 'full') { ensureFullWords(cb); return; }
  if (typeof cb === 'function') cb();
}
// 指定词库（默认当前）的原始词表数组；外置词库未就绪时返回 []
function poolWords(poolName) {
  var pool = poolName || currentPool || 'core';
  if (pool === 'c1500') { ensureC1500Words(); return C1500_WORDS || []; }
  if (pool === 'full') { ensureFullWords(); return FULL_WORDS || []; }
  return (typeof ALL_WORDS !== 'undefined' && ALL_WORDS) ? ALL_WORDS : [];
}
var _fullWordsLoaded = false;
var _fullWordsLoading = false;
var _fullWordsFailed = false;
var _fullWordsWaiters = [];
function indexFullWords() {
  if (_fullWordsLoaded || !window.__FULL_WORDS_DATA__) return;
  FULL_WORDS = repairWordData(window.__FULL_WORDS_DATA__);
  _fullWordsLoaded = true;
  // Index FULL_WORDS data into lookup structures（详解已合并进数据文件，无需运行时 applyWordDetail）
  FULL_WORDS.forEach(function(w) {
    addWordIndex('full', w);
  });
}
function ensureFullWords(cb) {
  if (_fullWordsLoaded) { if (cb) cb(); return; }
  if (_fullWordsFailed) { if (cb) cb(); return; }  // 已加载失败，不再自动重试（调用方降级）
  if (window.__FULL_WORDS_DATA__) { indexFullWords(); if (cb) cb(); return; }
  if (typeof cb === 'function') _fullWordsWaiters.push(cb);
  if (_fullWordsLoading) return;
  _fullWordsLoading = true;
  loadDataScript('full-words.js', function() {
    _fullWordsLoading = false;
    if (window.__FULL_WORDS_DATA__) indexFullWords();
    else _fullWordsFailed = true;
    var w = _fullWordsWaiters.splice(0);
    w.forEach(function(f) { f(); });
    // 核心词汇就绪后刷新词数（页面加载时 prefs.pool='full' 会在数据到达前渲染 0 词，数据到达后更新为真实词数）
    if (currentPool === 'full' && typeof updateFreqCount === 'function') updateFreqCount();
  });
}

// === INDEX BUILDING ===
// ============ PRE-COMPUTED INDEXES ============
function addWordIndex(poolName, w) {
  // 外置词库可能晚于索引初始化加载，缺失时按需建容器
  if (!window._wordMaps[poolName]) {
    window._wordMaps[poolName] = new Map();
    window._prefixIdxByPool[poolName] = {};
    window._posIdxByPool[poolName] = {};
  }
  var maps = window._wordMaps[poolName];
  var prefixIdx = window._prefixIdxByPool[poolName];
  var posIdx = window._posIdxByPool[poolName];
  maps.set(w.id, w);

  var pf = w.word.toLowerCase().substring(0, 3);
  if (!prefixIdx[pf]) prefixIdx[pf] = [];
  if (prefixIdx[pf].indexOf(w.id) === -1) prefixIdx[pf].push(w.id);

  var pm = w.meaning.match(/^([a-z]+)\./i);
  if (pm) {
    var pos = pm[1].toLowerCase();
    if (!posIdx[pos]) posIdx[pos] = [];
    if (posIdx[pos].indexOf(w.id) === -1) posIdx[pos].push(w.id);
  }
}

(function buildIndexes() {
  // Each pool starts at id=1, so every lookup index must be pool-scoped.
  window._wordMaps = { core: new Map(), full: new Map(), c1500: new Map() };
  window._prefixIdxByPool = { core: {}, full: {}, c1500: {} };
  window._posIdxByPool = { core: {}, full: {}, c1500: {} };
  // Backward-compatible aliases for code and diagnostics that inspect core indexes.
  window._wordMap = window._wordMaps.core;
  window._prefixIdx = window._prefixIdxByPool.core;
  window._posIdx = window._posIdxByPool.core;
  // Pre-compute similarity groups (pairs with same first 3 chars)
  window._simGroups = {};

  ALL_WORDS.forEach(function(w, i) {
    addWordIndex('core', w);
  });
})()

/* state.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ LEVENSHTEIN DISTANCE ============
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  var al = a.length, bl = b.length;
  if (Math.abs(al - bl) > 4) return Math.abs(al - bl) + 3; // early exit
  var prev = new Array(bl + 1);
  var curr = new Array(bl + 1);
  for (var j = 0; j <= bl; j++) prev[j] = j;
  for (var i = 0; i < al; i++) {
    curr[0] = i + 1;
    for (var j = 0; j < bl; j++) {
      var cost = a[i] === b[j] ? 0 : 1;
      curr[j + 1] = Math.min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost);
    }
    var tmp = prev; prev = curr; curr = tmp;
  }
  return prev[bl];
}

// ============ APP STATE ============
var STORAGE_KEY = 'cet6_quiz_app_v2';
var STATE_SCHEMA_VERSION = 4;

function getDefaultState() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    wrongHistory: [],
    retryHistory: [],
    wrongWordIds: {},
    favorites: {},
    stats: {
      totalAttempts: 0, totalCorrect: 0, totalWrong: 0,
      cn2en: { attempts: 0, correct: 0, wrong: 0 },
      en2cn: { attempts: 0, correct: 0, wrong: 0 },
      streak: { current: 0, best: 0 },
      dailyHistory: {},
      wordAttempts: {},
      dictation: { attempts: 0, correct: 0, wrong: 0, close: 0, skip: 0 },
      cn2en_dict: { attempts: 0, correct: 0, wrong: 0, close: 0, skip: 0 },
      en2cn_dict: { attempts: 0, correct: 0, wrong: 0, close: 0, skip: 0 },
      totalSkip: 0
    },
    suspendedQuiz: null,
    prefs: { pool: 'full', units: [0], size: 20, gate: 2, mode: 'en2cn', type: 'choice', memory: false, autoSpeak: false },
    dailyGoal: 30,
    ebbingActive: false,     // 刘晓艳词库 4周25天打卡表是否已手动开启（纯刷题模式为 false）
    ebbingStart: null,       // 刘晓艳词库 4周25天打卡起始日（UTC 日期字符串）
    ebbingUnitLog: {},       // dateKey → [当天已复习完成的 Unit 数组]
    ebbingPlan: null
  };
}

function wordStateKey(id, poolName) {
  return (isKnownPool(poolName) ? poolName : 'core') + ':' + String(id);
}

function wordPoolFromStateKey(key) {
  var s = String(key);
  for (var i = 0; i < POOL_IDS.length; i++) {
    if (s.indexOf(POOL_IDS[i] + ':') === 0) return POOL_IDS[i];
  }
  return 'core';
}

function wordIdFromStateKey(key) {
  var s = String(key);
  return parseInt(s.indexOf(':') >= 0 ? s.slice(s.indexOf(':') + 1) : s, 10);
}

function recordPool(record) {
  return (record && isKnownPool(record.pool)) ? record.pool : 'core';
}

function recordWord(record) {
  return record ? getWord(record.wordId, recordPool(record)) : null;
}

function wordAttemptEntries(poolName) {
  var pool = poolName || currentPool || 'core';
  var attempts = (state && state.stats && state.stats.wordAttempts) || {};
  return Object.keys(attempts).filter(function(key) {
    return wordPoolFromStateKey(key) === pool;
  }).map(function(key) {
    return [key, attempts[key]];
  });
}

function migrateWordAttemptKeys(s) {
  if (!s.stats || !s.stats.wordAttempts || typeof s.stats.wordAttempts !== 'object' || Array.isArray(s.stats.wordAttempts)) {
    if (s.stats) s.stats.wordAttempts = {};
    return;
  }
  var old = s.stats.wordAttempts;
  var migrated = {};
  Object.keys(old).forEach(function(key) {
    var pool = wordPoolFromStateKey(key);
    var id = wordIdFromStateKey(key);
    var value = old[key];
    if (!isFinite(id) || id <= 0 || !value || typeof value !== 'object' || Array.isArray(value)) return;
    var target = wordStateKey(id, pool);
    if (!migrated[target]) migrated[target] = value;
    else {
      // If a malformed backup contains both legacy and migrated keys, retain both counts.
      migrated[target].attempts = (migrated[target].attempts || 0) + (value.attempts || 0);
      migrated[target].correct = (migrated[target].correct || 0) + (value.correct || 0);
      migrated[target].wrong = (migrated[target].wrong || 0) + (value.wrong || 0);
      if (!migrated[target].learnedAt) migrated[target].learnedAt = value.learnedAt;
      if (!migrated[target].grid && value.grid) migrated[target].grid = value.grid;
    }
  });
  s.stats.wordAttempts = migrated;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finiteInt(value, fallback, min, max) {
  var n = Number(value);
  if (!isFinite(n)) return fallback;
  n = Math.floor(n);
  if (typeof min === 'number' && n < min) return fallback;
  if (typeof max === 'number' && n > max) return fallback;
  return n;
}

function normalizeCounterGroup(value, fallback) {
  var group = isPlainObject(value) ? value : {};
  var out = Object.assign({}, fallback || {});
  Object.keys(group).forEach(function(key) {
    var n = Number(group[key]);
    if (isFinite(n) && n >= 0) out[key] = Math.floor(n);
  });
  return out;
}

function normalizeHistory(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(function(item) {
    return isPlainObject(item) && isFinite(Number(item.wordId)) && Number(item.wordId) > 0;
  }).map(function(item) {
    var out = Object.assign({}, item);
    out.wordId = finiteInt(item.wordId, 0, 1);
    out.pool = recordPool(item);
    out.mode = item.mode === 'en2cn' ? 'en2cn' : 'cn2en';
    out.timestamp = typeof item.timestamp === 'string' ? item.timestamp : '';
    return out;
  });
}

function normalizeState(input) {
  var def = getDefaultState();
  var s = isPlainObject(input) ? input : {};

  Object.keys(def).forEach(function(key) {
    if (!(key in s)) s[key] = def[key];
  });

  s.schemaVersion = STATE_SCHEMA_VERSION;
  s.wrongHistory = normalizeHistory(s.wrongHistory);
  s.retryHistory = normalizeHistory(s.retryHistory);
  s.wrongWordIds = isPlainObject(s.wrongWordIds) ? s.wrongWordIds : {};
  var oldWrong = s.wrongWordIds;
  var wrong = {};
  Object.keys(oldWrong).forEach(function(key) {
    var target = (key === 'cn2en' || key === 'en2cn') ? key + '_core' : key;
    if (!isPlainObject(oldWrong[key])) return;
    if (!wrong[target]) wrong[target] = {};
    Object.keys(oldWrong[key]).forEach(function(id) {
      if (isFinite(Number(id)) && Number(id) > 0) wrong[target][finiteInt(id, 0, 1)] = true;
    });
  });
  ['cn2en', 'en2cn'].forEach(function(mode) {
    POOL_IDS.forEach(function(poolName) {
      var key = mode + '_' + poolName;
      if (!wrong[key]) wrong[key] = {};
    });
  });
  s.wrongWordIds = wrong;

  // 重点词使用 pool:id 作为稳定键，避免大纲词汇和核心词汇的同编号互相覆盖。
  var rawFavorites = isPlainObject(s.favorites) ? s.favorites : {};
  var favorites = {};
  Object.keys(rawFavorites).forEach(function(key) {
    var pool = wordPoolFromStateKey(key);
    var id = wordIdFromStateKey(key);
    if (isFinite(id) && id > 0 && rawFavorites[key]) favorites[wordStateKey(id, pool)] = true;
  });
  s.favorites = favorites;

  s.stats = Object.assign({}, def.stats, isPlainObject(s.stats) ? s.stats : {});
  ['cn2en', 'en2cn', 'streak', 'dictation', 'cn2en_dict', 'en2cn_dict'].forEach(function(key) {
    s.stats[key] = normalizeCounterGroup(s.stats[key], def.stats[key]);
  });
  s.stats.dailyHistory = isPlainObject(s.stats.dailyHistory) ? s.stats.dailyHistory : {};
  Object.keys(s.stats.dailyHistory).forEach(function(key) {
    var day = s.stats.dailyHistory[key];
    if (!isPlainObject(day)) { delete s.stats.dailyHistory[key]; return; }
    s.stats.dailyHistory[key] = normalizeCounterGroup(day, { attempts: 0, correct: 0, wrong: 0, dict_attempts: 0, dict_correct: 0 });
  });
  migrateWordAttemptKeys(s);
  Object.keys(s.stats.wordAttempts).forEach(function(key) {
    var wa = s.stats.wordAttempts[key];
    wa.attempts = finiteInt(wa.attempts, 0, 0);
    wa.correct = finiteInt(wa.correct, 0, 0);
    wa.wrong = finiteInt(wa.wrong, 0, 0);
    if (!isFinite(Number(wa.learnedAt)) || Number(wa.learnedAt) <= 0) delete wa.learnedAt;
    if (Array.isArray(wa.grid)) wa.grid = wa.grid.slice(0, 7).map(function(v) { return v ? Number(v) || 0 : 0; });
    else if (wa.grid !== undefined) delete wa.grid;
    if (!isFinite(Number(wa.retryAt)) || Number(wa.retryAt) <= 0) delete wa.retryAt;
  });

  s.stats.totalAttempts = finiteInt(s.stats.totalAttempts, 0, 0);
  s.stats.totalCorrect = finiteInt(s.stats.totalCorrect, 0, 0);
  s.stats.totalWrong = finiteInt(s.stats.totalWrong, 0, 0);
  s.stats.totalSkip = finiteInt(s.stats.totalSkip, 0, 0);
  s.dailyGoal = finiteInt(s.dailyGoal, def.dailyGoal, 1, 1000);
  s.ebbingActive = !!s.ebbingActive;
  s.ebbingStart = typeof s.ebbingStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.ebbingStart) ? s.ebbingStart : null;
  if (s.ebbingStart) s.ebbingActive = true;
  s.ebbingUnitLog = isPlainObject(s.ebbingUnitLog) ? s.ebbingUnitLog : {};
  s.ebbingPlan = normalizeEbbingPlan(s, new Date());
  s.suspendedQuiz = isPlainObject(s.suspendedQuiz) ? s.suspendedQuiz : null;
  if (s.suspendedQuiz) {
    s.suspendedQuiz.poolType = isKnownPool(s.suspendedQuiz.poolType) ? s.suspendedQuiz.poolType : 'core';
    s.suspendedQuiz.ids = Array.isArray(s.suspendedQuiz.ids) ? s.suspendedQuiz.ids.map(function(id) { return finiteInt(id, 0, 1); }).filter(Boolean) : [];
    s.suspendedQuiz.answers = isPlainObject(s.suspendedQuiz.answers) ? s.suspendedQuiz.answers : {};
    s.suspendedQuiz.questionSnapshots = Array.isArray(s.suspendedQuiz.questionSnapshots) ? s.suspendedQuiz.questionSnapshots : [];
    var savedPlanDayKey = typeof s.suspendedQuiz.ebbingPlanDayKey === 'string' ? s.suspendedQuiz.ebbingPlanDayKey : null;
    // Before plan snapshots carried their own date, use the saved plan date for the same-day resume check.
    if (!savedPlanDayKey && s.suspendedQuiz.isEbbingPlan && s.ebbingPlan && typeof s.ebbingPlan.dayKey === 'string') {
      savedPlanDayKey = s.ebbingPlan.dayKey;
    }
    s.suspendedQuiz.ebbingPlanDayKey = savedPlanDayKey;
  }

  var p = isPlainObject(s.prefs) ? s.prefs : {};
  s.prefs = {
    pool: isKnownPool(p.pool) ? p.pool : 'core',
    units: Array.isArray(p.units) && p.units.length ? (p.units.indexOf(0) !== -1 ? [0] : [finiteInt(p.units[0], 0, 0, maxUnitOfPool(isKnownPool(p.pool) ? p.pool : 'core') || 14)]) : [0],
    size: finiteInt(p.size, def.prefs.size, 1, 1000),
    gate: finiteInt(p.gate, def.prefs.gate, 1, 3),
    mode: p.mode === 'en2cn' ? 'en2cn' : 'cn2en',
    type: p.type === 'dictation' ? 'dictation' : 'choice',
    memory: !!p.memory,
    autoSpeak: !!p.autoSpeak
  };
  if (s.prefs.units.length === 0) s.prefs.units = [0];
  return s;
}


// ============ POOL & UNIT FILTER ============
var currentPool = 'full';       // 'core' | 'full'
var selectedUnits = [0];        // [0]=全部; 其他为选中的Unit编号
var gateLevel = 2;              // 闯关模式：1速记 / 2选择 / 3 Unit综合测

// 词库元信息：pool → {name, short, units:[...], unitLabel, grid}
//   core  大纲词汇《你还在背单词吗》    Unit 1-14，按 4周25天打卡表调度
//   full  核心词汇《艾宾浩斯抗遗忘打卡》 Unit 1-10，按每词 8 格周期调度
//   c1500 六级1500核心词（2026年6月）   List 1-50，按每词 8 格周期调度
var POOL_IDS = ['core', 'full', 'c1500'];
var POOL_META = {
  core: { name: '📗 大纲词汇（你还在背单词吗·刘晓艳）', short: '📗 大纲词汇', unitLabel: 'Unit', grid: false,
          units: [1,2,3,4,5,6,7,8,9,10,11,12,13,14] },
  full: { name: '📚 核心词汇（艾宾浩斯打卡）', short: '📚 核心词汇', unitLabel: 'Unit', grid: true,
          units: [1,2,3,4,5,6,7,8,9,10] },
  c1500: { name: '🎯 六级1500核心词（2026年6月）', short: '🎯 1500核心词', unitLabel: 'List', grid: true,
          units: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,
                  31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50] }
};

function isKnownPool(poolName) { return POOL_IDS.indexOf(poolName) !== -1; }
// 「8 格周期」按词调度的词库（核心词汇 / 1500核心词）
function isGridPool(poolName) { var m = POOL_META[poolName]; return !!(m && m.grid); }
function poolLabel(poolName) { var m = POOL_META[poolName]; return m ? m.short : '📗 大纲词汇'; }
function poolUnitLabel(poolName) { var m = POOL_META[poolName]; return m ? m.unitLabel : 'Unit'; }
function poolUnits(poolName) { var m = POOL_META[poolName]; return m ? m.units : []; }
function maxUnitOfPool(poolName) { var u = poolUnits(poolName); return u.length ? u[u.length - 1] : 0; }

// 刘晓艳《你还在背单词吗》书末「艾宾浩斯抗遗忘复习打卡表」（4 周 25 天）。
// 14 个 Unit 全部参与自动打卡：第 1-14 天每天新学一个 Unit（学 Unit N，复习 N-1/N-3/N-6/N-11），
// 第 15-25 天只做复习，第 25 天收尾。每行第一个数是当天要新学的 Unit，其余是当天要复习的 Unit。
// 这张表严格照抄纸质打卡表，逐日逐项列全，不用间隔公式近似生成，避免再出现漏 Unit。
var EBING_UNITS = 14;
var EBBING_25_DAY_PLAN = [
  [1], [2, 1], [3, 2], [4, 1, 3], [5, 2, 4],
  [6, 3, 5], [7, 1, 4, 6], [8, 2, 5, 7], [9, 3, 6, 8], [10, 4, 7, 9],
  [11, 5, 8, 10], [12, 1, 6, 9, 11], [13, 2, 7, 10, 12], [14, 3, 8, 11, 13], [4, 9, 12, 14],
  [5, 10, 13], [6, 11, 14], [7, 12], [8, 13], [9, 14],
  [10], [11], [12], [13], [14]
];

function ebbingPlanUnits(dayN) {
  var units = EBBING_25_DAY_PLAN[Number(dayN) - 1];
  return units ? units.slice() : [];
}

function dayKeyForDate(d) {
  d = d || new Date();
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function legacyEbbingDay(startKey, now) {
  if (!startKey) return 1;
  var parts = startKey.split('-').map(Number);
  var start = new Date(parts[0], parts[1] - 1, parts[2]);
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.min(EBBING_25_DAY_PLAN.length, Math.floor((today - start) / 86400000) + 1));
}

function normalizeEbbingPlan(s, now) {
  if (!s.ebbingActive) return null;
  now = now || new Date();
  var todayKey = dayKeyForDate(now);
  var raw = isPlainObject(s.ebbingPlan) ? s.ebbingPlan : {};
  // Old state has only a calendar start date, not proof that earlier daily plans finished.
  // Begin it at Day 1 so an incomplete legacy plan is never skipped during migration.
  var day = finiteInt(raw.day, 1, 1, EBBING_25_DAY_PLAN.length);
  var planUnits = ebbingPlanUnits(day);
  var previous = Array.isArray(raw.completedUnits) ? raw.completedUnits : (s.ebbingUnitLog[todayKey] || []);
  var completed = [];
  previous.forEach(function(unit) {
    unit = Number(unit);
    if (planUnits.indexOf(unit) !== -1 && completed.indexOf(unit) === -1) completed.push(unit);
  });
  var validDayKey = typeof raw.dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dayKey) ? raw.dayKey : todayKey;
  return {
    day: day,
    dayKey: validDayKey,
    // settledKey：最近一次跨天结算所在的自然日。缺省视为已在 dayKey 当天
    // 结算过，避免旧存档/新建计划在创建当天就被提前推进。
    settledKey: typeof raw.settledKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.settledKey) ? raw.settledKey : validDayKey,
    completedUnits: completed,
    // 补做日标记（已废弃的强制重做机制）：保留字段兼容旧存档，
    // 新逻辑在跨天结算时一律清除，未完成的计划跨天延续进度。
    makeup: !!raw.makeup
  };
}

var state = loadState();

function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return normalizeState(JSON.parse(raw));
    }
  } catch(e) {}
  return normalizeState(null);
}


// ============ POOL UTILS ============
function getActivePool() {
  var pool = poolWords(currentPool);
  // Filter by selected units
  var allUnits = (selectedUnits.length === 0 || selectedUnits.indexOf(0) !== -1);
  if (allUnits) return pool;
  var unitSet = {};
  for (var ui = 0; ui < selectedUnits.length; ui++) unitSet[selectedUnits[ui]] = true;
  return pool.filter(function(w) { return unitSet[w.unit]; });
}

function getFullWordById(id) {
  // Look up in FULL_WORDS by ID (for full pool mode)
  ensureFullWords();
  return window._wordMaps.full.get(id) || null;
}

// Wrong-word tracking: keyed by mode + pool to separate each library
function wwKey(mode, poolName) { return mode + '_' + (poolName || currentPool); }

// 所有 词库×题型 的错题容器（清空/导入迁移/统计共用，新增词库时无需再手写键名）
function allWrongWordBuckets() {
  var buckets = {};
  ['cn2en', 'en2cn'].forEach(function(mode) {
    POOL_IDS.forEach(function(poolName) { buckets[mode + '_' + poolName] = {}; });
  });
  return buckets;
}
// 某题型在全部词库下的待重做错词总数
function wrongWordCount(mode) {
  var total = 0;
  POOL_IDS.forEach(function(poolName) {
    total += Object.keys((state.wrongWordIds || {})[mode + '_' + poolName] || {}).length;
  });
  return total;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      // Trim old history to reclaim space
      if (state.wrongHistory && state.wrongHistory.length > 200) {
        state.wrongHistory = state.wrongHistory.slice(0, 200);
      }
      if (state.retryHistory && state.retryHistory.length > 200) {
        state.retryHistory = state.retryHistory.slice(0, 200);
      }
      var dh = state.stats.dailyHistory;
      if (dh) {
        var keys = Object.keys(dh).sort();
        if (keys.length > 90) {
          keys.slice(0, keys.length - 90).forEach(function(k) { delete dh[k]; });
        }
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e2) {
        // Still can't save — silently give up
      }
    }
  }
}

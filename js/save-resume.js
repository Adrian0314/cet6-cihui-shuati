/* save-resume.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ SAVE / RESUME QUIZ ============
function suspendedQuestionSnapshots(q) {
  return (q.questions || []).map(function(question) {
    if (!question || !question.word || !Array.isArray(question.options)) return null;
    var optionIds = question.options.map(function(option) { return option && option.id; });
    if (optionIds.length !== question.options.length || optionIds.some(function(id) { return !isFinite(Number(id)) || Number(id) <= 0; })) return null;
    return {
      wordId: question.word.id,
      optionIds: optionIds,
      correctIndex: question.correctIndex
    };
  });
}

function restoreSuspendedQuestions(sq) {
  if (!Array.isArray(sq.questionSnapshots)) return [];
  var poolName = isKnownPool(sq.poolType) ? sq.poolType : 'core';
  ensurePool(poolName);
  return sq.questionSnapshots.map(function(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.optionIds)) return null;
    var word = getWord(snapshot.wordId, poolName);
    var options = snapshot.optionIds.map(function(id) { return getWord(id, poolName); });
    var correctIndex = Number(snapshot.correctIndex);
    if (!word || options.length !== 4 || options.some(function(option) { return !option; }) ||
        !isFinite(correctIndex) || correctIndex < 0 || correctIndex >= options.length ||
        options[correctIndex].id !== word.id) return null;
    return { word: word, options: options, correctIndex: Math.floor(correctIndex) };
  });
}

function isCurrentEbbingPlanSnapshot(sq, now) {
  if (!sq || !sq.isEbbingPlan || sq.poolType !== 'core' || !state.ebbingActive || !sq.ids || !sq.ids.length) return false;
  syncEbbingPlan(now || new Date());
  var plan = state.ebbingPlan;
  // 未完成的打卡计划跨天延续：只要计划没有推进到新的 Day（dayKey 不变），
  // 之前保存的做题队列就仍然有效，第二天可继续恢复，不再按日期清空。
  return !!plan && (!sq.ebbingPlanDayKey || sq.ebbingPlanDayKey === plan.dayKey);
}

// 修剪打卡存档里不属于 25 天计划（Unit 1-14 之外、无单元编号）的题目；
// 普通刷题及核心词库不变，按新题位重映射答案和题面，保留有效已答进度与当前位置。
function migrateEbbingPlanSnapshot(sq) {
  if (!sq || !sq.isEbbingPlan || sq.poolType !== 'core' || !Array.isArray(sq.ids)) return false;
  var keep = [];
  sq.ids.forEach(function(id, index) {
    var word = getWord(id, 'core');
    if (word && Number(word.unit) >= 1 && Number(word.unit) <= EBING_UNITS) keep.push(index);
  });
  if (keep.length === sq.ids.length) return false;
  var oldAnswers = sq.answers || {}, answers = {}, answered = {}, remaining = {}, units = [];
  var oldPos = Number(sq.pos) || 0;
  var nextPos = keep.findIndex(function(index) { return index >= oldPos; });
  var snapshots = sq.questionSnapshots || [];
  var ids = keep.map(function(index, newIndex) {
    var id = sq.ids[index], word = getWord(id, 'core');
    if (units.indexOf(word.unit) === -1) units.push(word.unit);
    if (Object.prototype.hasOwnProperty.call(oldAnswers, index)) {
      answers[newIndex] = oldAnswers[index];
      answered[id] = true;
    } else remaining[word.unit] = (remaining[word.unit] || 0) + 1;
    return id;
  });
  var removedCount = sq.ids.length - ids.length;
  sq.ids = ids;
  sq.answers = answers;
  sq.questionSnapshots = keep.map(function(index) { return snapshots[index] || null; });
  sq.pos = nextPos < 0 ? Math.max(0, ids.length - 1) : nextPos;
  sq.currentId = ids[sq.pos] || null;
  // 记忆模式已答题会从 ids 移除，累计 done/results 不能按剩余队列重算。
  if (!sq.isMemory) sq.done = Object.keys(answers).length;
  if (sq.isMemory) sq.memTotal = Math.max(Number(sq.done) || 0, (Number(sq.memTotal) || 0) - removedCount);
  sq.reviewCorrect = keep.filter(function(index) {
    var answer = oldAnswers[index], snapshot = snapshots[index];
    return (typeof answer === 'number' && snapshot && answer === snapshot.correctIndex) ||
      (answer && typeof answer === 'object' && (answer.correct === true || answer.gate1 === true));
  }).length;
  sq.ebbingPlanUnits = units;
  sq.ebbingPlanAnswered = answered;
  sq.ebbingPlanRemaining = remaining;
  if (sq === state.suspendedQuiz) {
    if (!ids.length) state.suspendedQuiz = null;
    saveState();
  }
  return true;
}

function suspendedEbbingPlanProgress(sq) {
  migrateEbbingPlanSnapshot(sq);
  if (!isCurrentEbbingPlanSnapshot(sq)) return null;
  var answers = sq.answers || {};
  var completed = 0;
  var units = [];
  sq.ids.forEach(function(id, index) {
    if (Object.prototype.hasOwnProperty.call(answers, index)) {
      completed++;
      return;
    }
    var word = getWord(id, 'core');
    if (word && units.indexOf(word.unit) === -1) units.push(word.unit);
  });
  return {
    total: sq.ids.length,
    completed: completed,
    remaining: sq.ids.length - completed,
    units: units
  };
}

function isExpiredEbbingPlanSnapshot(sq, now) {
  // 仅当打卡计划已推进到新的一天（或计划已停止）时，旧队列才算过期；
  // 未完成的计划跨天延续，旧队列照常可续。
  return !!(sq && sq.isEbbingPlan && sq.poolType === 'core' && !isCurrentEbbingPlanSnapshot(sq, now));
}

function suspendedQuizSnapshot(q) {
  return {
    mode: q.mode,
    isRetry: q.isRetry,
    isSmart: !!q.isSmart,
    isReview: !!q.isReview,
    isMemory: !!q.isMemory,
    ids: q.ids.slice(),
    pos: q.pos,
    answers: Object.assign({}, q.answers),
    done: q.done,
    reviewCorrect: q.reviewCorrect || 0,
    questionSnapshots: suspendedQuestionSnapshots(q),
    memoryResults: (q.memoryResults || []).slice(),
    isEbbingPlan: !!q.isEbbingPlan,
    ebbingPlanDayKey: q.isEbbingPlan && state.ebbingPlan ? state.ebbingPlan.dayKey : null,
    ebbingPlanUnits: (q.ebbingPlanUnits || []).slice(),
    ebbingPlanRemaining: Object.assign({}, q.ebbingPlanRemaining || {}),
    ebbingPlanAnswered: Object.assign({}, q.ebbingPlanAnswered || {}),
    poolType: q.poolType || currentPool,
    currentId: q.current ? q.current.word.id : null,
    memWrong: q.memWrong || 0,
    memTotal: q.memTotal || q.ids.length
  };
}

// Save an in-progress quiz without leaving the quiz or changing its UI state.
// This is intentionally synchronous: localStorage writes complete before a
// mobile browser is allowed to discard the page, and the snapshot is compact
// (ids/answers/question option ids rather than the full word objects).
function saveActiveQuizProgress() {
  if (!quizActive || !quizState || !quizState.current || !quizState.ids || !quizState.ids.length) return false;
  state.suspendedQuiz = suspendedQuizSnapshot(quizState);
  saveState();
  return true;
}

function initializeEbbingPlanQuiz() {
  if (!quizState || !quizState.isEbbingPlan || quizState.poolType !== 'core') return;
  quizState.ebbingPlanUnits = dueUnitsByEbbing();
  quizState.ebbingPlanRemaining = {};
  quizState.ebbingPlanAnswered = {};
  quizState.ids.forEach(function(id) {
    var word = getWord(id, 'core');
    if (word && quizState.ebbingPlanUnits.indexOf(word.unit) !== -1) {
      quizState.ebbingPlanRemaining[word.unit] = (quizState.ebbingPlanRemaining[word.unit] || 0) + 1;
    }
  });
}

function trackEbbingPlanQuestion(word) {
  if (!quizState || !quizState.isEbbingPlan || !word || quizState.ebbingPlanAnswered[word.id]) return;
  if (!quizState.ebbingPlanRemaining || !quizState.ebbingPlanRemaining[word.unit]) return;
  quizState.ebbingPlanAnswered[word.id] = true;
  quizState.ebbingPlanRemaining[word.unit]--;
  if (quizState.ebbingPlanRemaining[word.unit] === 0) markEbbingPlanUnitComplete(word.unit, new Date());
}

function saveSuspendedQuiz() {
  if (!quizActive) return;
  state.suspendedQuiz = suspendedQuizSnapshot(quizState);
  saveState();
  quizActive = false;
  quizState.isRetry = false;
  document.getElementById('retryInfo').classList.remove('show');
}

function checkSuspendedQuiz() {
  migrateEbbingPlanSnapshot(state.suspendedQuiz);
  var sq = state.suspendedQuiz;
  if (isExpiredEbbingPlanSnapshot(sq)) {
    state.suspendedQuiz = null;
    saveState();
    document.getElementById('savedBar').classList.remove('show');
    return;
  }
  if (isCurrentEbbingPlanSnapshot(sq)) {
    // Reconcile learned Units before checking completion. Legacy snapshots
    // may not yet contain today's newly learned Unit in completedUnits.
    var currentPlan = syncEbbingPlan();
    if (currentPlan && isEbbingPlanComplete(currentPlan) && dueUnitsByEbbing().length === 0) {
      state.suspendedQuiz = null;
      saveState();
      document.getElementById('savedBar').classList.remove('show');
      return;
    }
  }
  // A mobile browser can be terminated immediately after the last answer,
  // before finishQuiz() clears the snapshot. Do not resurrect that completed
  // plan queue on the next launch.
  if (sq && sq.isEbbingPlan && sq.poolType === 'core' && Array.isArray(sq.ids) && sq.ids.length &&
      Object.keys(sq.answers || {}).length >= sq.ids.length) {
    state.suspendedQuiz = null;
    saveState();
    document.getElementById('savedBar').classList.remove('show');
    return;
  }
  var remaining = sq ? (sq.ids || (sq.remaining || [])).length : 0;
  if (sq && remaining > 0) {
    var done = Math.max(0, Math.min(remaining, Number(sq.done) || 0));
    document.getElementById('savedInfo').textContent =
      '暂存的做题进度 — ' + (sq.poolType === 'full' ? '📚 核心词汇（艾宾浩斯打卡）' : '📗 大纲词汇（你还在背单词吗·刘晓艳）') +
      ' · ' + (sq.mode === 'cn2en' ? '看中文选英文' : '看英文选中文') +
      (sq.isRetry ? '（重做模式）' : '') +
      ' — 已完成' + done + '题，待完成' + Math.max(0, remaining - done) + '题（共' + remaining + '题）';
    document.getElementById('savedBar').classList.add('show');
    // 不覆盖 currentMode/模式按钮高亮——避免切换模式/题型/词库后被静默拨回挂起的旧模式(恢复做题时由 resumeQuiz 按挂起进度设置)
  }
}

function resumeQuiz() {
  migrateEbbingPlanSnapshot(state.suspendedQuiz);
  var sq = state.suspendedQuiz;
  if (!sq) return;
  if (isExpiredEbbingPlanSnapshot(sq)) {
    discardSaved();
    alert('打卡计划已进入新的一天，旧的做题队列已清除，请开始今天的复习。');
    return;
  }
  // The full (Ebbinghaus) pool is loaded asynchronously on page startup. A
  // quick tap on a phone can otherwise restore against an empty map and mark
  // every saved question as missing. Wait for the loader before rebuilding the
  // queue, while keeping the snapshot intact if loading fails.
  if (sq.poolType === 'full' && !_fullWordsLoaded) {
    if (window._resumeQuizLoading) return;
    window._resumeQuizLoading = true;
    var resumeBtn = document.querySelector('#savedBar button[onclick="resumeQuiz()"]');
    if (resumeBtn) {
      resumeBtn.disabled = true;
      resumeBtn.dataset.resumeLoading = '1';
      resumeBtn.textContent = '加载词库中…';
    }
    ensurePool(sq.poolType || currentPool, function() {
      window._resumeQuizLoading = false;
      if (resumeBtn && resumeBtn.dataset.resumeLoading === '1') {
        resumeBtn.disabled = false;
        resumeBtn.textContent = '继续做题';
        delete resumeBtn.dataset.resumeLoading;
      }
      if (!isPoolLoaded(sq.poolType || currentPool)) {
        alert(poolLabel(sq.poolType || currentPool) + '数据加载失败，请检查网络后重试。');
        return;
      }
      resumeQuiz();
    });
    return;
  }
  if (!sq.ids || sq.ids.length === 0) {
    // 旧版挂起数据无法恢复（无题目列表），丢弃
    state.suspendedQuiz = null;
    saveState();
    document.getElementById('savedBar').classList.remove('show');
    alert('暂存的做题进度已失效，请重新开始');
    return;
  }
  currentPool = sq.poolType || 'core';
  updatePoolUI();
  currentMode = sq.mode;
  var savedModeSelect = document.getElementById('modeSelect');
  if (savedModeSelect) savedModeSelect.value = sq.mode;
  quizState = {
    mode: sq.mode,
    isRetry: sq.isRetry,
    isSmart: !!sq.isSmart,
    isReview: !!sq.isReview,
    isMemory: !!sq.isMemory,
    ids: sq.ids.slice(),
    pos: -1,
    questions: restoreSuspendedQuestions(sq),
    answers: Object.assign({}, sq.answers || {}),
    done: sq.done || 0,
    current: null,
    reviewCorrect: sq.reviewCorrect || 0,
    poolType: sq.poolType || 'core',
    memWrong: sq.memWrong || 0,
    memTotal: sq.memTotal || sq.ids.length,
    memoryResults: Array.isArray(sq.memoryResults) ? sq.memoryResults.slice() : [],
    isEbbingPlan: !!sq.isEbbingPlan,
    ebbingPlanUnits: Array.isArray(sq.ebbingPlanUnits) ? sq.ebbingPlanUnits.slice() : [],
    ebbingPlanRemaining: Object.assign({}, sq.ebbingPlanRemaining || {}),
    ebbingPlanAnswered: Object.assign({}, sq.ebbingPlanAnswered || {})
  };
  quizActive = true;
  state.suspendedQuiz = null;
  savePrefs(); // 恢复挂起的词库/模式同步到 prefs，避免刷新后回退
  document.getElementById('savedBar').classList.remove('show');
  document.getElementById('retryInfo').classList.toggle('show', quizState.isRetry);
  // 恢复被挂起的复习进度时，重新强制复习题型为选择题
  if (quizState.isReview) {
    currentQuizType = 'choice';
    var suspendedTypeSelect = document.getElementById('typeSelect');
    if (suspendedTypeSelect) suspendedTypeSelect.value = 'choice';
  }
  goToQuestion(typeof sq.pos === 'number' ? sq.pos : 0);
  renderAll();
}

function discardSaved() {
  state.suspendedQuiz = null;
  saveState();
  document.getElementById('savedBar').classList.remove('show');
}

// ============ PREFS (做题模式持久化：词库/单元/闯关/模式/题型/记忆/自动朗读) ============
function savePrefs() {
  state.prefs = {
    pool: currentPool,
    units: selectedUnits.slice(),
    gate: gateLevel,
    mode: currentMode,
    type: currentQuizType,
    memory: memoryModeOn(),
    autoSpeak: !!autoSpeakEnabled
  };
  saveState();
}
function updateAutoSpeakUI() {
  var btn = document.getElementById('autoSpeakBtn');
  if (!btn) return;
  btn.classList.toggle('active', !!autoSpeakEnabled);
  btn.textContent = '自动朗读：' + (autoSpeakEnabled ? '开' : '关');
  btn.setAttribute('aria-pressed', autoSpeakEnabled ? 'true' : 'false');
  btn.title = autoSpeakEnabled
    ? '已开启：仅在看英文选中文模式下自动朗读每道新题'
    : '已关闭：点击开启看英文选中文自动朗读';
}
function toggleAutoSpeak() {
  autoSpeakEnabled = !autoSpeakEnabled;
  updateAutoSpeakUI();
  savePrefs();
  showImportMsg(autoSpeakEnabled
    ? '🔊 自动朗读已开启（仅看英文选中文）'
    : '已关闭自动朗读', 'ok');
  return autoSpeakEnabled;
}
function applyPrefs() {
  var p = state.prefs || {};
  if (p.pool) currentPool = p.pool;
  if (p.units && p.units.length) selectedUnits = p.units.indexOf(0) !== -1 ? [0] : [p.units[0]];
  if (p.gate) gateLevel = p.gate;
  if (p.mode) currentMode = p.mode;
  if (p.type) currentQuizType = p.type;
  autoSpeakEnabled = !!p.autoSpeak;
  var modeSelect = document.getElementById('modeSelect');
  var typeSelect = document.getElementById('typeSelect');
  var gateSelect = document.getElementById('gateSelect');
  if (modeSelect) modeSelect.value = currentMode;
  if (typeSelect) typeSelect.value = currentQuizType;
  if (gateSelect) gateSelect.value = String(gateLevel);
  var mBtn = document.getElementById('memoryBtn');
  if (mBtn) mBtn.classList.toggle('active', !!p.memory);
  updateAutoSpeakUI();
  if (p.pool) updatePoolUI();
}

// ============ KEEP PREFS ON EXIT (退出做题模式时选择是否保留当前模式；没选择直接退出则默认保留) ============
var _sessionPrefsSnapshot = null; // 本次会话「上次已保存」的模式快照（进入页面时记录）
function prefsCopy(p) {
  return JSON.parse(JSON.stringify(p || {}));
}
function prefsDiffer(a, b) {
  a = a || {}; b = b || {};
  return a.pool !== b.pool || a.size !== b.size || a.gate !== b.gate ||
    a.mode !== b.mode || a.type !== b.type || !!a.memory !== !!b.memory ||
    !!a.autoSpeak !== !!b.autoSpeak ||
    (a.units && b.units ? a.units.join(',') !== b.units.join(',') : a.units !== b.units);
}
function updatePrefsSnapshot() {
  _sessionPrefsSnapshot = prefsCopy(state.prefs);
}
// 「回到上次已保存」：把内存与 state.prefs 恢复为进入本页时的快照
function revertPrefsToSnapshot() {
  if (!_sessionPrefsSnapshot) return;
  state.prefs = prefsCopy(_sessionPrefsSnapshot);
  currentPool = state.prefs.pool || currentPool;
  selectedUnits = state.prefs.units ? state.prefs.units.slice() : selectedUnits;
  gateLevel = state.prefs.gate || gateLevel;
  currentMode = state.prefs.mode || currentMode;
  currentQuizType = state.prefs.type || currentQuizType;
  autoSpeakEnabled = !!state.prefs.autoSpeak;
  applyPrefs();
  saveState();
}
// 非阻塞底部提示条：「保留当前模式」/「回到上次已保存」；可忽略（×）＝默认保留当前模式
function askKeepPrefs() {
  var differ = _sessionPrefsSnapshot && prefsDiffer(state.prefs, _sessionPrefsSnapshot);
  if (!differ) return;
  if (document.getElementById('keepPrefsBar')) return;
  var bar = document.createElement('div');
  bar.id = 'keepPrefsBar';
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:350;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:10px 16px;background:var(--surface);border-top:1px solid var(--border);box-shadow:0 -4px 16px rgba(0,0,0,0.15);font-size:0.9em;';
  bar.innerHTML = '<span style="color:var(--text2);">本次调整了做题模式，是否保留？</span>' +
    '<button class="ctrl-btn accent" id="keepPrefsYes">✓ 保留当前模式</button>' +
    '<button class="ctrl-btn" id="keepPrefsNo">↩ 回到上次已保存</button>' +
    '<button class="ctrl-btn" id="keepPrefsClose" title="忽略（默认保留当前模式）">×</button>';
  document.body.appendChild(bar);
  document.getElementById('keepPrefsYes').addEventListener('click', function() {
    bar.remove(); updatePrefsSnapshot(); // 保留当前 → 快照更新为本次调整后的模式
  });
  document.getElementById('keepPrefsNo').addEventListener('click', function() {
    bar.remove(); revertPrefsToSnapshot(); // 回到上次已保存
  });
  document.getElementById('keepPrefsClose').addEventListener('click', function() {
    bar.remove(); updatePrefsSnapshot(); // 忽略 → 默认保留当前模式（不再提示）
  });
}

// ============ AUTO-SAVE ON EXIT (退出页面自动保留做题进度，不打断当前做题) ============
function autoSaveProgress() {
  saveActiveQuizProgress();
}

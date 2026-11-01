/* quiz-engine.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ UTILS ============
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function nowStr() {
  var d = new Date();
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' +
         pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function localDateKey(d) {
  d = d || new Date();
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// ============ QUIZ ENGINE (LAZY) ============
var quizState = {
  mode: 'cn2en',
  isRetry: false,
  isSmart: false,
  isMemory: false,
  ids: [],
  pos: -1,
  questions: [],
  answers: {},
  memoryResults: [],
  done: 0,
  current: null
};

var currentMode = 'en2cn';
var currentQuizType = 'choice';
var autoSpeakEnabled = false;
var quizActive = false;

function buildQuiz(mode, wordPool) {
  var pool = wordPool || getActivePool();
  var ids = pool.map(function(w) { return w.id; });
  // 过滤无效 id（数据异常保护）
  ids = ids.filter(function(id) { return getWord(id, currentPool) !== null; });
  // 队列：当前筛选范围的全部单词（按书中顺序）；重做模式为全部错题乱序
  var ordered = ids;
  var finalIds = (!!wordPool) ? shuffle(ordered) : ordered;
  quizState = {
    mode: mode,
    isRetry: !!wordPool,
    isSmart: false,
    isReview: false,
    isMemory: false,
    ids: finalIds,
    pos: -1,
    questions: [],
    answers: {},
    memoryResults: [],
    done: 0,
    current: null,
    poolType: currentPool,
    gate: gateLevel
  };
  quizActive = true;
  document.getElementById('retryInfo').classList.toggle('show', quizState.isRetry);
}

function startNewQuiz(mode) {
  buildQuiz(mode, null);
  advanceQuestion();
  renderAll();
}

function startRetryQuiz(mode) {
  var ws = state.wrongWordIds[wwKey(mode)] || {};
  var ids = Object.keys(ws).map(Number);
  if (ids.length === 0) { alert('当前模式没有错题可以重做！'); return; }
  if (ids.length < 4) { alert('当前模式错题不足4道'); return; }
  var words = ids.map(function(id) { return getWord(id, currentPool); }).filter(Boolean);
  if (words.length < 4) { alert('错题数据异常'); return; }
  buildQuiz(mode, words);
  advanceQuestion();
  renderAll();
}

function generateOneQuestion(word) {
  var distractors = getDistractors(word, quizState.mode, 3);
  var cwLower = word.word.toLowerCase();
  // Track seen word texts (start with correct answer)
  var seenText = Object.create(null);
  seenText[cwLower] = true;
  // Deduplicate distractors by word text
  var clean = [];
  for (var d = 0; d < distractors.length; d++) {
    var dt = distractors[d].word.toLowerCase();
    if (!seenText[dt]) {
      clean.push(distractors[d]);
      seenText[dt] = true;
    }
  }
  // Fill shortage with random words from pool
  if (clean.length < 3) {
    var bankPool = (currentPool === 'core') ? ALL_WORDS : (ensureFullWords(), (FULL_WORDS || []));
    var shuffled = bankPool.slice().sort(function() { return Math.random() - 0.5; });
    var selected = [word].concat(clean);
    for (var k = 0; k < shuffled.length && clean.length < 3; k++) {
      var st = shuffled[k].word.toLowerCase();
      if (seenText[st] || !isUsableDistractor(shuffled[k], word, quizState.mode)) continue;
      // 补位候选同样不得与正确答案或已选干扰项释义过近
      if (quizState.mode !== 'cn2en') {
        var near = false;
        for (var s = 0; s < selected.length; s++) {
          if (meaningsTooClose(shuffled[k], selected[s])) { near = true; break; }
        }
        if (near) continue;
      }
      clean.push(shuffled[k]);
      seenText[st] = true;
      selected.push(shuffled[k]);
    }
  }

  var options = shuffle([word].concat(clean.slice(0, 3)));  var options = shuffle([word].concat(clean.slice(0, 3)));
  var correctIndex = -1;
  for (var i = 0; i < options.length; i++) {
    if (options[i].id === word.id) { correctIndex = i; break; }
  }
  return { word: word, options: options, correctIndex: correctIndex };
}

function advanceQuestion() {
  if (!quizActive) return;
  if (quizState.isMemory) {
    if (quizState.pos < 0) { goToQuestion(0); return; } // 首次进入
    // 记忆模式：做完当前题即从队列删除，下一题顶上（错词已由 recordStat 更新间隔，到期自动回来）
    quizState.ids.splice(quizState.pos, 1);
    if (quizState.ids.length === 0) { finishQuiz(); return; }
    if (quizState.pos >= quizState.ids.length) quizState.pos = quizState.ids.length - 1;
    quizState.questions.splice(quizState.pos, 1);
    quizState.answers = {};
    goToQuestion(quizState.pos);
    return;
  }
  if (quizState.pos >= quizState.ids.length - 1) { finishQuiz(); return; }
  goToQuestion(quizState.pos + 1);
}

function goToQuestion(pos) {
  if (!quizActive) return;
  if (pos < 0 || pos >= quizState.ids.length) return;
  quizState.pos = pos;
  if (!quizState.questions[pos]) {
    var word = getWord(quizState.ids[pos], quizState.poolType || currentPool);
    if (!word) {
      // 数据缺失题：标记跳过，前进到下一题
      quizState.answers[pos] = 'skip';
      if (pos >= quizState.ids.length - 1) { finishQuiz(); return; }
      advanceQuestion();
      return;
    }
    quizState.questions[pos] = generateOneQuestion(word);
  }
  quizState.current = quizState.questions[pos];
  // Persist the active queue/position as soon as a question is available. Mobile
  // browsers may terminate a backgrounded page without firing unload reliably.
  saveActiveQuizProgress();
  renderQuizCard();
  speakQuestionAutomatically();
}

// 自动朗读只在“看英文 → 选中文”模式生效，并且以题目切换为边界，避免
// 答题反馈、统计刷新或其他局部重绘导致同一道题重复朗读。
var _autoSpeakLastQuizState = null;
var _autoSpeakLastPos = -1;
var _autoSpeakLastWordId = null;
function speakQuestionAutomatically() {
  if (!autoSpeakEnabled || !quizState || quizState.mode !== 'en2cn' || !quizState.current || !quizState.current.word) return;
  var word = quizState.current.word;
  if (_autoSpeakLastQuizState === quizState && _autoSpeakLastPos === quizState.pos && _autoSpeakLastWordId === word.id) return;
  _autoSpeakLastQuizState = quizState;
  _autoSpeakLastPos = quizState.pos;
  _autoSpeakLastWordId = word.id;
  speakWord(word.word);
}

function prevQuestion() {
  if (quizState.pos > 0) goToQuestion(quizState.pos - 1);
}

function jumpToQuestion(n) {
  var idx = parseInt(n);
  if (!isNaN(idx) && idx >= 1 && idx <= quizState.ids.length) goToQuestion(idx - 1);
}

function isAnswered(pos) {
  return quizState.answers.hasOwnProperty(pos);
}

function recordMemoryProgress(status) {
  if (!quizState || !quizState.isMemory) return;
  if (!Array.isArray(quizState.memoryResults)) quizState.memoryResults = [];
  quizState.memoryResults.push(status);
}

function isAnsweredCorrectly(pos) {
  var a = quizState.answers[pos];
  if (a === 'skip') return false;
  if (typeof a === 'object' && a !== null) return !!a.correct; // 默写
  var q = quizState.questions[pos];
  if (!q) return false; // 兼容旧版未保存题目快照的暂存记录
  return q !== null && a === q.correctIndex;
}

function quizCompletionControlsHTML() {
  var card = document.getElementById('quizCard');
  var isFullscreen = card && card.classList.contains('fullscreen');
  var canStartEbbingPlan = currentPool === 'full' && !state.ebbingActive;
  return '<div class="completion-actions" style="display:flex;justify-content:center;gap:10px;margin-top:18px;">' +
    (canStartEbbingPlan ? '<button class="ctrl-btn accent" id="startEbbingPlanBtn" onclick="startEbbingPlanFromCompletion()">\u{1F4C5} \u5f00\u59cb 4 \u5468 25 \u5929\u6253\u5361\u8868</button>' : '') +
    '<button class="ctrl-btn" id="returnToStartBtn" onclick="returnToQuizStart()">\u21a9 \u8fd4\u56de\u4e3b\u9875\u9762</button>' +
    (isFullscreen ? '<button class="toggle-fs-btn" id="toggleFsBtn" onclick="toggleFullscreen()">\u26f6 \u9000\u51fa\u5168\u5c4f</button>' : '') +
    '</div>';
}

function startEbbingPlanFromCompletion() {
  currentPool = 'core';
  var poolSelect = document.getElementById('poolSelect');
  if (poolSelect) poolSelect.value = currentPool;
  updatePoolUI();
  savePrefs();
  activateEbbing();
  returnToQuizStart();
}

function returnToQuizStart() {
  var card = document.getElementById('quizCard');
  if (card && card.classList.contains('fullscreen')) toggleFullscreen();
  var quizTab = document.querySelector('.tab-btn[data-tab="quiz"]');
  if (quizTab) switchTab('quiz', quizTab);
  try { window.scrollTo(0, 0); } catch (e) {}
}

function finishQuiz() {
  quizActive = false;
  // A completed round must not reappear as a resumable stale snapshot after reload.
  state.suspendedQuiz = null;
  var total = quizState.ids.length;
  var done = quizState.done;
  var card = document.getElementById('quizCard');
  if (quizState.isReview) {
    var rc = quizState.reviewCorrect || 0;
    var rate = done > 0 ? Math.round(rc / done * 100) : 0;
    card.innerHTML = '<div class="empty"><div class="ei">🧠</div><p>复习完成！共 ' + total + ' 题，已答 ' + done + ' 题，答对 ' + rc + ' 题（' + rate + '%）</p>' +
      '<p style="font-size:0.85em;color:var(--text2);margin-top:6px;">' +
      (isGridPool(currentPool) ? poolLabel(currentPool) + '已按 8 格周期（5分/30分/12时/1天/2天/4天/7天）推进，到期的词会再次出现' : '大纲词汇已按 4周25天打卡表，当天到期的 Unit 已标记复习完成') +
      '</p></div>' + quizCompletionControlsHTML();
  } else if (quizState.isMemory) {
    var mw = quizState.memWrong || 0;
    var mc = done - mw;
    card.innerHTML = '<div class="empty"><div class="ei">🧠</div><p>记忆模式完成！本次共学习 ' + quizState.memTotal + ' 词，答对 ' + mc + ' 词</p>' +
      '<p style="font-size:0.85em;color:var(--text2);margin-top:6px;">答错 ' + mw + ' 词已加入记忆调度：错词按当前词库的书中记忆规律（4周25天打卡表 / 8格周期）自动排期回来</p></div>';
  } else {
    card.innerHTML = '<div class="empty"><div class="ei">\u{1F389}</div><p>本轮题目全部完成！共 ' + total + ' 题，已答 ' + done + ' 题</p></div>' + quizCompletionControlsHTML();
  }
  document.getElementById('startBtn').style.display = 'inline-block';
  document.getElementById('startBtn').textContent = '▶ 再来一轮';
  document.getElementById('retryInfo').classList.remove('show');
  quizState.isRetry = false;
  quizState.isReview = false;
  quizState.isMemory = false;
  quizState.isSmart = false;
  // 复习强制选择题，完成后恢复用户此前保存的题型
  if (window._prevQuizTypeBeforeReview) {
    currentQuizType = window._prevQuizTypeBeforeReview;
    var restoredTypeSelect = document.getElementById('typeSelect');
    if (restoredTypeSelect) restoredTypeSelect.value = currentQuizType;
    window._prevQuizTypeBeforeReview = null;
    savePrefs();
  }
  // 完成一轮后，若本会话调整了做题模式，弹窗询问是否保留（没选择直接退出则默认保留；选「回到上次」即恢复快照）
  if (typeof askKeepPrefs === 'function') askKeepPrefs(null);
  renderAll();
  saveState();
}

// ============ SPACED REPETITION (REVIEW) ============
// 双书记忆规律：
// - 大纲词汇（刘晓艳）：书末「艾宾浩斯抗遗忘复习打卡表」4周25天，Unit 级调度（每天学1个新Unit，+1/+3/+6/+12天复习）
// - 核心词汇（艾宾浩斯）：书内每词 8 格记忆周期（首次学习 + 5分/30分/12时 + 1天/2天/4天/7天）
var REVIEW_DAY = 86400000;
var GRID_OFFSETS = [5 * 60000, 30 * 60000, 12 * 3600000, 1 * REVIEW_DAY, 2 * REVIEW_DAY, 4 * REVIEW_DAY, 7 * REVIEW_DAY];
var GRID_NAMES = ['5分', '30分', '12时', '1天', '2天', '4天', '7天'];

function dayKeyStr(d) { return localDateKey(d); }

// 从 ebbingStart 起今天是第几天（1 起）
function ebbingDayIndex(now) {
  if (!state.ebbingActive) return 0;
  syncEbbingPlan(now || new Date());
  return state.ebbingPlan ? state.ebbingPlan.day : 0;
}

function syncEbbingPlan(now) {
  if (!state.ebbingActive) return null;
  now = now || new Date();
  if (!state.ebbingPlan) state.ebbingPlan = normalizeEbbingPlan(state, now);
  var plan = state.ebbingPlan;
  var todayKey = dayKeyStr(now);
  var changed = false;
  if (plan.settledKey !== todayKey) {
    // 每个自然日只做一次跨天结算（settledKey 标记），避免当天完成任务后
    // 被后续同步立即推进到下一天；推进只发生在自然日切换后的首次结算。
    plan.settledKey = todayKey;
    changed = true;
    var completed = isEbbingPlanComplete(plan);
    if (!completed) {
      // 兼容旧版漏记：旧逻辑只在复习队列/记忆模式里累计 Unit 完成数，通过
      // 普通做题、智能练习等路径完成的任务可能一个 Unit 都没记上。
      // 以本计划日开始后的实际作答记录补判，避免已完成的任务被重复清做。
      completed = isEbbingPlanFullyAnsweredBetween(plan, startOfDayKeyMs(plan.dayKey), Infinity);
    }
    if (completed) {
      // 该日任务全部完成 → 进入下一天并领取新的任务清单。
      plan.dayKey = todayKey;
      if (plan.day < EBBING_25_DAY_PLAN.length) {
        plan.day++;
        plan.completedUnits = [];
      }
    }
    // 未完成：不再清空进度、不再强制重做（废除补做日机制）——
    // plan.dayKey 保持为该计划日的开始日，已完成的 Unit 与挂起的做题
    // 队列原样延续到今天接着做；直到该日任务全部做完，才在下一个
    // 自然日的结算时进入下一天。清除 makeup，昨天的作答记录照常有效。
    plan.makeup = false;
  }
  // Reconcile today's actual practice into the plan no matter which quiz path
  // produced it (复习队列 / 记忆模式 / 普通开始做题 / 智能练习 / 默写)：
  // - 当天新 Unit：每个词有过作答即视为学完（未完成的计划跨天延续，
  //   前几天的作答记录照常有效）；
  // - 到期复习 Unit：每个词在今天 0 点后都答过才算复习完成，防止只靠旧记录混过。
  var todayUnit = ebbingTodayNewUnit(plan);
  if (todayUnit && isEbbingTodayNewUnitDone(todayUnit, plan, now)) {
    changed = addEbbingPlanUnitCompletion(plan, todayUnit, now) || changed;
  }
  ebbingPlanUnits(plan.day).forEach(function(unit) {
    if (isEbbingUnitReviewedToday(unit, now)) {
      changed = addEbbingPlanUnitCompletion(plan, unit, now) || changed;
    }
  });
  if (changed) saveState();
  return plan;
}

// 当天要新学的 Unit：第 1-14 天每天一个；第 15 天起只有复习，没有新单元。
function ebbingTodayNewUnit(plan) {
  var day = plan ? Number(plan.day) : 0;
  return day >= 1 && day <= EBING_UNITS ? day : 0;
}

// 当天新 Unit 是否算学完：正常日沿用「该 Unit 所有词有过作答」，
// 补做日（前一天未完成）必须「所有词今天都答过」，强制把前一天的计划重做一遍。
function isEbbingTodayNewUnitDone(unit, plan, now) {
  if (!unit) return false;
  if (plan && plan.makeup) return isEbbingUnitReviewedToday(unit, now);
  return isEbbingUnitLearned(unit);
}

function isEbbingPlanComplete(plan) {
  var scheduled = plan ? ebbingPlanUnits(plan.day) : [];
  return !!plan && scheduled.every(function(unit) {
    return plan.completedUnits.indexOf(unit) !== -1;
  });
}

function startOfTodayMs(now) {
  now = now || new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// 'YYYY-MM-DD' → 当地当天 0 点的时间戳（解析失败返回 0）
function startOfDayKeyMs(key) {
  var parts = String(key || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(function(n) { return !isFinite(n); })) return 0;
  return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
}

// 每个 Unit 的词列表按需缓存（ALL_WORDS 静态，Unit 划分不变）
function ebbingUnitWords(unit) {
  var cache = window._ebbingUnitWordsCache || (window._ebbingUnitWordsCache = {});
  unit = Number(unit);
  if (!cache[unit]) {
    cache[unit] = ALL_WORDS.filter(function(word) { return Number(word.unit) === unit; });
  }
  return cache[unit];
}

// A new Unit is considered learned once every word in that Unit has at least
// one recorded attempt in the outline pool. This keeps the day's new Unit
// from being offered again as a full review queue after the learning session.
function isEbbingUnitLearned(unit) {
  unit = Number(unit);
  if (!isFinite(unit) || unit <= 0) return false;
  var words = ebbingUnitWords(unit);
  if (words.length === 0) return false;
  var attempts = (state.stats && state.stats.wordAttempts) || {};
  return words.every(function(word) {
    var wa = attempts[wordStateKey(word.id, 'core')];
    return !!(wa && Number(wa.attempts) > 0);
  });
}

// 「今天已复习」判定：该 Unit 每个词在今天 0 点之后都答过至少一次。
// 以 lastTime 实际作答时间为准，而不是打卡队列自己的计数，
// 这样普通做题、智能练习、默写里完成的复习同样计入打卡。
function isEbbingUnitReviewedToday(unit, now) {
  return isEbbingUnitFullyAnsweredBetween(unit, startOfTodayMs(now), Infinity);
}

function isEbbingPlanFullyAnsweredBetween(plan, fromMs, toMs) {
  return ebbingPlanUnits(plan.day).every(function(unit) {
    return isEbbingUnitFullyAnsweredBetween(unit, fromMs, toMs);
  });
}

function isEbbingUnitFullyAnsweredBetween(unit, fromMs, toMs) {
  unit = Number(unit);
  if (!isFinite(unit) || unit <= 0) return false;
  var words = ebbingUnitWords(unit);
  if (words.length === 0) return false;
  var attempts = (state.stats && state.stats.wordAttempts) || {};
  return words.every(function(word) {
    var wa = attempts[wordStateKey(word.id, 'core')];
    return !!(wa && Number(wa.lastTime) >= fromMs && Number(wa.lastTime) < toMs);
  });
}

function addEbbingPlanUnitCompletion(plan, unit, now) {
  if (!plan) return false;
  var scheduled = ebbingPlanUnits(plan.day);
  unit = Number(unit);
  if (scheduled.indexOf(unit) === -1 || plan.completedUnits.indexOf(unit) !== -1) return false;
  plan.completedUnits.push(unit);
  var key = dayKeyStr(now || new Date());
  if (!state.ebbingUnitLog[key]) state.ebbingUnitLog[key] = [];
  if (state.ebbingUnitLog[key].indexOf(unit) === -1) state.ebbingUnitLog[key].push(unit);
  return true;
}

function markEbbingPlanUnitComplete(unit, now) {
  var plan = syncEbbingPlan(now);
  if (!plan) return;
  if (!addEbbingPlanUnitCompletion(plan, unit, now)) return;
  saveState();
  renderEbbingPlan(now);
}

// 已学过的 Unit 数（答过题的 unit 集合，最多14）
function learnedUnitCount() {
  var st = state.stats;
  var units = {};
  Object.keys(st.wordAttempts).forEach(function(key) {
    if (wordPoolFromStateKey(key) !== 'core') return;
    var w = getWord(wordIdFromStateKey(key), 'core');
    if (w && w.unit) units[w.unit] = true;
  });
  var max = 0;
  for (var u in units) if (Number(u) > max) max = Number(u);
  return max;
}

// 大纲词汇：4周25天表 → 今天到期复习的 Unit
function dueUnitsByEbbing(now) {
  var plan = syncEbbingPlan(now || new Date());
  if (!plan) return [];
  return ebbingPlanUnits(plan.day).filter(function(unit) {
    // Once today's new Unit has been fully learned, it is no longer a review
    // target. Older scheduled Units remain due until their review is finished.
    // 补做日按更严的「今天答过」判定，前一天学过的新 Unit 同样要重做。
    var todayUnit = ebbingTodayNewUnit(plan);
    if (unit === todayUnit && isEbbingTodayNewUnitDone(unit, plan, now)) return false;
    return plan.completedUnits.indexOf(unit) === -1;
  });
}

// 核心词汇：8格周期 → 到期未完成格的词
function dueWordsByGrid(poolName) {
  var pool = isKnownPool(poolName) ? poolName : (isGridPool(currentPool) ? currentPool : 'full');
  var st = state.stats;
  var now = Date.now();
  var due = [];
  Object.keys(st.wordAttempts).forEach(function(key) {
    if (wordPoolFromStateKey(key) !== pool) return;
    var wa = st.wordAttempts[key];
    if (!wa.learnedAt) return;
    var dueAt = fullGridDueAt(wa);
    if (dueAt !== null && dueAt <= now) due.push(wordIdFromStateKey(key));
  });
  return due;
}

function fullGridNextIndex(wa) {
  var grid = wa.grid || [];
  for (var i = 0; i < GRID_OFFSETS.length; i++) if (!grid[i]) return i;
  return -1;
}

function fullGridDueAt(wa) {
  if (!wa || !wa.learnedAt) return null;
  var idx = fullGridNextIndex(wa);
  if (idx < 0) return null;
  if (wa.retryAt) return Number(wa.retryAt);
  if (idx === 0) return Number(wa.learnedAt) + GRID_OFFSETS[0];
  var grid = wa.grid || [];
  if (!grid[idx - 1]) return null;
  return Number(grid[idx - 1]) + GRID_OFFSETS[idx];
}

function advanceFullGridReview(wa, isCorrect, now) {
  var dueAt = fullGridDueAt(wa);
  if (dueAt === null || dueAt > now) return;
  if (!isCorrect) {
    wa.retryAt = now + 5 * 60000;
    return;
  }
  var idx = fullGridNextIndex(wa);
  if (idx >= 0) wa.grid[idx] = now;
  delete wa.retryAt;
}

// 大纲词汇：到期 Unit 展开为词 id（不能用 Unit 编号直接当词 id——此前会导致
// 复习队列变成 id=Unit编号 的那几个词）。今天 0 点后已答过的词不再重复推送，
// 这样同一 Unit 的复习分几次做、或中途退出后重建队列时，不会把当天已练过的
// 题再整段重做一遍；Unit 是否完成改由「全部词今天已作答」的结算统一判定。
function dueUnitWordIds() {
  var units = dueUnitsByEbbing();
  if (units.length === 0) return [];
  var floor = startOfTodayMs(new Date());
  var attempts = state.stats.wordAttempts || {};
  var ids = [];
  units.forEach(function(unit) {
    ebbingUnitWords(unit).forEach(function(word) {
      var wa = attempts[wordStateKey(word.id, 'core')];
      if (wa && Number(wa.lastTime) >= floor) return;
      ids.push(word.id);
    });
  });
  return ids;
}

function getDueWordIds() {
  if (isGridPool(currentPool)) return dueWordsByGrid(currentPool);
  return dueUnitWordIds();
}

// 核心词汇：某词的下一格进度文本
function gridProgressText(wordId, poolName) {
  var pool = isKnownPool(poolName) ? poolName : (isGridPool(currentPool) ? currentPool : 'full');
  var wa = state.stats.wordAttempts[wordStateKey(wordId, pool)];
  if (!wa || !wa.learnedAt) return '';
  var grid = wa.grid || [];
  var done = grid.filter(function(g) { return !!g; }).length;
  var nextIdx = fullGridNextIndex(wa);
  var dueAt = fullGridDueAt(wa);
  var txt = '打卡 ' + done + '/7 格';
  if (nextIdx >= 0 && dueAt !== null && dueAt <= Date.now()) txt += ' · 待复习：' + GRID_NAMES[nextIdx];
  return txt;
}

// ============ MEMORY MODE (记忆模式：做完即删 + 错词间隔回来) ============
function toggleMemoryMode() {
  var btn = document.getElementById('memoryBtn');
  if (!btn) return;
  var on = btn.classList.toggle('active');
  if (on) showImportMsg('\u{1F9E0} \u8BB0\u5FC6\u6A21\u5F0F\u5DF2\u5F00\u542F\uFF1A\u505A\u5B8C\u4E00\u9898\u5373\u5220\u9664\uFF0C\u7B54\u9519\u7684\u8BCD\u9694\u51E0\u5929\u81EA\u52A8\u56DE\u6765', 'ok');
  else showImportMsg('\u5DF2\u5173\u95ED\u8BB0\u5FC6\u6A21\u5F0F\uFF0C\u56DE\u5230\u666E\u901A\u505A\u9898', 'ok');
  savePrefs();
  return on;
}
function memoryModeOn() {
  var btn = document.getElementById('memoryBtn');
  return btn ? btn.classList.contains('active') : false;
}
function startMemoryQuiz(mode) {
  ensurePool(currentPool);
  var st = state.stats;
  var learned = st.wordAttempts || {};
  // 已学词集合（按拼写，兼容核心词/全词两套 id）
  var learnedWords = {};
  Object.keys(learned).forEach(function(key) {
    var w = getWord(wordIdFromStateKey(key), wordPoolFromStateKey(key));
    if (w) learnedWords[w.word.toLowerCase()] = true;
  });
  var pool = getActivePool();
  var poolSet = {};
  pool.forEach(function(w) { poolSet[w.word.toLowerCase()] = true; });
  // 到期复习词优先（答错/跳过的词，间隔到期自动回来）
  var planIds = currentPool === 'core' && state.ebbingActive ? dueUnitWordIds() : null;
  var dueWords = (planIds || getDueWordIds()).map(function(id) { return getWord(id, currentPool); })
    .filter(function(w) { return w && poolSet[w.word.toLowerCase()]; });
  // 未学新词（保持词库顺序：按 Unit→Lesson→序号 从前往后推进，不从随机位置开始）
  var newWords = pool.filter(function(w) { return !learnedWords[w.word.toLowerCase()]; });
  var ids = planIds ? planIds.slice() : shuffle(dueWords.map(function(w) { return w.id; }))
    .concat(newWords.map(function(w) { return w.id; }));
  if (ids.length === 0) {
    alert('当前词库已全部学完，换个词库或等待复习词到期吧！');
    return;
  }
  quizState = {
    mode: mode,
    isRetry: false,
    isReview: false,
    isMemory: true,
    ids: ids,
    pos: -1,
    questions: [],
    answers: {},
    memoryResults: [],
    done: 0,
    current: null,
    poolType: currentPool,
    memWrong: 0,
    memTotal: ids.length,
    isEbbingPlan: !!planIds
  };
  initializeEbbingPlanQuiz();
  quizActive = true;
  advanceQuestion();
  renderAll();
}

function startReview() {
  migrateEbbingPlanSnapshot(state.suspendedQuiz);
  if (isCurrentEbbingPlanSnapshot(state.suspendedQuiz)) {
    // A snapshot created before the current plan was reconciled may contain
    // the day's newly learned Unit (for example all 214 Unit 8 words). Once
    // that Unit is complete and no review Unit remains due, discard it rather
    // than reopening the stale queue.
    syncEbbingPlan();
    if (state.ebbingPlan && isEbbingPlanComplete(state.ebbingPlan) && dueUnitsByEbbing().length === 0) {
      discardSaved();
    } else {
      resumeQuiz();
      return;
    }
  }
  if (isExpiredEbbingPlanSnapshot(state.suspendedQuiz)) discardSaved();
  // The full pool is loaded asynchronously. Defer review queue construction
  // until it is ready so a fast mobile tap cannot observe an empty due list.
  if (isExternalPool(currentPool) && !isPoolLoaded(currentPool)) {
    if (window._startReviewLoading) return;
    window._startReviewLoading = true;
    var reviewBtn = document.querySelector('#reviewBar button[onclick="startReview()"]');
    if (reviewBtn) {
      reviewBtn.disabled = true;
      reviewBtn.dataset.reviewLoading = '1';
      reviewBtn.textContent = '加载词库中…';
    }
    ensurePool(currentPool, function() {
      window._startReviewLoading = false;
      if (reviewBtn && reviewBtn.dataset.reviewLoading === '1') {
        reviewBtn.disabled = false;
        reviewBtn.textContent = '开始复习';
        delete reviewBtn.dataset.reviewLoading;
      }
      if (!isPoolLoaded(currentPool)) {
        alert(poolLabel(currentPool) + '数据加载失败，请检查网络后重试。');
        return;
      }
      startReview();
    });
    return;
  }
  ensurePool(currentPool);
  if (currentPool === 'core' && !state.ebbingActive) {
    alert('纯刷题模式：尚未开启 4周25天打卡表，无打卡复习。可点击「开始 4周25天打卡表」开启复习计划。');
    return;
  }
  var due = getDueWordIds();
  if (due.length === 0) { alert('今天没有到期的复习单词，去学点新词吧！'); return; }
  // 复习固定为：看英文选中文 + 选择题（快速确认记忆）；记住用户此前题型，复习结束后恢复
  window._prevQuizTypeBeforeReview = currentQuizType;
  currentQuizType = 'choice';
  var reviewTypeSelect = document.getElementById('typeSelect');
  if (reviewTypeSelect) reviewTypeSelect.value = 'choice';
  quizState = {
    mode: 'en2cn',
    isRetry: false,
    isSmart: false,
    isReview: true,
    ids: currentPool === 'core' ? due.slice() : shuffle(due),
    pos: -1,
    questions: [],
    answers: {},
    done: 0,
    current: null,
    reviewCorrect: 0,
    poolType: currentPool,
    isEbbingPlan: currentPool === 'core' && state.ebbingActive
  };
  initializeEbbingPlanQuiz();
  quizActive = true;
  advanceQuestion();
  renderAll();
}

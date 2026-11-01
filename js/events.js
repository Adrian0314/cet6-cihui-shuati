/* events.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ EVENT BINDINGS ============
document.addEventListener('click', function(event) {
  var button = event.target.closest ? event.target.closest('[data-favorite-toggle]') : null;
  if (!button) return;
  var key = button.getAttribute('data-favorite-key');
  if (!key) return;
  event.preventDefault();
  toggleFavorite(wordIdFromStateKey(key), wordPoolFromStateKey(key));
});

var modeSelect = document.getElementById('modeSelect');
if (modeSelect) modeSelect.addEventListener('change', function() {
    var newMode = this.value;
    if (quizActive) {
      if (confirm('切换模式将保存当前进度，下次可以继续。确定切换吗？')) {
        saveSuspendedQuiz();
        document.getElementById('quizCard').innerHTML = '<div class="empty"><div class="ei">📌</div><p>进度已保存，切换到了新模式</p></div>';
        document.getElementById('startBtn').style.display = 'inline-block';
        document.getElementById('startBtn').textContent = '▶ 开始做题';
      } else {
        this.value = currentMode;
        return;
      }
    }
    currentMode = newMode;
    checkSuspendedQuiz();
    savePrefs();
});

// Type selector (choice vs dictation)
var typeSelect = document.getElementById('typeSelect');
if (typeSelect) typeSelect.addEventListener('change', function() {
    var newType = this.value;
    if (!newType) return;
    if (quizActive) {
      if (confirm('切换题目类型将保存当前进度，下次可以继续。确定切换吗？')) {
        saveSuspendedQuiz();
        document.getElementById('quizCard').innerHTML = '<div class="empty"><div class="ei">📌</div><p>进度已保存，切换到了新题目类型</p></div>';
        document.getElementById('startBtn').style.display = 'inline-block';
        document.getElementById('startBtn').textContent = '▶ 开始做题';
      } else {
        this.value = currentQuizType;
        return;
      }
    }
    currentQuizType = newType;
    checkSuspendedQuiz();
    savePrefs();
});

function switchTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  if (tab !== 'stats-page' && tab !== 'browse') destroyCharts();
  ['quiz', 'wrong', 'favorites', 'retry', 'stats-page', 'browse'].forEach(function(t) {
    document.getElementById('tab-' + t).style.display = (t === tab) ? 'block' : 'none';
  });
  if (tab === 'browse') { _browsePage = 0; renderBrowse(); }
  else if (tab === 'favorites') renderFavorites();
  else renderAll();
}
document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var tab = this.dataset.tab;
    // 直接切换；离开做题页时若有模式调整，显示非阻塞保留提示条（可忽略＝默认保留当前模式）
    switchTab(tab, this);
    if (tab !== 'quiz' && typeof askKeepPrefs === 'function') askKeepPrefs();
  });
});

// 热力图时间范围切换（30/90/180/365 天）
document.querySelectorAll('.hm-range').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.hm-range').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    _heatDays = parseInt(this.dataset.days) || 90;
    renderHeatmapChart();
  });
});

document.getElementById('startBtn').addEventListener('click', function() {
  if (memoryModeOn()) startMemoryQuiz(currentMode);
  else startNewQuiz(currentMode);
});

document.getElementById('smartQuizBtn').addEventListener('click', function() {
  if (quizActive) {
    if (!confirm('开始智能练习将保存当前进度，确定吗？')) return;
    saveSuspendedQuiz();
  }
  startSmartQuiz(currentMode);
});

document.getElementById('favoriteSmartBtn').addEventListener('click', function() {
  var ids = favoriteEntries(currentPool).map(function(entry) { return entry.id; });
  if (ids.length === 0) { alert('当前词库还没有重点词。'); return; }
  switchTab('quiz', document.querySelector('.tab-btn[data-tab="quiz"]'));
  startSmartQuiz(currentMode, ids);
});

document.getElementById('retryQuizBtn').addEventListener('click', function() {
  var ws = state.wrongWordIds[wwKey(currentMode)] || {};
  var wc = Object.keys(ws).length;
  if (wc === 0) { alert('当前模式没有错题可以重做！'); return; }
  if (wc < 4) { alert('当前模式错题不足4道（至少需要4道才能生成选项），继续积累吧~'); return; }
  if (quizActive) {
    if (!confirm('重做错题将保存当前进度，确定吗？')) return;
    saveSuspendedQuiz();
  }
  startRetryQuiz(currentMode);
});

document.getElementById('clearWrongBtn').addEventListener('click', function() {
  if (confirm('确定要清空所有错题记录吗？（同时清空待重做的错题）此操作不可恢复！')) {
    state.wrongHistory = [];
    state.wrongWordIds = allWrongWordBuckets();
    saveState();
    renderAll();
  }
});


// Pool selector
var poolSelect = document.getElementById('poolSelect');
if (poolSelect) poolSelect.addEventListener('change', function() {
    var pool = this.value;
    if (quizActive) {
      if (!confirm('切换词库将保存当前进度，下次可以继续。确定切换吗？')) {
        this.value = currentPool;
        return;
      }
      saveSuspendedQuiz();
      document.getElementById('quizCard').innerHTML = '<div class="empty"><div class="ei">📌</div><p>进度已保存，切换到了新词库</p></div>';
      document.getElementById('startBtn').style.display = 'inline-block';
      document.getElementById('startBtn').textContent = '▶ 开始做题';
    }
    function doSwitch() {
      currentPool = pool;
      updatePoolUI();
      checkSuspendedQuiz();
      savePrefs();
      renderAll();  // 刷新打卡计划区等按 currentPool 变化的内容
    }
    if (isExternalPool(pool)) {
      // 外置词库（核心词汇 / 1500核心词）：先确保数据加载完成再切换，避免空白/报错；失败则提示不切换
      ensurePool(pool, function() {
        if (!isPoolLoaded(pool)) { showImportMsg(poolLabel(pool) + '加载失败，请检查网络后重试', 'error'); return; }
        doSwitch();
      });
    } else {
      ensureUnitMaps();  // 大纲词汇新版词群导图数据：切回大纲词汇时预加载（核心词汇无数据自动回退旧版）
      doSwitch();
    }
});

// Unit selector（单选下拉）
var unitSelect = document.getElementById('unitSelect');
if (unitSelect) {
  unitSelect.addEventListener('change', function() {
    var u = parseInt(this.value, 10);
    selectedUnits = u === 0 ? [0] : [u];
    updatePoolUI();
    savePrefs();
    if (quizActive) {
      // Restart quiz with new filter
      startNewQuiz(currentMode);
    }
  });
}

// 闯关模式
var gateSelect = document.getElementById('gateSelect');
if (gateSelect) gateSelect.addEventListener('change', function() {
    var g = parseInt(this.value, 10);
    if (!g) return;
    if (quizActive) {
      if (!confirm('切换闯关模式将保存当前进度，下次可以继续。确定切换吗？')) {
        this.value = String(gateLevel);
        return;
      }
      saveSuspendedQuiz();
      document.getElementById('quizCard').innerHTML = '<div class="empty"><div class="ei">📌</div><p>进度已保存，切换到了新的闯关模式</p></div>';
      document.getElementById('startBtn').style.display = 'inline-block';
      document.getElementById('startBtn').textContent = '▶ 开始做题';
    }
    gateLevel = g;
    savePrefs();
});

// Set full vocab count in pool button (read from JSON tag to avoid lazy-load overhead)
var fullDataEl = document.getElementById('data-full-words');
if (fullDataEl) {
  var _fullCountEl = document.getElementById('fullVocabCount');
  if (_fullCountEl) _fullCountEl.textContent = (fullDataEl.textContent.match(/"id":/g) || []).length;
}
updatePoolUI();
renderReviewBar();

document.getElementById('clearRetryBtn').addEventListener('click', function() {
  if (confirm('确定要清空所有重做记录吗？此操作不可恢复！')) {
    state.retryHistory = [];
    saveState();
    renderAll();
  }
});

document.getElementById('resetStatsBtn').addEventListener('click', function() {
  if (confirm('确定要重置所有统计数据吗？（错题/重做记录保留）此操作不可恢复！')) {
    var wh = state.wrongHistory, rh = state.retryHistory, wi = state.wrongWordIds;
    state.stats = getDefaultState().stats;
    state.wrongHistory = wh; state.retryHistory = rh; state.wrongWordIds = wi;
    saveState();
    renderAll();
  }
});

// Export/Import buttons
document.getElementById('exportAllBtn').addEventListener('click', exportAllData);
document.getElementById('importBtn').addEventListener('click', importData);
document.getElementById('importFileInput').addEventListener('change', function(e) {
  if (e.target.files && e.target.files[0]) {
    handleImport(e.target.files[0]);
    e.target.value = ''; // Reset so same file can be re-selected
  }
});

// ============ ONBOARDING ============
function showOnboarding() {
  if (localStorage.getItem('cet6_onboarded')) return;
  // Skip if pronunciation practice panel is already open (e.g. automated tests)
  if (typeof _ppState !== 'undefined' && _ppState.word) return;
  var steps = [
    { title: '选择词库', desc: '在「📗 大纲词汇（你还在背单词吗·刘晓艳）」和「📚 核心词汇（艾宾浩斯打卡）」两个词库之间切换，可按书中 Unit 筛选、设置每次学习页数。' },
    { title: '闯关模式 & 开始', desc: '闯关1速记（认识/不认识快速检测）、闯关2选择（四选一/默写）、闯关3 Unit综合测；再选看中文选英文或看英文选中文即可开始。' },
    { title: '词群导图', desc: '答完题自动显示当前词的词群关系图：圆圈外侧的绿色数字徽标=该词还有几个分支，点击圆圈逐层展开；无徽标=末端词。点单词文字可朗读发音。' },
    { title: '快捷键 & 跳过', desc: '数字键1-4选答案，空格跳过，回车下一题。按Esc取消输入焦点。' }
  ];
  var cur = 0;
  var overlay = document.createElement('div');
  overlay.id = 'onboardOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;display:flex;align-items:center;justify-content:center;';
  function render() {
    var s = steps[cur];
    overlay.innerHTML = '<div style="background:var(--surface);padding:32px;border-radius:16px;max-width:360px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
      '<div style="font-size:2em;margin-bottom:12px;">' + (['\u{1F4DA}','\u270D\uFE0F','\u{1F5FA}\uFE0F','\u2328\uFE0F'][cur]) + '</div>' +
      '<h3 style="margin-bottom:8px;">' + s.title + '</h3>' +
      '<p style="color:var(--text2);margin-bottom:24px;line-height:1.6;">' + s.desc + '</p>' +
      '<div style="display:flex;gap:8px;justify-content:center;">' +
      (cur > 0 ? '<button class="ctrl-btn" id="onboardPrev">上一步</button>' : '') +
      (cur < steps.length - 1 ? '<button class="ctrl-btn accent" id="onboardNext">下一步</button>' : '<button class="ctrl-btn accent" id="onboardDone">开始刷题</button>') +
      '</div></div>';
    document.body.appendChild(overlay);
    var nextBtn = document.getElementById('onboardNext');
    var prevBtn = document.getElementById('onboardPrev');
    var doneBtn = document.getElementById('onboardDone');
    if (nextBtn) nextBtn.onclick = function() { cur++; overlay.remove(); render(); };
    if (prevBtn) prevBtn.onclick = function() { cur--; overlay.remove(); render(); };
    if (doneBtn) doneBtn.onclick = function() { overlay.remove(); localStorage.setItem('cet6_onboarded', '1'); };
  }
  render();
}

// ============ DATA-ACTION DELEGATION ============
// Handles all data-action attributes added during refactor (replaces former inline handlers).
document.addEventListener('click', function(e) {
  var el = e.target.closest('[data-action]');
  if (!el) return;
  var action = el.getAttribute('data-action');
  switch (action) {
    case 'toggle-rules': {
      var rc = document.getElementById('rulesCard');
      if (rc) rc.classList.toggle('collapsed');
      break;
    }
    case 'scroll-top':    scrollToTop(); break;
    case 'resume-quiz':   resumeQuiz(); break;
    case 'discard-saved': discardSaved(); break;
    case 'start-review':  startReview(); break;
    case 'toggle-memory': toggleMemoryMode(); break;
    case 'toggle-auto-speak': toggleAutoSpeak(); break;
    case 'export-wrong':  exportWrongWords(); break;
    case 'set-daily-goal': setDailyGoal(); break;
    case 'reset-all':     resetAllData(); break;
    case 'hw-clear':      clearHandwrite(); break;
    case 'hw-close':      closeHandwritePad(); break;
    case 'hw-recognize':  recognizeHandwrite(); break;
    case 'set-browse-pool': {
      var pool = el.getAttribute('data-pool');
      if (pool) setBrowsePool(pool);
      break;
    }
  }
});

document.addEventListener('input', function(e) {
  var action = e.target.getAttribute('data-action');
  if (!action) return;
  switch (action) {
    case 'search-wrong':  renderWrongHistory(); break;
    case 'search-retry':  renderRetryHistory(); break;
    case 'search-browse': _browsePage = 0; renderBrowse(); break;
  }
});

document.addEventListener('keydown', function(e) {
  var action = e.target.getAttribute('data-action');
  if (action === 'goal-keydown' && e.key === 'Enter') setDailyGoal();
});

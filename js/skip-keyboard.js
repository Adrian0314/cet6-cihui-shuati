/* skip-keyboard.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ DAILY GOAL ============
var _goalToastShown = false;
// 今天已达成目标则当天不再重复弹"完成目标"提示（同一天多次进入只提示一次）
try {
  var _gtoday0 = localDateKey(new Date());
  var _gtd0 = state.stats.dailyHistory[_gtoday0];
  if (_gtd0 && (_gtd0.attempts || 0) >= (state.dailyGoal || 30)) _goalToastShown = true;
} catch(e) {}
function checkDailyGoal() {
  if (_goalToastShown) return;
  var st = window.state ? window.state.stats : state.stats;
  var today = localDateKey(new Date());
  var td = st.dailyHistory[today];
  if (!td) return;
  var done = td.attempts || 0;
  var goal = (window.state ? window.state.dailyGoal : state.dailyGoal) || 30;
  if (done >= goal) {
    _goalToastShown = true;
    var toast = document.createElement('div');
    toast.className = 'toast ok';
    toast.innerHTML = '\u{1F389} \u4ECA\u65E5\u76EE\u6807\u8FBE\u6210\uFF01\u5DF2\u5B66\u4E60 ' + done + ' \u4E2A\u5355\u8BCD';
    document.body.appendChild(toast);
    setTimeout(function() { toast.classList.add('out'); setTimeout(function() { toast.remove(); }, 300); }, 2500);
  }
}

// ============ SKIP & KEYBOARD ============
function handleSkip(e) {
  if (!quizActive || !quizState.current) return;
  if (isAnswered(quizState.pos)) return; // 已作答 / 已跳过不可再操作
  // "不会，跳过"必须来自一次真实起手：切后台恢复后浏览器补发的旧 click 没有
  // 配对起手（或时间戳停留在切走前），在这里被拒绝。键盘路径（空格 / 聚焦后回车）
  // 本身即真实输入，直接放行。闸门通过后立即执行，不再延迟一拍。
  var keyboardGesture = !!(e && e.keyboardGesture);
  if (!keyboardGesture && !gestureAllows(e)) return;
  spendGesture();
  performSkip();
}

function performSkip() {
  var q = quizState.current;
  var word = q.word;
  var mode = quizState.mode;

  quizState.done++;
  if (quizState.isMemory) quizState.memWrong++;
  quizState.answers[quizState.pos] = 'skip';
  recordMemoryProgress('skip');
  state.stats.totalSkip = (state.stats.totalSkip || 0) + 1;
  state.stats.dictation.skip = (state.stats.dictation.skip || 0) + 1;
  state.stats[mode + '_dict'].skip = (state.stats[mode + '_dict'].skip || 0) + 1;

  if (quizState.isReview) {
    // 复习模式：跳过 = 答错（间隔重置为1天，明天必来）；今天放走不再出现
    recordStat(word, mode, false, false, false);
    state.wrongHistory.unshift({
    wordId: word.id, pool: (quizState.poolType || currentPool), mode: mode, timestamp: nowStr(),
      questionText: (mode === 'cn2en') ? getChineseFull(word.meaning) : word.word,
      userAnswer: '（跳过）',
      correctAnswer: (mode === 'cn2en') ? word.word : getChineseOptionText(word.meaning),
      skipped: true
    });
    if (!state.wrongWordIds[wwKey(mode)]) state.wrongWordIds[wwKey(mode)] = {};
    state.wrongWordIds[wwKey(mode)][word.id] = true;
  }

  var correctText = (mode === 'cn2en') ? word.word : getChineseOptionText(word.meaning);
  if (currentQuizType === 'choice') {
    document.querySelectorAll('.opt-btn').forEach(function(b) { b.disabled = true; });
    var correctBtn = document.getElementById('opt-' + q.correctIndex);
    if (correctBtn) correctBtn.classList.add('correct');
    document.getElementById('feedback').className = 'feedback show close';
    document.getElementById('feedback').innerHTML = '<h4>\u{1F6AA} \u5DF2\u8DF3\u8FC7</h4><div style="margin:6px 0;"><b>\u6B63\u786E\u7B54\u6848\uFF1A</b>' + correctText + speakBtnFor(word, mode) + '</div>';
    appendFeedbackDetails(document.getElementById('feedback'), word, mode);
  } else {
    var dictInp = document.getElementById('dictInput');
    if (dictInp) { dictInp.disabled = true; dictInp.value = correctText; dictInp.classList.add('result-orange'); }
    document.getElementById('dictSubmitBtn').disabled = true;
    document.getElementById('feedback').className = 'feedback show close';
    document.getElementById('feedback').innerHTML = '<h4>\u{1F6AA} \u5DF2\u8DF3\u8FC7</h4><div style="margin:6px 0;"><b>\u6B63\u786E\u7B54\u6848\uFF1A</b>' + correctText + speakBtnFor(word, mode) + '</div>';
    appendFeedbackDetails(document.getElementById('feedback'), word, mode);
  }
  document.getElementById('nextBtn').classList.add('show');
  refreshQuestionProgress();
  saveActiveQuizProgress();
  renderAll();
}

// ============ 电脑端 ↑/↓ 滚动页面 ============
// 页面存在两套滚动方式：全屏做题时 <body> 是 overflow:hidden，真正滚动的是题卡
// 内部的 .quiz-scroll；其余情况由文档本身滚动，词库 / 错题本等区块还各有自己的
// 滚动条。原先写死 window.scrollBy，导致全屏模式下方向键完全没反应。
// 这里改为动态解析「当前真正能滚动的容器」，按优先级从内到外逐层滚动。
var SCROLL_STEP_RATIO = 0.15;   // 每次按键滚动视口高度的 15%
var SCROLL_MIN_STEP = 120;      // 但不少于 120px，矮视口下也要有明显位移
var SCROLL_OVERLAY_IDS = ['onboardOverlay', 'reviewReminderModal'];

function isDocScroller(el) {
  return el === document.scrollingElement || el === document.documentElement ||
    el === document.body;
}
// 该容器在 dir(+1 向下 / -1 向上) 方向还能不能继续滚
function canScrollBy(el, dir) {
  if (!el) return false;
  var max = el.scrollHeight - el.clientHeight;
  if (max <= 1) return false;
  return dir > 0 ? el.scrollTop < max - 1 : el.scrollTop > 1;
}
// root 内第一个「可见且在该方向上还能滚」的区块
function firstScrollableIn(root, dir) {
  if (!root || !root.querySelectorAll) return null;
  var els = root.querySelectorAll('*');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.clientHeight < 40) continue;             // 隐藏或过矮，跳过
    var oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll') continue;
    if (canScrollBy(el, dir)) return el;
  }
  return null;
}
// 从当前焦点元素往上找最近的可滚动祖先（用户正在某个列表里操作时优先滚它）
function scrollableAncestor(el, dir) {
  while (el && el.nodeType === 1 && el !== document.body) {
    if (canScrollBy(el, dir)) return el;
    el = el.parentElement;
  }
  return null;
}
function visibleOverlay() {
  for (var i = 0; i < SCROLL_OVERLAY_IDS.length; i++) {
    var el = document.getElementById(SCROLL_OVERLAY_IDS[i]);
    if (el && el.getClientRects().length) return el;
  }
  return null;
}
// 选出本次按键该滚动的容器；返回 null 表示无处可滚
function resolveScrollContainer(dir) {
  var fromFocus = scrollableAncestor(document.activeElement, dir);
  if (fromFocus) return fromFocus;
  var card = document.getElementById('quizCard');
  if (card && card.classList.contains('fullscreen')) {
    var inner = firstScrollableIn(card, dir) || card.querySelector('.quiz-scroll');
    if (canScrollBy(inner, dir)) return inner;
  }
  var tabBtn = document.querySelector('.tab-btn.active');
  var panel = tabBtn ? document.getElementById('tab-' + tabBtn.dataset.tab) : null;
  var inPanel = firstScrollableIn(panel, dir);
  if (inPanel) return inPanel;
  var doc = document.scrollingElement || document.documentElement;
  return canScrollBy(doc, dir) ? doc : null;
}
function doScrollBy(el, dir) {
  var viewport = isDocScroller(el) ? window.innerHeight : el.clientHeight;
  var step = Math.max(SCROLL_MIN_STEP, Math.round(viewport * SCROLL_STEP_RATIO));
  var smooth = true;
  try {
    smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (err) {}
  try {
    el.scrollBy({ top: dir * step, behavior: smooth ? 'smooth' : 'auto' });
  } catch (err) {
    el.scrollTop += dir * step;      // 极老浏览器不支持 options 参数
  }
}
// 返回 true 表示这个按键已被消费（调用方应 preventDefault）
function scrollPageByKey(dir) {
  var overlay = visibleOverlay();
  if (overlay) {
    // 弹层打开时按键归弹层，绝不滚动它背后的页面
    var inner = firstScrollableIn(overlay, dir);
    if (inner) doScrollBy(inner, dir);
    return true;
  }
  var el = resolveScrollContainer(dir);
  if (!el) return false;
  doScrollBy(el, dir);
  return true;
}

document.addEventListener('keydown', function(e) {
  // Ignore keyboard shortcuts while the page is backgrounded; some mobile
  // browsers replay a key event when focus returns to the tab.
  if (document.hidden) return;
  var tag = e.target.tagName;
  var inTextField = (tag === 'INPUT' || tag === 'TEXTAREA');
  // ---- 电脑端 ↑/↓ 滚动页面 ----
  // 这一段刻意放在 quizActive 判断之外：词库、错题本、统计等标签页一样很长，
  // 都该能用方向键翻。带修饰键（Shift/Ctrl/Alt/Cmd）的组合仍交回浏览器原生行为。
  if (!inTextField && (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
      !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    // 浏览器补发的旧按键（时间戳停留在切走之前）不滚动页面，避免回到前台时
    // 被一串幽灵按键顶走。
    if (staleLifecycleEvent(e)) return;
    if (scrollPageByKey(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
    return;
  }
  if (!quizActive) return;
  // 回到前台后的保护窗口内同样不接受键盘快捷键：部分手机/WebView 会把切走前的
  // 旧按键（空格=跳过、回车=下一题）跟着用户的下一次操作一起补发。
  if (inResumeWindow()) return;
  if (inTextField) {
    if (e.key === 'Escape') { e.target.blur(); e.preventDefault(); }
    // Spaces belong to text inputs (especially dictation); never treat them
    // as the global "skip" shortcut while an input has focus.
    return;
  }
  // 焦点落在按钮/链接上时，Enter/空格由浏览器原生的"键盘激活 click"处理，
  // 这里直接放行，避免同一个按键既走快捷键又走 click 造成切两题。
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
    var focused = e.target;
    if (focused && focused.closest && focused.closest(GESTURE_TARGET_SEL)) return;
  }
  // 闯关1速记快捷键：1/空格=认识，2=不认识
  if (quizState.gate === 1 && currentQuizType === 'choice' && document.getElementById('gateKnowBtn')) {
    if (e.key === '1' || e.key === ' ') { handleGate1(true); e.preventDefault(); return; }
    if (e.key === '2') { handleGate1(false); e.preventDefault(); return; }
  }
  if (e.key === 'ArrowLeft') { if (!quizState.isMemory) { e.preventDefault(); prevQuestion(); } }
  else if (e.key === 'ArrowRight') { e.preventDefault(); advanceQuestion(); }
  else if (e.key >= '1' && e.key <= '4' && currentQuizType === 'choice') {
    var idx = parseInt(e.key) - 1;
    var btn = document.getElementById('opt-' + idx);
    if (btn && !btn.disabled) { handleAnswer(idx); e.preventDefault(); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    var nb = document.getElementById('nextBtn');
    if (nb && nb.classList.contains('show')) advanceQuestion();
    else if (currentQuizType === 'dictation') handleDictationSubmit();
  } else if (e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    var nb2 = document.getElementById('nextBtn');
    if (nb2 && nb2.classList.contains('show')) { advanceQuestion(); }
    else { handleSkip({ keyboardGesture: true }); } // 空格本身就是真实输入，直接放行
  }
});

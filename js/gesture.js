/* gesture.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ 统一手势闸门（切后台恢复防误触的唯一入口）============
// 现象：手机把做题页切到后台、过一会儿再切回前台后
//   · 点一次选项就自动跳到下一题，连着四五题都这样；
//   · 想点"上一题"，反而被切到"下一题"；
//   · "不会，跳过"自己触发。
// 根因：切到后台期间，浏览器会把切走前积压的输入事件（有时是完整的
// pointerdown → pointerup → click 序列）在回到前台后一次性补发。这些"幽灵事件"
// 落在选项、"下一题"、"不会，跳过"或滑动手势上，就被当成用户操作。
//
// 旧实现用一堆时间窗口（80ms / 300ms / 1.5s / 风暴抑制 / 延迟一拍）互相打补丁去
// "猜"哪些事件是补发的：既漏掉一部分补发，又会误伤正常操作——用户想回上一题被
// 冷却期吞掉，连点几下被当成"风暴"压制，于是出现"想回上一题却被切到下一题"。
//
// 现在改成"手势"模型，规则收敛为四条：
//   1. 任何交互都必须由一次真实起手发起。起手 = pointerdown / touchstart /
//      mousedown，其事件时间戳必须晚于最近一次"切到后台"的时刻。补发序列保留着
//      切走前的时间戳，一律判为陈旧，在捕获阶段整批取消；它后续的
//      pointerup / click 因为没有配对起手，也不会被认作操作。
//   2. 收尾事件（pointerup / touchend / click）必须落在"当前手势"里，时间戳不得
//      早于起手，且目标要与起手目标一致。裸 click（补发队列里的兼容鼠标 click
//      就是这种）一律不执行动作。
//   3. 一个手势只属于一个目标元素。点选项的手势永远不可能触发"下一题"或"跳过"。
//   4. 需要时要求"起手→收尾"有真实人手耗时：补发序列会被压缩在同一批次里同步
//      冲刷，间隔接近 0ms，而人手点按至少几十毫秒。
// 键盘 / 辅助技术激活（detail=0 且紧跟真实按键）单独放行，不受上述约束。
var GHOST_MIN_TAP_MS = 24;    // 起手→收尾真实耗时下限（补发冲刷会被压到 0ms）
var GHOST_ARM_MS = 900;       // 回前台后的保护窗口宽度
// 触摸为主的设备：真机点按一定产生 touch/pointer(touch) 事件；只有鼠标兼容事件的
// "点击"在手机上必然是浏览器补发出来的，所以这类手势也要过"人手耗时"校验。
var GHOST_TOUCH_PRIMARY = (('ontouchstart' in window) && ('ontouchend' in window)) ||
  !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
// 可能承载动作的交互目标：文档级 click 闸门只拦这些，其它区域不干预。
var GESTURE_TARGET_SEL = 'button,a,input,textarea,select,label,[onclick],[role="button"],.opt-btn';
var _lastKeyAt = 0;           // 最近一次真实按键（用于识别键盘/辅助技术激活）
var _ghostHiddenAt = 0;       // 最近一次切到后台（performance.now 时基）
var _ghostVisibleAt = 0;      // 最近一次回到前台
var _ghostEverHidden = false;
var _gesture = null;          // 当前手势
var _gestureSeq = 0;

function perfNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}
// e.timeStamp 在新式浏览器里与 performance.now() 同源；老 WebKit 的鼠标事件用
// Unix 毫秒。统一换算到 performance 时基，换算不了就返回 0 交给其它防线。
function eventPerfTime(e) {
  var ts = e && e.timeStamp;
  if (typeof ts !== 'number' || !isFinite(ts) || ts <= 0) return 0;
  var wallBase = Date.now() - perfNow();
  if (ts > wallBase + 60000) return ts - wallBase;   // 看起来是 Unix 毫秒
  if (ts > perfNow() + 60000) return 0;              // 明显异常的将来时间戳
  return ts;
}
// 这条事件是不是"切走前就产生、回到前台才被补发"的陈旧事件？
function staleLifecycleEvent(e) {
  if (document.hidden) return true;
  var ts = eventPerfTime(e);
  if (ts > 0 && _ghostHiddenAt > 0 && ts < _ghostHiddenAt - 2) return true;
  return false;
}
function inResumeWindow() {
  return _ghostVisibleAt > 0 && perfNow() - _ghostVisibleAt < GHOST_ARM_MS;
}
function gestureNode(el) {
  if (!el || !el.closest) return el || null;
  return el.closest(GESTURE_TARGET_SEL) || el;
}
function beginGesture(e) {
  var now = perfNow();
  var isTouch = (e.type === 'touchstart') ||
    (e.type === 'pointerdown' && (e.pointerType === 'touch' || e.pointerType === 'pen'));
  // 触摸为主设备上，紧随真实触摸之后的鼠标起手，是浏览器由这次触摸派生的兼容事件
  // （也可能是切后台后补发出来的裸鼠标序列）。它不能开新手势：否则会把真正的触摸
  // 手势顶掉，还会让补发的 click 误以为"有新鲜起手"。此时沿用仍未过期的触摸手势。
  if (!isTouch && GHOST_TOUCH_PRIMARY && _gesture && !_gesture.spent &&
      _gesture.touch && now - _gesture.startAt < 800) {
    return;
  }
  _gestureSeq++;
  var pt = (e.touches && e.touches.length) ? e.touches[0] : null;
  _gesture = {
    id: _gestureSeq,
    node: gestureNode(e.target),
    startTs: eventPerfTime(e),
    startAt: now,
    touch: isTouch,
    x: pt ? pt.clientX : (typeof e.clientX === 'number' ? e.clientX : null),
    y: pt ? pt.clientY : (typeof e.clientY === 'number' ? e.clientY : null),
    moved: false,
    stale: staleLifecycleEvent(e),
    spent: false
  };
}
function releaseGesture(e) {
  var g = _gesture;
  if (!g || g.x === null) return;
  var pt = (e.changedTouches && e.changedTouches.length) ? e.changedTouches[0] : e;
  if (typeof pt.clientX !== 'number' || typeof pt.clientY !== 'number') return;
  if (Math.abs(pt.clientX - g.x) > 12 || Math.abs(pt.clientY - g.y) > 12) g.moved = true;
}
// 这次交互能不能执行动作？——整套闸门只在这里下判断，调用方不再各自计时。
function gestureAllows(e, opts) {
  // 无目标的事件无法归属任何手势（直接调用 handleSkip/handleAnswer 而不传事件、
  // 或测试桩漏传 target 时），一律拒绝，避免 gestureNode(e.target) 抛异常。
  if (!e || e.target === null || e.target === undefined) return false;
  // 程序化/合成事件（内部代码、自动化测试）不是浏览器补发的幽灵事件：
  // 保留下面的结构性校验，只跳过"人手耗时"这一条启发式判断。
  var synthetic = !(e && e.isTrusted);
  if (document.hidden) return false;
  // 键盘 / 辅助技术激活：detail=0，并且必须紧跟在一次真实按键之后
  // （Tab 聚焦后按 Enter/空格会派发 detail=0 的 click，且没有任何指针起手）。
  // 浏览器补发出来的裸 click 虽然也是 detail=0，但前面没有按键，因此不会被
  // 这条豁免放行——这正是"切后台恢复后凭空冒出一个 click"的形态。
  if (e && e.detail === 0 && _lastKeyAt && perfNow() - _lastKeyAt < 1500) return true;
  var g = _gesture;
  if (!g || g.stale || g.spent) return false;
  var ts = eventPerfTime(e);
  if (ts > 0 && g.startTs > 0 && ts < g.startTs - 2) return false;   // 时间戳倒流 = 补发
  // 需要"人手耗时"校验的场景，任一命中即校验：
  //   · 真机触摸来源的手势——补发批次会被压成 0ms；
  //   · 回到前台后的保护窗口内——补发主要发生在这个窗口（窗口内合成事件同样校验，
  //     这样自动化测试可以完整覆盖补发场景）；
  //   · 触摸为主设备上、且本次会话确实切过后台的鼠标来源手势——手机上裸的兼容
  //     鼠标序列就是补发。没切过后台时不存在补发，因此不启用（否则台式机与
  //     自动化里瞬时完成的鼠标点击会被一并拦掉）。
  // 真机补发都是浏览器发出的可信事件，享受不到合成事件的豁免。
  var mouseSuspect = GHOST_TOUCH_PRIMARY && _ghostEverHidden && !synthetic;
  if ((!synthetic && g.touch) || inResumeWindow() || mouseSuspect) {
    if (perfNow() - g.startAt < GHOST_MIN_TAP_MS) return false;
  }
  if (g.moved && !(opts && opts.allowMoved)) return false;     // 拖动/滑动不产生点击动作
  var want = (opts && opts.node) || gestureNode(e.target);
  if (!g.node || !want) return false;
  if (g.node !== want && !g.node.contains(want) && !want.contains(g.node)) return false;
  return true;
}
function spendGesture() {
  if (_gesture) _gesture.spent = true;
}
// 陈旧起手：把它整条事件链在捕获阶段取消，按钮高亮/聚焦/合成 click 都不会发生
function cancelStaleInput(e) {
  var g = _gesture;
  if (!g || !g.stale) return;
  var t = e.target;
  if (!t || !t.closest) return;
  if (!t.closest(GESTURE_TARGET_SEL + ',canvas,.opt-btn')) return;
  e.preventDefault();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
}
function onGestureStart(e) { beginGesture(e); }

document.addEventListener('pointerdown', onGestureStart, true);
document.addEventListener('touchstart', onGestureStart, true);
document.addEventListener('mousedown', onGestureStart, true);
document.addEventListener('pointerup', releaseGesture, true);
document.addEventListener('touchend', releaseGesture, true);
// 重放取消须注册在起手记录之后、且必须在捕获阶段最前生效。
// touch 系列必须显式 passive:false —— Chrome 默认把 document 级触摸监听当 passive，
// 那样 preventDefault 会被静默忽略。
document.addEventListener('pointerdown', cancelStaleInput, true);
document.addEventListener('mousedown', cancelStaleInput, true);
document.addEventListener('touchstart', cancelStaleInput, { capture: true, passive: false });
document.addEventListener('pointerup', cancelStaleInput, true);
document.addEventListener('mouseup', cancelStaleInput, true);
document.addEventListener('touchend', cancelStaleInput, { capture: true, passive: false });
document.addEventListener('click', cancelStaleInput, true);
// click 闸门：没有配对起手的裸 click（补发的主要载体）在这里被拦下。
// 注意只放行、不消费手势——真正的动作由目标的处理函数执行后再 spendGesture()。
document.addEventListener('click', function(e) {
  // 只拦浏览器发出的可信 click：补发的幽灵事件一定是可信事件。
  // 合成 click（脚本里 element.click()、自动化测试 dispatchEvent）不是补发，
  // 直接放行，否则会误伤页面自身的程序化点击。
  if (!e.isTrusted) return;
  var t = e.target;
  if (!t || !t.closest) return;
  if (!t.closest(GESTURE_TARGET_SEL)) return;
  if (gestureAllows(e)) return;
  e.preventDefault();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
}, true);
// 记录真实按键：键盘/辅助技术激活的 click（detail=0）据此放行
document.addEventListener('keydown', function() { _lastKeyAt = perfNow(); }, true);
// 页面不可见期间的按键不执行任何动作（部分手机会在返回时补发旧按键）
document.addEventListener('keydown', function(e) {
  if (!document.hidden) return;
  if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }
}, true);

// 生命周期：只记录"切走/回来"两个时刻，作为判定陈旧时间戳的基准线
function noteHidden() {
  _ghostEverHidden = true;
  _ghostHiddenAt = perfNow();
  _gesture = null;
  autoSaveProgress();
}
function noteVisible() {
  _ghostVisibleAt = perfNow();
  _gesture = null;
}
// visibilitychange 是手机切前后台时最可靠的信号；pagehide/blur 作为内嵌浏览器兜底。
document.addEventListener('visibilitychange', function() {
  if (document.hidden) noteHidden();
  else if (_ghostEverHidden) noteVisible();
});
window.addEventListener('pagehide', noteHidden);
window.addEventListener('pageshow', function(e) {
  if (e.persisted || _ghostEverHidden) noteVisible();
});
window.addEventListener('blur', function() {
  if (document.hidden || quizActive) noteHidden();
});
window.addEventListener('focus', function() {
  if (_ghostEverHidden && !document.hidden) noteVisible();
});
window.addEventListener('beforeunload', autoSaveProgress);

// 心跳兜底：部分手机浏览器 / PWA（尤其微信内置浏览器）切后台时并不触发
// visibilitychange / blur，手势闸门的生命周期基准线因此缺失，切回来之后
// 补发的旧事件会被当成新鲜操作（表现为「点一下选项就自动跳题」）。
// 后台页面的定时器会被节流，于是「心跳间隙过大」本身就说明页面被挂起过：
// 把挂起起点记为 _ghostHiddenAt、恢复点走 noteVisible()，陈旧判定与保护
// 窗口照常生效——不加任何冷却时间窗口，真人操作一次就是一次。
var GHOST_SUSPEND_MS = 2500;  // 心跳间隙超过该值即判定页面曾被挂起
var _lastHeartbeat = perfNow();
function noteHeartbeat() {
  var now = perfNow();
  if (_lastHeartbeat > 0 && now - _lastHeartbeat > GHOST_SUSPEND_MS) {
    _ghostEverHidden = true;
    if (!_ghostHiddenAt || _ghostHiddenAt > _lastHeartbeat) _ghostHiddenAt = _lastHeartbeat;
    noteVisible();
  }
  _lastHeartbeat = now;
}
setInterval(noteHeartbeat, 1000);

// ============ 切题入口（上一题/下一题按钮与滑动切题的唯一出口）============
// 闸门只判断"这次交互是不是真人刚做的"，不再延迟执行、也没有冷却期：
// 点一下就是切一下，不会吞掉用户操作，也不会被执行两次。
function userAdvance(e) {
  if (!quizActive || !quizState) return;
  if (!gestureAllows(e)) return;
  spendGesture();
  advanceQuestion();
}
function userPrev(e) {
  if (!quizActive || !quizState) return;
  if (!gestureAllows(e)) return;
  spendGesture();
  prevQuestion();
}
function userJump(n) { jumpToQuestion(n); } // 手输题号回车即真实输入，直接跳

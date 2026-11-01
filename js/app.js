/* app.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ INIT ============
// 使用指南：仅首次访问展开，后续访问自动折叠
if (localStorage.getItem('cet6_onboarded')) {
  var _rulesCard = document.getElementById('rulesCard');
  if (_rulesCard) _rulesCard.classList.add('collapsed');
}
// PWA manifest 动态注入：file:// 下不注入（避免 CORS 报错），https 下正常启用
if (location.protocol !== 'file:') {
  var _manifestLink = document.createElement('link');
  _manifestLink.rel = 'manifest';
  _manifestLink.href = 'manifest.json';
  document.head.appendChild(_manifestLink);
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').then(function(reg) {
    // 词库更新提示：新 Service Worker 接管（skipWaiting + clients.claim）后，
    // 当前页面仍是旧缓存渲染的旧词库，弹条提示用户刷新一次即可加载最新内容。
    try {
      var notifyUpdate = function() {
        if (document.getElementById('swUpdateBar')) return;
        var bar = document.createElement('div');
        bar.id = 'swUpdateBar';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:var(--accent);color:#fff;' +
          'padding:8px 12px;font-size:0.9em;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);';
        bar.textContent = '\u{1F4DA} \u8BCD\u5E93\u5DF2\u66F4\u65B0\uFF0C\u70B9\u51FB\u5237\u65B0\u52A0\u8F7D\u6700\u65B0\u5185\u5BB9';
        bar.onclick = function() { location.reload(); };
        document.body.appendChild(bar);
      };
      reg.addEventListener('updatefound', function() {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function() {
          if (nw.state === 'activated') notifyUpdate();
        });
      });
      reg.update();
    } catch (e) {}
  }).catch(function() {});
}
applyPrefs();  // 恢复上次做题模式（词库/单元/闯关/模式/题型/记忆/学习量）
updatePrefsSnapshot();  // 记录「上次已保存」的模式快照，退出做题时据此询问是否保留
checkSuspendedQuiz();
setTimeout(function() { showOnboarding(); }, 500);
setTimeout(function() { checkSpacedRepetition(); }, 1200);
if (isExternalPool(currentPool) && !isPoolLoaded(currentPool)) {
  // 上次停在核心词汇：先加载外置数据再渲染，避免空白/报错
  ensureFullWords(function() { renderAll(); });
} else {
  ensureUnitMaps();  // 预加载 Unit 词群导图数据（大纲词汇新版导图用；核心词汇无数据自动回退旧版）
  renderAll();
}
console.log('🎓 CET-6 词库刷题系统（你还在背单词吗 × 艾宾浩斯打卡）已就绪');
console.log('⚡ 改进：按需出题 · Levenshtein相似度 · 手动混淆组 · 进度暂存 · 搜索 · 导出');


// ============ BACK TO TOP (下滑自动出现 + 平滑滚动回顶) ============
var BACKTOP_THRESHOLD = 300; // 滚动超过该像素才显示回顶按钮
var _backTopBtn = null;
var _scBoundEl = null; // 已绑定 scroll 监听的 quiz-scroll(全屏容器),重建后需重新绑定
function backToTopScrollEl() {
  var card = document.getElementById('quizCard');
  if (card && card.classList.contains('fullscreen')) {
    var sc = card.querySelector('.quiz-scroll');
    if (sc) return sc;
  }
  return null;
}
function backToTopVisible() {
  var sc = backToTopScrollEl();
  if (sc) return sc.scrollTop > BACKTOP_THRESHOLD;
  return (window.scrollY || document.documentElement.scrollTop || 0) > BACKTOP_THRESHOLD;
}
function onScrollCheck() {
  if (!_backTopBtn) return;
  var sc = backToTopScrollEl();
  if (sc !== _scBoundEl) {
    if (_scBoundEl) _scBoundEl.removeEventListener('scroll', onScrollCheck);
    if (sc) sc.addEventListener('scroll', onScrollCheck, { passive: true });
    _scBoundEl = sc;
  }
  _backTopBtn.classList.toggle('show', backToTopVisible());
}
// 平滑滚动回顶(非瞬间跳);不支持的旧浏览器回退到直接置顶
function scrollToTop() {
  var sc = backToTopScrollEl();
  try {
    if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    if (sc) sc.scrollTop = 0;
    else window.scrollTo(0, 0);
  }
}
function initBackToTop() {
  _backTopBtn = document.getElementById('backToTopBtn');
  if (!_backTopBtn) return;
  _backTopBtn.addEventListener('click', scrollToTop);
  window.addEventListener('scroll', onScrollCheck, { passive: true });
  window.addEventListener('resize', onScrollCheck);
  onScrollCheck();
}
initBackToTop();

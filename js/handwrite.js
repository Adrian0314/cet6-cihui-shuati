/* handwrite.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ HANDWRITE (默写手写识别) ============
var _hwCtx = null, _hwDrawing = false, _hwBound = false;
var _hwInkColor = '#1a1a1a'; // 笔迹颜色（从 CSS 变量解析，canvas 不支持 var()）
var _hwWorkers = {}; // 按语言缓存 Tesseract worker（IndexedDB 缓存语言包，重复使用时复用缓存）
var _hwScriptPromise = null;
var HW_TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

function hwInkColor() {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    if (v) _hwInkColor = v;
  } catch (e) {}
  return _hwInkColor;
}

function openHandwritePad() {
  var ov = document.getElementById('hwOverlay');
  if (!ov) return;
  ov.style.display = 'flex';
  setupHandwriteCanvas();
  var st = document.getElementById('hwStatus');
  if (st) st.textContent = '';
  var btn = document.getElementById('hwRecognizeBtn');
  if (btn) { btn.disabled = false; btn.textContent = '🔍 识别'; }
}

function closeHandwritePad() {
  var ov = document.getElementById('hwOverlay');
  if (ov) ov.style.display = 'none';
}

function setupHandwriteCanvas() {
  var c = document.getElementById('hwCanvas');
  if (!c) return;
  var dpr = window.devicePixelRatio || 1;
  var w = c.clientWidth || 300, h = c.clientHeight || 220;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  var ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = hwInkColor();
  ctx.fillStyle = hwInkColor();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  _hwCtx = ctx;
  if (!_hwBound) {
    _hwBound = true;
    c.addEventListener('pointerdown', function(e) {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      _hwDrawing = true;
      c.setPointerCapture(e.pointerId);
      drawHwDot(e);
    });
    c.addEventListener('pointermove', function(e) {
      if (!_hwDrawing) return;
      drawHwLine(e);
    });
    c.addEventListener('pointerup', function() { _hwDrawing = false; });
    c.addEventListener('pointercancel', function() { _hwDrawing = false; });
  }
}

function hwPos(e) {
  var r = e.currentTarget.getBoundingClientRect();
  var pt = (e.touches && e.touches[0]) ? e.touches[0] : e;
  return { x: pt.clientX - r.left, y: pt.clientY - r.top };
}

function drawHwDot(e) {
  var p = hwPos(e);
  var ctx = _hwCtx;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
  ctx.fillStyle = hwInkColor();
  ctx.fill();
}

function drawHwLine(e) {
  var p = hwPos(e);
  var ctx = _hwCtx;
  var pressure = (typeof e.pressure === 'number' && e.pressure > 0) ? e.pressure : 0.5;
  ctx.lineWidth = 2 + pressure * 4;
  ctx.strokeStyle = hwInkColor();
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
}

function clearHandwrite() {
  if (!_hwCtx) return;
  var c = document.getElementById('hwCanvas');
  if (!c) return;
  var dpr = window.devicePixelRatio || 1;
  _hwCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _hwCtx.clearRect(0, 0, c.clientWidth, c.clientHeight);
}

function loadTesseractLib() {
  if (window.Tesseract) return Promise.resolve(true);
  if (_hwScriptPromise) return _hwScriptPromise;
  _hwScriptPromise = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = HW_TESS_URL;
    s.onload = function() {
      // 缓存脚本供后续使用
      try {
        caches.open('cet6-hw-v1').then(function(cache) {
          return cache.add(HW_TESS_URL);
        }).catch(function() {});
      } catch (e) {}
      resolve(true);
    };
    s.onerror = function() { _hwScriptPromise = null; reject(new Error('识别引擎加载失败，请检查网络')); };
    document.head.appendChild(s);
  });
  return _hwScriptPromise;
}

function getHwWorker(lang) {
  if (_hwWorkers[lang]) return Promise.resolve(_hwWorkers[lang]);
  return loadTesseractLib().then(function() {
    return Tesseract.createWorker(lang, 1, {
      logger: function(m) {
        var st = document.getElementById('hwStatus');
        if (!st) return;
        if (m.status === 'loading language traineddata' && typeof m.progress === 'number') {
          st.textContent = '下载语言包 ' + Math.round(m.progress * 100) + '%...（仅首次，之后自动复用）';
        } else if (m.status === 'initializing tesseract' || m.status === 'initializing api') {
          st.textContent = '初始化识别引擎...';
        }
      }
    });
  }).then(function(w) { _hwWorkers[lang] = w; return w; });
}

function recognizeHandwrite() {
  var st = document.getElementById('hwStatus');
  var btn = document.getElementById('hwRecognizeBtn');
  if (!_hwCtx || !st || !btn) return;
  // 检查画布是否有笔迹
  var c = document.getElementById('hwCanvas');
  var imgData = _hwCtx.getImageData(0, 0, c.width, c.height);
  var hasInk = false;
  for (var i = 3; i < imgData.data.length; i += 4) {
    if (imgData.data[i] > 0) { hasInk = true; break; }
  }
  if (!hasInk) { st.textContent = '请先在手写板上书写 ✍️'; return; }

  var lang = (quizState && quizState.mode === 'en2cn') ? 'chi_sim' : 'eng';
  btn.disabled = true;
  btn.textContent = '⏳ 识别中...';
  st.textContent = '加载识别引擎...';

  getHwWorker(lang).then(function(worker) {
    st.textContent = '识别中...';
    return worker.recognize(c).then(function(res) {
      var text = (res && res.data && res.data.text) ? res.data.text : '';
      var cleaned = normalizeOCRText(text, lang);
      var input = document.getElementById('dictInput');
      if (input) { input.value = cleaned; input.focus(); }
      closeHandwritePad();
      if (!cleaned && st) st.textContent = '未识别到文字，请重写或手动输入';
    });
  }).catch(function(err) {
    st.textContent = '识别失败：' + (err && err.message ? err.message : '未知错误');
    btn.disabled = false;
    btn.textContent = '🔍 重试';
  });
}

// OCR 结果清理 + 候选纠错：cn2en 按词库编辑距离匹配（≤2 自动修正拼写），en2cn 仅清理噪声
function normalizeOCRText(raw, lang) {
  if (!raw) return '';
  var s = raw.replace(/\r?\n/g, ' ').trim();
  if (lang === 'chi_sim') {
    return s.replace(/[^\u4e00-\u9fff，。、；;·]/g, '').replace(/\s+/g, '');
  }
  var tokens = s.match(/[a-zA-Z]+/g) || [];
  var words = [];
  for (var i = 0; i < tokens.length; i++) {
    var lower = tokens[i].toLowerCase();
    var best = findBestDictWord(lower);
    words.push(best ? best : tokens[i]);
  }
  return words.join(' ');
}

function findBestDictWord(lower) {
  var list = [];
  if (typeof ALL_WORDS !== 'undefined' && ALL_WORDS) list = list.concat(ALL_WORDS);
  if (typeof FULL_WORDS !== 'undefined' && FULL_WORDS && FULL_WORDS.length) list = list.concat(FULL_WORDS);
  if (typeof C1500_WORDS !== 'undefined' && C1500_WORDS && C1500_WORDS.length) list = list.concat(C1500_WORDS);
  var best = null, bestDist = 3;
  for (var i = 0; i < list.length; i++) {
    var w = list[i].word;
    if (!w) continue;
    var wl = w.toLowerCase();
    var d = levenshtein(lower, wl);
    if (d === 0) return w;
    // 距离 1 可信；距离 2 仅当长度接近（差 ≤1），避免短词误纠
    if (d === 1 && d < bestDist) { best = w; bestDist = d; }
    else if (d === 2 && Math.abs(lower.length - wl.length) <= 1 && d < bestDist) { best = w; bestDist = d; }
  }
  return best;
}

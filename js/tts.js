/* tts.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ TTS ============
var _pendingSpeak = null;
var _pendingSpeakSeq = 0;
var _ttsWaiting = false;
var _onlineTTSAudio = null;
var _speakSeq = 0;            // 朗读代次：每次 speakWord 递增；过期的回退/补读据此放弃
// 词条写法 → 可发音文本。
// 词库里保留了书上的合并写法（hono(u)r / symbolic(al) / a/an / theatre/-ter / photo(graph)），
// 直接送进 TTS 接口会被拒（有道返回 HTTP 500），从而错误地回退到系统 TTS、输出设备随之改变。
function normalizeSpeakText(text) {
  var t = String(text == null ? '' : text);
  t = t.replace(/\(([A-Za-z'’\-\. ]*)\)/g, '$1');  // 展开括号：vigo(u)r → vigour
  t = t.replace(/\/-?[A-Za-z'’\.]*/g, '');          // 去掉斜杠变体：a/an → a；theatre/-ter → theatre
  t = t.replace(/[¹²³⁴⁵]/g, '');                     // 去掉上标（历史数据残留）
  t = t.replace(/\s+/g, ' ').trim();
  return t || String(text == null ? '' : text);
}
// 优先使用普通媒体音频，跟随视频/音乐的输出路由（包括蓝牙 A2DP）；失败时回退系统 TTS。
// type: 2 = 美式（默认），1 = 英式；换音源重试仍在同一媒体通道内，不会改变输出设备。
function playOnlineTTS(text, onFailure, seq, type) {
  var audio = null;
  var settled = false;
  var started = false;
  function fail() {
    if (settled) return;
    settled = true;
    if (audio === _onlineTTSAudio) _onlineTTSAudio = null;
    // 判定失败的在线音频必须立即停掉（含仍在缓冲、尚未出声的情况）：
    // 否则它稍后缓冲完成开始播放，会与接管播放的系统 TTS 同时出声——
    // 这就是「在线男声 + 系统女声重叠」的来源。
    try { audio.pause(); } catch (e) {}
    try { audio.removeAttribute('src'); try { audio.load(); } catch (e2) {} } catch (e) {}
    if (onFailure && seq === _speakSeq) onFailure();
  }
  try {
    if (_onlineTTSAudio) {
      _onlineTTSAudio.pause();
      _onlineTTSAudio = null;
    }
    audio = new Audio('https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(text) + '&type=' + (type || 2));
    audio.preload = 'auto';
    audio.onplaying = function() { started = true; };
    audio.onerror = fail;
    audio.onended = function() {
      started = true;
      settled = true;
      if (audio === _onlineTTSAudio) _onlineTTSAudio = null;
    };
    _onlineTTSAudio = audio;
    var playResult = audio.play();
    if (playResult && typeof playResult.then === 'function') {
      playResult.then(function() { started = true; }, fail);
    }
    // 网络请求被拦截时部分浏览器不会及时触发 error，避免系统 TTS 长时间无反馈。
    setTimeout(function() {
      if (!settled && !started && audio === _onlineTTSAudio && audio.paused) fail();
    }, 2500);
    return true;
  } catch(e) {
    fail();
    return false;
  }
}
function speakSystemTTS(text) {
  if (!window.speechSynthesis) return false;
  var voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return false;
  window.speechSynthesis.cancel();
  var u = new SpeechSynthesisUtterance(text);
  var enVoice = null;
  for (var i = 0; i < voices.length; i++) {
    if (voices[i].lang && voices[i].lang.toLowerCase().indexOf('en') === 0) { enVoice = voices[i]; break; }
  }
  if (enVoice) { try { u.voice = enVoice; u.lang = enVoice.lang; } catch(e) { u.lang = 'en-US'; } }
  else { u.lang = 'en-US'; }
  u.rate = 0.85;
  window.speechSynthesis.speak(u);
  return true;
}
function speakWord(rawText) {
  if (!rawText) return;
  // 统一规范化朗读文本：词条里的括号/斜杠写法（vigo(u)r、a/an…）会让在线音频接口报错，
  // 一旦报错就会掉进系统 TTS 通道（输出设备可能不是蓝牙耳机）。规范化后两端都更稳。
  var text = normalizeSpeakText(rawText);
  var seq = ++_speakSeq;   // 新朗读开始：此前所有回退/补读定时器全部过期
  // 普通媒体音频能跟随蓝牙媒体输出；播放失败时才使用系统 TTS。
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (navigator.onLine === false) {
    if (speakSystemTTS(text)) return;
    _pendingSpeak = text;
    _pendingSpeakSeq = seq;
    if (_ttsWaiting) return;
    _ttsWaiting = true;
    setTimeout(function() {
      _ttsWaiting = false;
      var offlineText = _pendingSpeak; _pendingSpeak = null;
      if (offlineText && seq === _speakSeq) speakSystemTTS(offlineText);
    }, 1500);
    return;
  }
  var fallbackStarted = false;
  var retriedAlt = false;
  function onlineFailed() {
    // 先在同一媒体通道内换英式音源重试（仍走 HTMLAudioElement → 仍是蓝牙耳机输出），
    // 只有两个音源都失败才回退系统 TTS。
    if (!retriedAlt) {
      retriedAlt = true;
      if (playOnlineTTS(text, onlineFailed, seq, 1)) return;
    }
    if (speakSystemTTS(text)) { fallbackStarted = true; return; }
    _pendingSpeak = text;
    _pendingSpeakSeq = seq;
    if (_ttsWaiting) return;
    _ttsWaiting = true;
    setTimeout(function() {
      _ttsWaiting = false;
      var t = _pendingSpeak; _pendingSpeak = null;
      if (t && seq === _speakSeq) speakSystemTTS(t);
    }, 1500);
  }
  if (playOnlineTTS(text, onlineFailed, seq, 2) || fallbackStarted) return;
  if (!window.speechSynthesis) return;
  // 系统 TTS 语音列表未就绪：等待加载，超时后结束本次尝试
  _pendingSpeak = text;
  _pendingSpeakSeq = seq;
  if (_ttsWaiting) return;
  _ttsWaiting = true;
  setTimeout(function() {
    _ttsWaiting = false;
    var t = _pendingSpeak; _pendingSpeak = null;
    if (!t) return;
    if (seq !== _speakSeq) return;   // 期间用户已切题/发起新朗读：旧回退过期
    speakSystemTTS(t);
  }, 1500);
}
// 页面加载时预加载语音列表；列表就绪后补读等待中的朗读
if (window.speechSynthesis) {
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = function() {
      // 只补读「当前代」的待读词；旧代待读词在用户切题后已无意义
      if (_pendingSpeak && _pendingSpeakSeq === _speakSeq) {
        var t = _pendingSpeak; _pendingSpeak = null;
        speakWord(t);
      }
    };
  } catch(e) {}
}

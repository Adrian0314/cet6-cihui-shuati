/* pronunciation.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ 发音练习（跟读 + 语音识别比对）============
// 入口按钮与「朗读」并排（.pron-pill-row），练习页与查单词详解页共用 pronPracticePillRow() 渲染，
// 高度由 .pron-pill 统一决定；发音练习按钮加 .wide 稍宽，整体与相邻元素居中对齐。
// 跟读使用同一段 PCM 录音进行识别，采集与回放生命周期见 pronunciation-audio.js。
var PRON_STORE_KEY = 'cet6_pron_practice_v1';
var _ppEsc = function(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};
// 只保留字母后比对：忽略大小写、空格、连字符、撇号与音标差异
function pronNormalize(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z]/g, ''); }
function pronStatsAll() {
  try { return JSON.parse(localStorage.getItem(PRON_STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function pronStatsGet(word) {
  var rec = pronStatsAll()[String(word || '').toLowerCase()];
  return rec || { tries: 0, oks: 0 };
}
function pronStatsBump(word, ok) {
  var rec = { tries: 1, oks: ok ? 1 : 0 };
  try {
    var all = pronStatsAll();
    var k = String(word || '').toLowerCase();
    rec = all[k] || { tries: 0, oks: 0 };
    rec.tries += 1;
    if (ok) rec.oks += 1;
    rec.last = Date.now();
    all[k] = rec;
    localStorage.setItem(PRON_STORE_KEY, JSON.stringify(all));
  } catch (e) {}
  return rec;
}
// 两个按钮的统一渲染入口（练习页 / 查单词详解页共用）。用 data-* + 事件委托，
// 避免把含撇号、引号的单词与音标拼进 onclick 字符串。
function pronPracticePillRow(wordText, ipa) {
  if (!wordText) return '';
  return '<div class="pron-pill-row">' +
    '<span class="pron-pill" data-pron-speak="' + _ppEsc(wordText) + '" title="朗读发音">\u{1F50A} 朗读</span>' +
    '<span class="pron-pill wide" id="pronPracticeBtn" data-pron-practice="' + _ppEsc(wordText) + '"' +
    (ipa ? ' data-pron-ipa="' + _ppEsc(ipa) + '"' : '') + ' title="跟读练习发音">\u{1F3A4} 发音练习</span>' +
    '</div>';
}
document.addEventListener('click', function(e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-pron-speak],[data-pron-practice]') : null;
  if (!el) return;
  if (el.hasAttribute('data-pron-speak')) { speakWord(el.getAttribute('data-pron-speak') || ''); return; }
  openPronPractice(el.getAttribute('data-pron-practice') || '', el.getAttribute('data-pron-ipa') || '');
});
var _ppState = { word: '', ipa: '', rec: null, listening: false, stoppedByUser: false, gotResult: false, watchdog: null,
                 pending: false, stream: null, ac: null, analyser: null, meterTimer: null, silenceTimer: null, peak: 0,
                 maxPeak: 0, checking: false, checkTimer: null, deviceId: '', recorder: null, chunks: null,
                 recording: false, recTimer: null, playbackUrl: '', recRms: [], recSampler: null };
// PCM 录音与识别共用输入设备；用 session 隔离旧回调，防止关闭/换词后覆盖新一轮结果。
function ppClearWatchdog() {
  if (_ppState.watchdog) { clearTimeout(_ppState.watchdog); _ppState.watchdog = null; }
}
function ppSetStatus(text) {
  var el = document.getElementById('ppStatus');
  if (el) el.textContent = text || '';
}
function ppPanelHTML(word, ipa) {
  var st = pronStatsGet(word);
  return '<div class="pp-head"><span>🎤 发音练习</span><span class="pp-close" id="ppCloseBtn" title="关闭（Esc）">✕</span></div>' +
    '<div class="pp-word">' + _ppEsc(word) + (ipa ? '<span class="pp-ipa">' + _ppEsc(ipa) + '</span>' : '') + '</div>' +
    '<div class="pp-tip">先听标准发音，再开始跟读；读完结束录音，查看目标词是否匹配。可回听自己的录音，识别不确定时也可自评。</div>' +
    '<div class="pp-model" id="ppModelRow"><span id="ppModelState">识别资源：首次练习时自动准备</span>' +
    '<button class="pp-btn" id="ppModelLoadBtn">准备识别资源</button>' +
    '<button class="pp-btn" id="ppModelFileBtn" title="选择已下载的识别资源文件（tar.gz）">导入资源…</button>' +
    '<input type="file" id="ppModelFile" accept=".gz,.tgz,application/gzip,application/x-gzip" style="display:none"></div>' +
    '<div class="pp-actions"><button class="pp-btn" id="ppPlayBtn">🔊 听标准发音</button>' +
    '<button class="pp-btn primary" id="ppRecBtn">🎤 开始跟读</button></div>' +
    '<div class="pp-status" id="ppStatus" role="status" aria-live="polite"></div>' +
    '<div class="pp-meter" id="ppMeter"><span>输入电平</span><span class="pp-meter-track"><span class="pp-meter-fill" id="ppMeterFill"></span></span><span class="pp-meter-val" id="ppMeterVal">—</span></div>' +
    '<div class="pp-result" id="ppResult"></div>' +
    '<div class="pp-actions pp-tools"><button class="pp-btn" id="ppCheckBtn" title="只检测麦克风输入，不做识别">🎚 检测麦克风</button>' +
    '<button class="pp-btn" id="ppRecBtn2">⏺ 录音对比</button>' +
    '<button class="pp-btn" id="ppPlayMineBtn" style="display:none">▶ 播放我的录音</button></div>' +
    '<div class="pp-micsel" id="ppMicRow" style="display:none"><span>输入设备</span><select id="ppMicSel"></select></div>' +
    '<div class="pp-status" id="ppRecStatus"></div>' +
    '<div class="pp-manual"><button class="pp-btn" id="ppSelfOk">✅ 读对了（自评）</button>' +
    '<button class="pp-btn" id="ppSelfAgain">🔁 再练一次</button></div>' +
    '<div class="pp-stats" id="ppStats">' +
    (st.tries ? '本词已练 ' + st.tries + ' 次，达标/自评读对 ' + st.oks + ' 次' : '本词还没有练习记录') + '</div>';
}
function openPronPractice(word, ipa) {
  if (!word) return;
  ppCancelSession();
  _ppState.word = word;
  _ppState.ipa = ipa || '';
  // 每次打开面板都重置跟读状态机，避免上一轮的 listening/结果标记残留
  ppListenIdle('\u{1F3A4} 开始跟读');
  _ppState.stoppedByUser = false;
  _ppState.gotResult = false;
  _ppState.deviceId = ppSavedDeviceId();          // 沿用上次选择的输入设备
  if (_ppState.playbackUrl) { try { URL.revokeObjectURL(_ppState.playbackUrl); } catch (e) {} _ppState.playbackUrl = ''; }
  var el = document.getElementById('pronPracticePanel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pronPracticePanel';
    el.className = 'pp-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', '发音练习');
    el.addEventListener('click', function(ev) { if (ev.target === el) closePronPractice(); });
    document.body.appendChild(el);
  }
  el.innerHTML = '<div class="pp-panel">' + ppPanelHTML(word, ipa) + '</div>';
  el.classList.add('open');
  var byId = function(id) { return document.getElementById(id); };
  byId('ppPlayBtn').addEventListener('click', function() { speakWord(word); });
  byId('ppRecBtn').addEventListener('click', ppListen);
  byId('ppCloseBtn').addEventListener('click', closePronPractice);
  // 辅助通道：麦克风电平检测与录音回放。
  byId('ppCheckBtn').addEventListener('click', ppToggleMicCheck);
  byId('ppRecBtn2').addEventListener('click', ppToggleRecord);
  byId('ppPlayMineBtn').addEventListener('click', ppPlayMyRecording);
  byId('ppModelLoadBtn').addEventListener('click', function() {
    ppVoskEnsureModel(function(p) { ppVoskState('识别资源：下载中 ' + Math.round(p * 100) + '%', 'busy'); })
      .then(function() {})
      .catch(function() {});
  });
  byId('ppModelFileBtn').addEventListener('click', function() { var f = byId('ppModelFile'); if (f) f.click(); });
  byId('ppModelFile').addEventListener('change', function() {
    var f = this.files && this.files[0];
    if (f) ppVoskUseLocalFile(f);
    this.value = '';
  });
  ppRefreshModelState();
  var micSel = byId('ppMicSel');
  if (micSel) {
    micSel.addEventListener('change', function() {
      ppSaveDeviceId(this.value || '');
      ppSetStatus(this.value
        ? '已切换输入设备：下次跟读/检测会用它（若设备不可用会自动回退到系统默认）。'
        : '已改用系统默认输入设备。');
    });
  }
  ppRefreshMicList();   // 已授权时可直接列出设备名；未授权时先隐藏，授权后会自动刷新
  byId('ppSelfOk').addEventListener('click', function() {
    ppCancelSession();   // 自评不得被延迟到达的识别结果覆盖
    ppFinish({ level: 'ok', text: '已按自评记录为「读对了」', dist: 0 }, '');
  });
  byId('ppSelfAgain').addEventListener('click', function() {
    ppCancelSession();
    speakWord(word);
    ppSetStatus('再听一遍标准发音，然后点「开始跟读」。');
  });
  ppSetStatus('先听一遍标准发音，再点「开始跟读」。首次练习会自动准备约 39 MB 识别资源。');
  speakWord(word);   // 打开面板即播一遍标准发音，便于跟读
}
// 展示结果 + 记录练习次数
function ppFinish(verdict, heard) {
  var ok = verdict.level === 'ok';
  var st = pronStatsBump(_ppState.word, ok);
  var res = document.getElementById('ppResult');
  if (res) {
    res.className = 'pp-result ' + verdict.level;
    res.textContent = (verdict.level === 'ok' ? '\u2705 ' : (verdict.level === 'near' ? '\u26A0\uFE0F ' : '\u274C ')) + verdict.text;
  }
  ppSetStatus(heard ? '识别到的读音：' + heard : '');
  var stats = document.getElementById('ppStats');
  if (stats) stats.textContent = '本词已练 ' + st.tries + ' 次，达标/自评读对 ' + st.oks + ' 次';
  // 结果已出：本轮结束，按钮恢复可再次跟读（否则会一直是「结束跟读」的假状态）
  _ppState.gotResult = true;
  ppListenIdle('\u{1F3A4} 再读一次');
  return st;
}
// ---------- 麦克风自检 ----------
// 用户的典型故障是「耳机能听、但网页收不到麦克风声音」。原因可能在系统默认输入设备、
// 设备属性里的「允许应用和 Windows 将此设备用于音频」、Windows 麦克风隐私开关，或浏览器站点权限。
// 这里在开始跟读前主动 getUserMedia 一次（既能触发权限申请，也能拿到设备），并用
// AudioContext 画实时输入电平：电平一直不动 = 声音没进来，属于环境问题而非功能问题。
function ppMicErrorMessage(err) {
  var n = (err && err.name) || '';
  if (n === 'NotAllowedError' || n === 'SecurityError') {
    return '麦克风权限被拒绝：点地址栏左侧的图标，把「麦克风」改为“允许”后重试（浏览器会记住上次的拒绝）。';
  }
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') {
    return '系统里没有找到可用的麦克风：请到「设置 → 系统 → 声音 → 输入」确认有已启用的输入设备。';
  }
  if (n === 'NotReadableError' || n === 'TrackStartError') {
    return '麦克风被其它程序占用或驱动异常：请先关闭正在通话/录音的软件，再重试。';
  }
  if (n === 'OverconstrainedError') {
    return '指定的麦克风不可用：请把系统默认输入设备改回可用设备后重试。';
  }
  return '无法打开麦克风（' + (n || '未知错误') + '）：请检查系统「隐私和安全性 → 麦克风」是否允许应用访问。';
}
// 输入设备：优先用用户在下拉框里选的（存本机），否则用系统默认
var PP_MIC_KEY = 'cet6_pron_mic_v1';
function ppSavedDeviceId() {
  try { return localStorage.getItem(PP_MIC_KEY) || ''; } catch (e) { return ''; }
}
function ppSaveDeviceId(id) {
  _ppState.deviceId = id || '';
  try { if (id) localStorage.setItem(PP_MIC_KEY, id); else localStorage.removeItem(PP_MIC_KEY); } catch (e) {}
}
function ppMicConstraints() {
  return _ppState.deviceId ? { audio: { deviceId: { exact: _ppState.deviceId } } } : { audio: true };
}
// 设备列表：授权前 label 为空，用「输入设备 N」占位；拿到权限后再刷新一次即可看到名称
function ppRefreshMicList() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return;
  navigator.mediaDevices.enumerateDevices().then(function(list) {
    var mics = (list || []).filter(function(d) { return d.kind === 'audioinput'; });
    var row = document.getElementById('ppMicRow');
    var sel = document.getElementById('ppMicSel');
    if (!row || !sel) return;
    if (mics.length < 2) { row.style.display = 'none'; return; }   // 只有一个设备就没必要给选择
    var html = '<option value="">系统默认</option>';
    for (var i = 0; i < mics.length; i++) {
      var label = mics[i].label || ('输入设备 ' + (i + 1));
      html += '<option value="' + _ppEsc(mics[i].deviceId) + '"'
        + (mics[i].deviceId === _ppState.deviceId ? ' selected' : '') + '>' + _ppEsc(label) + '</option>';
    }
    sel.innerHTML = html;
    row.style.display = 'flex';
  }).catch(function() {});
}
function ppEnsureMic(token) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve({ ok: true, skipped: true });
  return navigator.mediaDevices.getUserMedia(ppMicConstraints()).catch(function(err) {
    if (err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') && _ppState.deviceId) {
      if (token != null && token !== _ppState.session) throw err;
      ppSaveDeviceId('');
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
    throw err;
  }).then(function(stream) {
    // A permission dialog may resolve AFTER closing or switching the word.
    // Stop only this late stream; never overwrite/stop the newer session's stream.
    if (token != null && token !== _ppState.session) {
      stream.getTracks().forEach(function(t) { t.stop(); });
      return { ok: false, cancelled: true };
    }
    _ppState.stream = stream;
    ppStartMeter(stream);
    ppRefreshMicList();
    return { ok: true, stream: stream };
  }).catch(function(err) {
    return { ok: false, message: ppMicErrorMessage(err) };
  });
}
// 采样若干毫秒内的最大电平——判断"到底有没有声音进来"要看整段时间的峰值，
// 不能只看判断时刻的瞬时值：先说后停会被误判成"一直没有输入"。
function ppMicProbe(ms) {
  return new Promise(function(resolve) {
    var best = 0, t0 = Date.now();
    var timer = setInterval(function() {
      if (_ppState.peak > best) best = _ppState.peak;
      if (_ppState.maxPeak > best) best = _ppState.maxPeak;
      if (Date.now() - t0 >= ms) { clearInterval(timer); resolve(best); }
    }, 60);
  });
}
function ppSampleRecFrame() {
  // 录音期间按 20ms 采样一帧 RMS，攒成包络；这样"有没有人声"完全靠本地数据判断，
  // 不依赖对 MediaRecorder 产物的解码（webm/opus 用 decodeAudioData 常只解出头部一小段）。
  try {
    if (!_ppState.analyser) return;
    var buf = new Uint8Array(_ppState.analyser.fftSize);
    _ppState.analyser.getByteTimeDomainData(buf);
    var sq = 0;
    for (var i = 0; i < buf.length; i++) { var d = (buf[i] - 128) / 128; sq += d * d; }
    var rms = Math.sqrt(sq / buf.length);
    _ppState.recRms.push(rms);
    if (rms > _ppState.maxPeak) _ppState.maxPeak = rms;
  } catch (e) {}
}
function ppStartMeter(stream) {
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _ppState.ac = new Ctx();
    var src = _ppState.ac.createMediaStreamSource(stream);
    var an = _ppState.ac.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    _ppState.analyser = an;
    _ppState.peak = 0;
    _ppState.maxPeak = 0;
    var buf = new Uint8Array(an.fftSize);
    var tick = function() {
      if (!_ppState.analyser) return;
      try {
        _ppState.analyser.getByteTimeDomainData(buf);
        var peak = 0;
        for (var i = 0; i < buf.length; i++) {
          var v = Math.abs(buf[i] - 128) / 128;
          if (v > peak) peak = v;
        }
        _ppState.peak = Math.max(_ppState.peak * 0.85, peak);
        if (_ppState.peak > _ppState.maxPeak) _ppState.maxPeak = _ppState.peak;
        ppDrawLevel(_ppState.peak);
      } catch (e) {}
      _ppState.meterTimer = requestAnimationFrame(tick);
    };
    tick();
    var meter = document.getElementById('ppMeter');
    if (meter) meter.classList.add('on');
  } catch (e) {
    // 环境不支持音频分析（或拿到的是假流）时静默降级：不影响语音识别本身
  }
}
// 电平一直不动时的提示文案（含用户最需要检查的三处）
function ppSilenceHint() {
  return '麦克风一直没有声音输入：请检查「设置 → 系统 → 声音 → 输入」的默认设备，'
    + '以及该设备属性里「允许应用和 Windows 将此设备用于音频」是否为“允许”；'
    + '蓝牙耳机还需确认它已切到“免手操/通话”模式。';
}
function ppPlayMyRecording() {
  if (!_ppState.playbackUrl) { ppSetStatus('还没有录音，先点「⏺ 录音对比」。'); return; }
  try {
    var a = new Audio(_ppState.playbackUrl);
    a.play().catch(function() {});
  } catch (e) {}
}
// ---------- 录音的本地分析：判断"到底有没有人声"（不依赖云端识别）----------
// 用 Web Speech 之类的云端识别时，一旦服务不可用，界面只会说"没有识别到内容"，
// 让人误以为是麦克风没声音。这里对录下来的音频做纯本地分析：分帧 RMS → 阈值 → 有声时长与音节段，
// 从而能把"设备没送声音"和"识别服务不可用"区分开。
function ppRecStatusSet(text) {
  var el = document.getElementById('ppRecStatus');
  if (el) el.textContent = text || '';
}
function ppCurrentMicLabel() {
  var sel = document.getElementById('ppMicSel');
  if (sel && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) {
    return sel.options[sel.selectedIndex].textContent || '';
  }
  return '';
}
function ppIsBluetoothMic() {
  return /蓝牙|bluetooth/i.test(ppCurrentMicLabel());
}
// 纯函数：便于单测（直接喂合成采样数据）
// 纯函数：帧级 RMS 序列 → 有声时长/音节段（便于单测与复用）
function ppVadFromFrames(rms, frameSec) {
  var fs = frameSec || 0.02;
  rms = rms || [];
  var peak = 0, i;
  for (i = 0; i < rms.length; i++) { if (rms[i] > peak) peak = rms[i]; }
  // 噪声底用「低分位」估计，而不是整体均值：说话占比高时均值会被抬高，
  // 用均值当底会把阈值顶到人声之上，导致"有声音却判成没有输入"。
  var sorted = rms.slice().sort(function(a, b) { return a - b; });
  var noise = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.2)] : 0;
  var thr = Math.max(noise * 3, peak * 0.08, 0.004);
  var voicedFrames = 0, segments = 0, inSeg = false;
  for (i = 0; i < rms.length; i++) {
    if (rms[i] >= thr) {
      voicedFrames++;
      if (!inSeg) { segments++; inSeg = true; }
    } else if (rms[i] < thr * 0.6) {
      inSeg = false;                                  // 迟滞：短暂低于阈值不算断开
    }
  }
  var total = 0;
  for (i = 0; i < rms.length; i++) total += rms[i];
  return { seconds: rms.length * fs, voicedSec: voicedFrames * fs, segments: segments,
           peak: peak, mean: rms.length ? total / rms.length : 0, noise: noise,
           threshold: thr, frames: rms.length };
}
function ppVoiceStats(samples, sampleRate) {
  var sr = sampleRate || 48000;
  var n = samples ? samples.length : 0;
  var frame = Math.max(1, Math.round(sr * 0.02));    // 20ms 一帧
  var rms = [], i, j;
  for (i = 0; i + frame <= n; i += frame) {
    var s = 0;
    for (j = 0; j < frame; j++) { var v = samples[i + j]; s += v * v; }
    rms.push(Math.sqrt(s / frame));
  }
  return ppVadFromFrames(rms, frame / sr);
}
function ppVoiceVerdict(st) {
  if (!st || !st.frames) return { level: 'bad', text: '录音太短（不足 0.1 秒），请至少读满 1 秒。' };
  var pct = Math.max(0, Math.min(100, Math.round((st.peak || 0) * 140)));
  if ((st.voicedSec || 0) < 0.25) {
    return { level: 'bad', text: '未检测到清晰人声：录音里几乎只有底噪（峰值 ' + pct + '%）。'
      + '请靠近麦克风、把系统“输入音量”调大' + (ppIsBluetoothMic() ? '，或改用内置麦克风（蓝牙免手操是 16 kHz 窄带，电平常偏低）' : '') + '，然后重录。' };
  }
  return { level: 'ok', text: '已检测到人声：约 ' + st.voicedSec.toFixed(1) + ' 秒，峰值 ' + pct + '%'
    + (st.segments > 1 ? '，约 ' + st.segments + ' 个音节段' : '')
    + (pct < 15 ? '。音量偏小，建议把输入音量再调大一点。' : '。') };
}
function ppAnalyzeRecording(blob) {
  return new Promise(function(resolve) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || typeof blob.arrayBuffer !== 'function') { resolve(null); return; }
    blob.arrayBuffer().then(function(buf) {
      var ac;
      try { ac = new Ctx(); } catch (e) { resolve(null); return; }
      ac.decodeAudioData(buf).then(function(audio) {
        var st = ppVoiceStats(audio.getChannelData(0), audio.sampleRate);
        try { ac.close(); } catch (e) {}
        resolve(st);
      }).catch(function() { try { ac.close(); } catch (e) {} resolve(null); });
    }).catch(function() { resolve(null); });
  });
}
function ppDrawLevel(peak) {
  var pct = Math.max(0, Math.min(100, Math.round(peak * 140)));
  var fill = document.getElementById('ppMeterFill');
  var val = document.getElementById('ppMeterVal');
  if (fill) fill.style.width = pct + '%';
  if (val) val.textContent = pct <= 2 ? '没有输入' : '输入电平 ' + pct + '%';
}
function ppStopMeter() {
  if (_ppState.meterTimer) { cancelAnimationFrame(_ppState.meterTimer); _ppState.meterTimer = null; }
  if (_ppState.silenceTimer) { clearTimeout(_ppState.silenceTimer); _ppState.silenceTimer = null; }
  _ppState.analyser = null;
  try { if (_ppState.ac && typeof _ppState.ac.close === 'function') _ppState.ac.close(); } catch (e) {}
  _ppState.ac = null;
  try {
    if (_ppState.stream && typeof _ppState.stream.getTracks === 'function') {
      _ppState.stream.getTracks().forEach(function(t) { try { t.stop(); } catch (e) {} });
    }
  } catch (e) {}
  _ppState.stream = null;
  var meter = document.getElementById('ppMeter');
  if (meter) meter.classList.remove('on');
}
// ============ 本机模型准备：vosk-browser（Vosk WASM）============
// 音频采集与识别在 pronunciation-audio.js；这里负责运行库、缓存和模型加载。
var PP_VOSK = {
  libUrl: 'vosk/vosk.js',
  modelPath: 'vosk/vosk-model-small-en-us-0.15.tar.gz',   // 必须随 GitHub Pages 部署，首次加载后缓存
  modelUrl: '',                                           // 可选在线地址，必须带 CORS 头
  cacheName: 'cet6-vosk-model-v1',
  cacheKey: 'vosk-model-small-en-us-0.15.tar.gz',
  libLoading: null, model: null, modelPromise: null, modelSrc: '',
  rec: null, stream: null, ac: null, proc: null, gain: null, src: null, finishTimer: null, readyAt: 0,
  text: '', partial: '', onPartial: null, onFinal: null, running: false
};
function ppVoskEnvOk() {
  if (!(window.Worker && window.WebAssembly)) return '当前浏览器不支持 WebAssembly/Web Worker，无法进行发音检测。';
  if (location.protocol === 'file:') return '发音检测需要以 http(s) 打开页面（如 GitHub Pages 或本地 http 服务）；file:// 下浏览器不允许创建 Worker。';
  return '';
}
function ppVoskState(text, cls) {
  var el = document.getElementById('ppModelState');
  var row = document.getElementById('ppModelRow');
  if (el) el.textContent = text;
  if (row) { row.classList.remove('ok', 'busy'); if (cls) row.classList.add(cls); }
}
function ppVoskLoadLib() {
  if (window.Vosk) return Promise.resolve(window.Vosk);
  if (PP_VOSK.libLoading) return PP_VOSK.libLoading;
  PP_VOSK.libLoading = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = PP_VOSK.libUrl;
    s.async = true;
    s.onload = function() { window.Vosk ? resolve(window.Vosk) : reject(new Error('vosk.js 已加载但未导出 Vosk')); };
    s.onerror = function() { PP_VOSK.libLoading = null; reject(new Error('无法加载 ' + PP_VOSK.libUrl + '（确认该文件已随站点部署）')); };
    document.head.appendChild(s);
  });
  return PP_VOSK.libLoading;
}
function ppVoskCacheOpen() {
  return (window.caches ? caches.open(PP_VOSK.cacheName) : Promise.reject(new Error('浏览器不支持 Cache Storage')));
}
// 取已缓存的模型（返回 blob URL）
function ppVoskCachedModelUrl() {
  return ppVoskCacheOpen().then(function(cache) {
    return cache.match(PP_VOSK.cacheKey).then(function(res) {
      if (!res) return '';
      return res.blob().then(function(b) { return URL.createObjectURL(b); });
    });
  }).catch(function() { return ''; });
}
// 带进度的下载：返回 blob，并写入缓存
function ppVoskDownload(url, onProgress) {
  return fetch(url, { mode: 'cors' }).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var total = parseInt(res.headers.get('content-length') || '0', 10);
    if (!res.body || !res.body.getReader) return res.blob();
    var reader = res.body.getReader(), chunks = [], got = 0;
    return (function pump() {
      return reader.read().then(function(r) {
        if (r.done) return new Blob(chunks, { type: 'application/gzip' });
        chunks.push(r.value); got += r.value.length;
        if (onProgress && total) onProgress(got / total);
        return pump();
      });
    })();
  });
}
// 解析模型：缓存 → 同源文件 → 在线地址，命中后统一写入缓存
function ppVoskResolveModel(onProgress) {
  return ppVoskCachedModelUrl().then(function(cached) {
    if (cached) { PP_VOSK.modelSrc = 'cache'; return cached; }
    var trySameOrigin = fetch(PP_VOSK.modelPath, { method: 'HEAD' }).then(function(r) {
      return r.ok ? PP_VOSK.modelPath : null;
    }).catch(function() { return null; });
    return trySameOrigin.then(function(path) {
      var url = path || PP_VOSK.modelUrl;
      if (!url) throw new Error('未找到识别资源：请把 ' + PP_VOSK.modelPath + ' 放到站点目录，或点「导入资源…」选中已下载的压缩包。');
      PP_VOSK.modelSrc = path ? 'same-origin' : 'online';
      return ppVoskDownload(url, onProgress).then(function(blob) {
        return ppVoskCacheOpen().then(function(cache) {
          return cache.put(PP_VOSK.cacheKey, new Response(blob, { headers: { 'Content-Type': 'application/gzip' } }));
        }).catch(function() {}).then(function() { return URL.createObjectURL(blob); });
      });
    });
  });
}
function ppVoskEnsureModel(onProgress) {
  if (PP_VOSK.model) return Promise.resolve(PP_VOSK.model);
  if (PP_VOSK.modelPromise) return PP_VOSK.modelPromise;
  var envErr = ppVoskEnvOk();
  if (envErr) return Promise.reject(new Error(envErr));
  ppVoskState('识别资源：加载运行库…', 'busy');
  PP_VOSK.modelPromise = ppVoskLoadLib().then(function(Vosk) {
    ppVoskState('识别资源：准备模型文件…', 'busy');
    return ppVoskResolveModel(onProgress);
  }).then(function(modelUrl) {
    ppVoskState('识别资源：解析中（首次约几秒）…', 'busy');
    return ppVoskCreateModel(modelUrl);
  }).then(function(model) {
    PP_VOSK.model = model;
    ppVoskState('识别资源：✅ 已就绪（' + (PP_VOSK.modelSrc === 'cache' ? '来自本机缓存' : PP_VOSK.modelSrc === 'same-origin' ? '已缓存到本机' : '已下载并缓存') + '）', 'ok');
    return model;
  }).catch(function(err) {
    PP_VOSK.modelPromise = null;
    ppVoskState('识别资源：加载失败 — ' + (err && err.message ? err.message : '未知错误'));
    throw err;
  });
  return PP_VOSK.modelPromise;
}
// 使用选中的识别资源文件，直接创建 blob URL。
function ppVoskUseLocalFile(file, onProgress) {
  if (!file) return;
  var envErr = ppVoskEnvOk();
  if (envErr) { ppVoskState('识别资源：' + envErr); return; }
  ppVoskState('识别资源：读取本机文件 ' + file.name + '…', 'busy');
  var blobUrl = URL.createObjectURL(file);
  ppVoskCacheOpen().then(function(cache) {
    return cache.put(PP_VOSK.cacheKey, new Response(file, { headers: { 'Content-Type': 'application/gzip' } }));
  }).catch(function() {});
  PP_VOSK.modelSrc = 'local-file';
  ppVoskState('识别资源：解析中…', 'busy');
  ppVoskLoadLib().then(function() { return ppVoskCreateModel(blobUrl); }).then(function(model) {
    PP_VOSK.model = model;
    PP_VOSK.modelPromise = Promise.resolve(model);
    ppVoskState('识别资源：✅ 已就绪（来自本机文件，已缓存）', 'ok');
  }).catch(function(err) {
    ppVoskState('识别资源：解析失败 — ' + (err && err.message ? err.message : '未知错误'));
  });
}
// 在识别结果里挑与目标词最接近的一段（识别结果为整句文本）
function ppPickBestHeard(target, text) {
  var t = pronNormalize(target);
  var raw = String(text || '').trim();
  if (!raw) return '';
  var tokens = raw.split(/\s+/), best = raw, bestD = Infinity;
  for (var i = 0; i < tokens.length; i++) {
    var n = pronNormalize(tokens[i]);
    if (!n) continue;
    var d = (typeof levenshtein === 'function') ? levenshtein(t, n) : Math.abs(t.length - n.length);
    if (d < bestD) { bestD = d; best = tokens[i]; }
    if (d === 0) break;
  }
  return best;
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    var el = document.getElementById('pronPracticePanel');
    if (el && el.classList.contains('open')) closePronPractice();
  }
});

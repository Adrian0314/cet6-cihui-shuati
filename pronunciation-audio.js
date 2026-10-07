// A single selected microphone stream supplies both playback and recognition.
// Buffer PCM, not decoded MediaRecorder blobs: cloud failure must not waste the user's take.
_ppState.session = 0;
_ppState.transcribeCancel = null;

function ppAudioButtons(busy) {
  ['ppRecBtn', 'ppRecBtn2', 'ppCheckBtn', 'ppPlayBtn', 'ppSelfOk', 'ppSelfAgain'].forEach(function(id) {
    var b = document.getElementById(id);
    if (b) b.disabled = !!busy;
  });
}
function ppCancelBrowser() {
  var rec = _ppState.rec;
  _ppState.rec = null;
  if (rec) {
    rec.onresult = rec.onerror = rec.onend = null;
    try { rec.abort(); } catch (e) {}
  }
}
function ppCancelSession() {
  _ppState.session++;
  ppClearWatchdog();
  ppCancelBrowser();
  if (_ppState.transcribeCancel) _ppState.transcribeCancel();
  _ppState.transcribeCancel = null;
  if (_ppState.recorder) {
    _ppState.recorder.onstop = _ppState.recorder.ondataavailable = _ppState.recorder.onerror = null;
    try { if (_ppState.recorder.state !== 'inactive') _ppState.recorder.stop(); } catch (e) {}
  }
  _ppState.recorder = null;
  if (_ppState.recTimer) clearTimeout(_ppState.recTimer);
  _ppState.recTimer = null;
  _ppState.recording = _ppState.listening = _ppState.pending = false;
  ppReleaseMic();
  ppAudioButtons(false);
  var b = document.getElementById('ppRecBtn2');
  if (b) b.textContent = '⏺ 录音对比';
}
function ppListenIdle(label) {
  ppClearWatchdog();
  ppCancelBrowser();
  ppReleaseMic();
  _ppState.listening = _ppState.pending = false;
  ppAudioButtons(false);
  var b = document.getElementById('ppRecBtn');
  if (b) b.textContent = label || '🎤 开始跟读';
}
function closePronPractice() {
  var el = document.getElementById('pronPracticePanel');
  if (el) el.classList.remove('open');
  ppCancelSession();
}
function ppReleaseMic() {
  if (_ppState.pcmNode) {
    _ppState.pcmNode.onaudioprocess = null;
    try { _ppState.pcmNode.disconnect(); } catch (e) {}
  }
  try { if (_ppState.pcmSource) _ppState.pcmSource.disconnect(); } catch (e) {}
  try { if (_ppState.pcmGain) _ppState.pcmGain.disconnect(); } catch (e) {}
  _ppState.pcmNode = _ppState.pcmSource = _ppState.pcmGain = null;
  ppStopMeter();
  if (_ppState.checkTimer) clearInterval(_ppState.checkTimer);
  if (_ppState.recSampler) clearInterval(_ppState.recSampler);
  _ppState.checkTimer = _ppState.recSampler = null;
  _ppState.checking = false;
  _ppState.maxPeak = 0;
}
function ppStopListening(userInitiated) {
  if (!_ppState.recording) return;
  _ppState.stoppedByUser = !!userInitiated;
  ppEndCapture();
}
function ppListen() {
  if (_ppState.recording) { ppEndCapture(); return; }
  if (_ppState.pending) return;
  ppBeginCapture(true);
}
function ppToggleRecord() {
  if (_ppState.recording) { ppEndCapture(); return; }
  if (_ppState.pending) return;
  ppBeginCapture(false);
}
function ppEndCapture() {
  if (!_ppState.recording) return;
  _ppState.recording = _ppState.listening = false;
  _ppState.pending = true;
  ppAudioButtons(true);
  if (_ppState.recTimer) clearTimeout(_ppState.recTimer);
  _ppState.recTimer = null;
  ppSetStatus('录音已结束，正在识别这段朗读…');
  try { _ppState.recorder.stop(); } catch (e) {
    ppListenIdle('🎤 再读一次');
    ppSetStatus('结束录音失败：' + e.message + '。请重试。');
  }
}
function ppBeginCapture(follow) {
  var engine = ppEngineGet();
  if (engine === 'online' && !ppOnlineCanStart()) return;
  ppCancelSession();
  var token = _ppState.session;
  _ppState.pending = true;
  _ppState.gotResult = false;
  ppClearAssessment();
  ppAudioButtons(true);
  var result = document.getElementById('ppResult');
  if (result) { result.textContent = ''; result.className = 'pp-result'; }
  ppRecStatusSet('');
  ppSetStatus('正在打开所选麦克风…');
  // Online success never loads the offline model. Offline starts loading in parallel.
  var modelReady = engine === 'vosk' ? ppVoskEnsureModel(function(p) {
    if (token === _ppState.session) ppVoskState('离线模型：下载中 ' + Math.round(p * 100) + '%', 'busy');
  }) : null;
  if (modelReady) modelReady.catch(function() {});
  ppEnsureMic(token).then(function(mic) {
    if (token !== _ppState.session) return;
    if (!mic.ok || mic.skipped || !_ppState.stream) throw new Error(mic.message || '浏览器不支持麦克风采集。');
    if (!_ppState.ac) throw new Error('浏览器不支持 PCM 音频采集。');
    return _ppState.ac.resume();
  }).then(function() {
    if (token !== _ppState.session) return;
    var ac = _ppState.ac;
    var rate = ac.sampleRate, frames = [], chunks = [];
    var src = ac.createMediaStreamSource(_ppState.stream);
    var node = ac.createScriptProcessor(2048, 1, 1);
    var gain = ac.createGain();
    gain.gain.value = 0;
    _ppState.pcmSource = src; _ppState.pcmNode = node; _ppState.pcmGain = gain;
    node.onaudioprocess = function(ev) {
      if (token !== _ppState.session || !_ppState.recording) return;
      frames.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
    };
    src.connect(node); node.connect(gain); gain.connect(ac.destination);
    var recorder = new MediaRecorder(_ppState.stream);
    _ppState.recorder = recorder;
    recorder.ondataavailable = function(ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
    recorder.onerror = function(ev) {
      if (token !== _ppState.session) return;
      ppCancelSession();
      ppListenIdle('🎤 再读一次');
      ppSetStatus('录音失败：' + ((ev.error && ev.error.message) || '设备中断') + '。请重试。');
    };
    recorder.onstop = function() {
      if (token !== _ppState.session) return;
      _ppState.recording = _ppState.listening = false;
      _ppState.pending = true;
      if (_ppState.recTimer) clearTimeout(_ppState.recTimer);
      _ppState.recTimer = null;
      var total = frames.reduce(function(n, a) { return n + a.length; }, 0);
      var pcm = new Float32Array(total), offset = 0;
      frames.forEach(function(a) { pcm.set(a, offset); offset += a.length; });
      ppReleaseMic(); // Release hardware before decoding, but retain the samples.
      var b = document.getElementById('ppRecBtn2');
      if (b) b.textContent = '⏺ 录音对比';
      try {
        var blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (_ppState.playbackUrl) URL.revokeObjectURL(_ppState.playbackUrl);
        _ppState.playbackUrl = URL.createObjectURL(blob);
        var pb = document.getElementById('ppPlayMineBtn');
        if (pb) pb.style.display = '';
      } catch (e) { ppRecStatusSet('生成回放失败：' + e.message); }
      var st = ppVoiceStats(pcm, rate);
      ppRecStatusSet('录音已保存，可点「▶ 播放我的录音」回听。' + (st && st.peak > 0.004 ? '检测到音频输入。' : '输入电平较低，请检查麦克风。'));
      ppRecognizeTake(pcm, rate, token, engine, modelReady);
    };
    recorder.start();
    _ppState.pending = false;
    _ppState.recording = true;
    _ppState.listening = follow;
    ppAudioButtons(false);
    var b = document.getElementById('ppRecBtn');
    if (b) b.textContent = follow ? '⏹ 结束跟读' : '🎤 开始跟读';
    b = document.getElementById('ppRecBtn2');
    if (b) b.textContent = '⏹ 停止录音';
    ppSetStatus('正在录音…请朗读 ' + _ppState.word + '（读完点「' + (follow ? '结束跟读' : '停止录音') + '」，最长 ' + (follow ? 12 : 6) + ' 秒后自动识别）');
    _ppState.recTimer = setTimeout(ppEndCapture, follow ? 12000 : 6000);
  }).catch(function(err) {
    if (token !== _ppState.session) return;
    ppCancelSession();
    ppListenIdle('🎤 再读一次');
    ppSetStatus('无法开始录音：' + (err.message || '浏览器限制'));
  });
}
function ppRecognizeOfflineTake(pcm, rate, token, modelReady, prefix) {
  prefix = prefix || '';
  if (!pcm.length) {
    ppShowUnknown('没有采集到 PCM 数据；这不等于没有录到声音。请回听并保持页面在前台重试。', prefix);
    return Promise.resolve();
  }
  ppSetStatus(prefix + '正在用离线模型判断目标词…首次需下载约 39 MB 模型。');
  return (modelReady || ppVoskEnsureModel()).then(function(model) {
    if (token !== _ppState.session) return;
    return ppTranscribePCM(pcm, rate, token, model);
  }).then(function(text) {
    if (token !== _ppState.session) return;
    if (!text) {
      ppShowUnknown('录音已保存，但离线模型未识别出文字；这不等于没有录到声音。请回听后重试，也可自评。', prefix);
      return;
    }
    var heard = ppPickBestHeard(_ppState.word, text);
    ppFinish(ppOfflineVerdict(_ppState.word, heard), heard);
    ppSetStatus(prefix + '离线模型识别到：' + text + '（仅目标词匹配判断，无音素评分）' + (prefix ? '。本机降级处理，没有再次上传录音。' : '。本机识别，录音未上传。'));
  }).catch(function(err) {
    if (token !== _ppState.session) return;
    ppShowUnknown('录音已保存，但离线识别失败：' + (err.message || '模型加载失败') + '。可回放自评，或重试加载离线模型。', prefix);
  });
}
function ppRecognizeTake(pcm, rate, token, engine, modelReady) {
  ppAudioButtons(true);
  if (engine !== 'online') return ppRecognizeOfflineTake(pcm, rate, token, modelReady, '');
  if (!pcm.length) { ppShowUnknown('未采集到可上传的 PCM 数据，请保持页面在前台并重试。', '在线评估：'); return Promise.resolve(); }
  return ppAssessOnline(pcm, rate, token).catch(function(err) {
    if (token !== _ppState.session) return;
    ppClearAssessment();
    // Reuse the exact same PCM; never retry uploading or fabricate assessment scores.
    return ppRecognizeOfflineTake(pcm, rate, token, null, '在线评估失败：' + (err.message || '服务不可用') + '。本次仅提供离线读词判断。');
  });
}
function ppResamplePCM(pcm, fromRate) {
  if (fromRate === 16000) return pcm;
  var ratio = fromRate / 16000;
  var out = new Float32Array(Math.floor(pcm.length / ratio));
  for (var i = 0; i < out.length; i++) {
    var pos = i * ratio, n = Math.floor(pos), frac = pos - n;
    var a = isFinite(pcm[n]) ? pcm[n] : 0;
    var next = n + 1 < pcm.length ? pcm[n + 1] : a;
    var b = isFinite(next) ? next : 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}
function ppTranscribePCM(pcm, rate, token, model) {
  return (model ? Promise.resolve(model) : ppVoskEnsureModel()).then(function(model) {
    if (token !== _ppState.session) throw new Error('识别已取消');
    return new Promise(function(resolve, reject) {
      var rec = new model.KaldiRecognizer(16000);
      var audio = ppResamplePCM(pcm, rate);
      var block = 4096, expected = Math.ceil(audio.length / block), received = 0, texts = [], done = false;
      var timer = setTimeout(function() { finish(new Error('本机识别超时，请重试')); }, 30000);
      var cancel = function() { finish(new Error('识别已取消')); };
      _ppState.transcribeCancel = cancel;
      function finish(err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { rec.remove(); } catch (e) {}
        if (_ppState.transcribeCancel === cancel) _ppState.transcribeCancel = null;
        if (err) reject(err); else resolve(texts.join(' ').trim());
      }
      // Vosk emits exactly one result OR partialresult for each accepted block.
      // The extra result after all block responses is retrieveFinalResult's response.
      // Do not finish on the FIRST nonempty result: a take may contain multiple segments.
      function response(msg, partial) {
        if (done) return;
        if (!partial && msg.result && msg.result.text) texts.push(String(msg.result.text).trim());
        if (received < expected) { received++; return; }
        if (!partial) finish();
      }
      rec.on('result', function(msg) { response(msg, false); });
      rec.on('partialresult', function(msg) { response(msg, true); });
      rec.on('error', function(msg) { finish(new Error(msg.error || '离线识别器异常')); });
      try {
        rec.setWords(false);
        for (var i = 0; i < audio.length; i += block) rec.acceptWaveformFloat(audio.subarray(i, i + block), 16000);
        rec.retrieveFinalResult();
      } catch (e) { finish(e); }
    });
  });
}
function ppToggleMicCheck() {
  if (_ppState.checking) { ppCancelSession(); ppSetStatus('已停止检测。'); return; }
  if (_ppState.pending || _ppState.recording) return;
  ppCancelSession();
  var token = _ppState.session;
  _ppState.pending = true;
  ppSetStatus('正在打开麦克风…');
  ppEnsureMic(token).then(function(mic) {
    if (token !== _ppState.session) return;
    _ppState.pending = false;
    if (!mic.ok) { ppSetStatus(mic.message); return; }
    if (_ppState.ac) _ppState.ac.resume().catch(function() {});
    _ppState.checking = true;
    var t0 = Date.now();
    ppSetStatus('请对着麦克风说几秒钟…（检测 6 秒）');
    _ppState.checkTimer = setInterval(function() {
      if (token !== _ppState.session) return;
      var best = Math.max(_ppState.maxPeak || 0, _ppState.peak || 0);
      if (Date.now() - t0 >= 6000) {
        ppReleaseMic();
        ppSetStatus(best >= 0.02 ? '✅ 麦克风有声音输入；点「开始跟读」或「录音对比」即可在本机识别。' : '❌ ' + ppSilenceHint());
      }
    }, 250);
  });
}

// createModel() only waits for 'load' in vosk-browser 0.0.8. Handle worker errors
// and a bounded timeout explicitly, so a bad archive cannot lock the UI forever.
function ppVoskCreateModel(url) {
  return new Promise(function(resolve, reject) {
    var model = null, settled = false;
    var timer = setTimeout(function() { finish(new Error('模型加载超时，请检查网络后重试')); }, 90000);
    function finish(err, loaded) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (String(url).indexOf('blob:') === 0) URL.revokeObjectURL(url);
      if (err) {
        try { if (model) model.terminate(); } catch (e) {}
        reject(err);
      } else resolve(loaded || model);
    }
    try {
      if (window.Vosk.Model) {
        model = new window.Vosk.Model(url, -1);
        model.on('load', function(msg) { finish(msg.result ? null : new Error('模型无法解析')); });
        model.on('error', function(msg) { finish(new Error(msg.error || '模型加载失败')); });
      } else {
        window.Vosk.createModel(url).then(function(m) { finish(null, m); }, function(e) { finish(e || new Error('模型加载失败')); });
      }
    } catch (e) { finish(e); }
  });
}

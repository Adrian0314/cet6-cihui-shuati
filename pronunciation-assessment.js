// Online assessment uses a protected backend; offline recognition never uploads audio.
var PP_ENGINE_KEY = 'cet6_pron_mode_v3';
var PP_ONLINE_ENDPOINT_KEY = 'cet6_pron_assessment_endpoint_tencent_v2';
var _ppOnlineToken = '', _ppOnlineConsent = false;
function ppEngineGet() {
  try { return localStorage.getItem(PP_ENGINE_KEY) === 'online' ? 'online' : 'vosk'; } catch (e) { return 'vosk'; }
}
function ppClearAssessment() {
  var el = document.getElementById('ppAssessment');
  if (el) { el.innerHTML = ''; el.hidden = true; }
}
function ppEngineSet(eng) {
  var next = eng === 'online' ? 'online' : 'vosk';
  if (next !== _ppState.engine) {
    ppCancelSession(); ppListenIdle(); ppClearAssessment();
    var result = document.getElementById('ppResult'); if (result) result.textContent = '';
  }
  _ppState.engine = next;
  try { localStorage.setItem(PP_ENGINE_KEY, next); } catch (e) {}
  ['ppEngOnline', 'ppEngVosk'].forEach(function(id) {
    var b = document.getElementById(id), on = id === (next === 'online' ? 'ppEngOnline' : 'ppEngVosk');
    if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  });
  var model = document.getElementById('ppModelRow'), online = document.getElementById('ppOnlineRow');
  if (model) model.style.display = next === 'vosk' ? 'flex' : 'none';
  if (online) online.hidden = next !== 'online';
  var tip = document.getElementById('ppModeHint');
  if (tip) tip.textContent = next === 'online' ? '国内在线：录音发送至后端及腾讯云，返回单词与音素评分。失败时仅降级为离线读词判断。' : '离线：只判断目标词是否匹配，不评价音素或重音。首次下载约 39 MB 模型，之后可断网使用，录音不上传。';
  var rec = document.getElementById('ppRecBtn2');
  if (rec) rec.title = next === 'online' ? '录音后按在线模式评估；会上传这段录音' : '录音后在本机判断目标词是否匹配，不上传音频';
  if (next === 'vosk') {
    if (PP_VOSK.model) ppVoskState('离线模型：已就绪（可断网使用）', 'ok');
    else if (PP_VOSK.modelPromise) ppVoskState('离线模型：加载中…', 'busy');
    else ppVoskState('离线模型：首次使用时自动下载');
  }
  ppOnlineRefresh();
}
function ppOnlineEndpoint() {
  try { var saved = localStorage.getItem(PP_ONLINE_ENDPOINT_KEY); if (saved) return saved; } catch (e) {}
  return String((window.CET6_PRONUNCIATION_CONFIG || {}).endpoint || '');
}
function ppValidateEndpoint(value) {
  var url;
  try { url = new URL(String(value || '').trim()); } catch (e) { throw new Error('请填写完整的评估后端地址（以 https:// 开头）。'); }
  var local = ['localhost', '127.0.0.1'].indexOf(location.hostname) >= 0 && ['localhost', '127.0.0.1'].indexOf(url.hostname) >= 0;
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('评估后端必须使用 HTTPS。');
  if (url.username || url.password || url.search || url.hash || url.href.length > 1024) throw new Error('后端地址不能包含密码、查询参数或片段。');
  return url.href;
}
function ppSaveOnlineSettings(endpoint, token) {
  var valid = ppValidateEndpoint(endpoint), secret = String(token || '').trim();
  if (secret.length < 32 || secret.length > 768 || /\s/.test(secret)) throw new Error('请填写至少 32 位的后端访问口令（不是腾讯云 SecretKey）。');
  ppCancelSession(); ppListenIdle(); ppClearAssessment();
  try { localStorage.setItem(PP_ONLINE_ENDPOINT_KEY, valid); } catch (e) { throw new Error('浏览器不允许保存后端地址，请检查站点存储权限。'); }
  _ppOnlineToken = secret; _ppOnlineConsent = false;
  ppOnlineRefresh();
}
function ppOnlineSettingsHTML() {
  return '<section id="ppOnlineRow" hidden>' +
    '<div class="pp-online-state" id="ppOnlineState" role="status"></div>' +
    '<details class="pp-online-settings" id="ppOnlineSettings"><summary>连接评估后端</summary>' +
    '<label>评估接口地址<input id="ppOnlineEndpoint" type="url" inputmode="url" autocomplete="off" placeholder="https://你的后端域名/assess" maxlength="1024"></label>' +
    '<label>后端访问口令<input id="ppOnlineToken" type="password" autocomplete="off" placeholder="不是腾讯云 SecretKey" maxlength="768"></label>' +
    '<p>使用腾讯云英文口语评测，不需要 Azure。<a href="https://github.com/Adrian0314/cet6-cihui-shuati/blob/master/发音评估双模式部署说明-20261007.md" target="_blank" rel="noopener noreferrer">配置说明</a> · <a href="./backend/tencent-scf.zip" download>下载云函数部署包</a></p><p>地址会保存；口令只留在当前页面内存，刷新后需重填。录音和口令会发往你配置的地址，请只连接可信后端。</p>' +
    '<button class="pp-btn" id="ppOnlineSave">保存连接设置</button></details>' +
    '<label class="pp-consent"><input type="checkbox" id="ppOnlineConsent">我同意将本次练习录音发送至所配置后端及腾讯云智聆口语评测，用于英文发音评估。</label>' +
    '<div class="pp-tip">评估服务：腾讯云智聆口语评测（英文）。口音差异可能影响分数；音素符号按服务原样显示，不冒充 IPA。</div></section>';
}
function ppOnlineRefresh() {
  var endpoint = ppOnlineEndpoint(), state = document.getElementById('ppOnlineState'), input = document.getElementById('ppOnlineEndpoint'), token = document.getElementById('ppOnlineToken'), details = document.getElementById('ppOnlineSettings'), consent = document.getElementById('ppOnlineConsent');
  if (input) input.value = endpoint;
  if (token) token.value = _ppOnlineToken;
  if (consent) consent.checked = _ppOnlineConsent;
  if (details && (!endpoint || !_ppOnlineToken)) details.open = true;
  if (state) state.textContent = !endpoint ? '尚未配置在线评估后端，离线判断仍可使用。' : !_ppOnlineToken ? '后端地址已设置；请填写本次访问口令。' : '连接设置已填写（尚未验证服务可用性）。';
}
function ppBindOnlineSettings() {
  document.getElementById('ppOnlineSave').addEventListener('click', function() {
    try {
      ppSaveOnlineSettings(document.getElementById('ppOnlineEndpoint').value, document.getElementById('ppOnlineToken').value);
      document.getElementById('ppOnlineSettings').open = false;
      ppSetStatus('连接设置已保存；勾选上传同意后，再开始跟读。');
    } catch (e) { ppSetStatus(e.message); }
  });
  document.getElementById('ppOnlineConsent').addEventListener('change', function() {
    _ppOnlineConsent = this.checked;
    if (!this.checked && _ppState.engine === 'online' && (_ppState.pending || _ppState.recording)) {
      ppCancelSession(); ppListenIdle();
      ppSetStatus('已停止本轮在线评估；已经发送给服务的录音无法撤回。');
    }
  });
}
function ppOnlineCanStart() {
  if (!ppOnlineEndpoint() || !_ppOnlineToken) { ppSetStatus('请先配置在线评估后端地址和访问口令，或切换到离线读词判断。'); return false; }
  try { ppValidateEndpoint(ppOnlineEndpoint()); } catch (e) { ppSetStatus(e.message); return false; }
  if (!_ppOnlineConsent) { ppSetStatus('请先勾选同意上传录音；不希望上传可选择离线读词判断。'); return false; }
  return true;
}
function ppPCMToWav(pcm, rate) {
  var audio = ppResamplePCM(pcm, rate), bytes = new ArrayBuffer(44 + audio.length * 2), view = new DataView(bytes);
  function text(offset, value) { for (var i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); }
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, audio.length * 2, true);
  for (var i = 0; i < audio.length; i++) { var x = Math.max(-1, Math.min(1, audio[i] || 0)); view.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true); }
  return bytes;
}
function ppValidScore(value) { return typeof value === 'number' && isFinite(value) && value >= 0 && value <= 100; }
function ppValidateReport(data, reference) {
  if (!data || data.version !== 1 || data.provider !== 'tencent' || pronNormalize(data.reference) !== pronNormalize(reference) || !Array.isArray(data.words)) throw new Error('评估响应格式或目标词不匹配。');
  if (data.status === 'no-speech') return data;
  if (['success', 'mismatch'].indexOf(data.status) < 0 || !data.scores || (data.status === 'success' ? !ppValidScore(data.scores.accuracy) : data.scores.accuracy !== null) || data.words.length > 32) throw new Error('服务未返回有效的发音准确度。');
  ['pronunciation', 'fluency', 'completeness', 'prosody'].forEach(function(key) { if (data.scores[key] != null && !ppValidScore(data.scores[key])) throw new Error('服务返回了无效分数。'); });
  data.words.forEach(function(w) {
    if (!w || typeof w.word !== 'string' || w.word.length > 100 || ['None', 'Insertion', 'Omission', 'Mispronunciation', 'NotRecorded', 'NotProvided'].indexOf(w.errorType) < 0 || (w.accuracy != null && !ppValidScore(w.accuracy)) || !Array.isArray(w.phonemes) || w.phonemes.length > 100 || !Array.isArray(w.syllables) || w.syllables.length > 40) throw new Error('词级评估数据格式无效。');
    w.phonemes.forEach(function(p) { if (!p || typeof p.phoneme !== 'string' || p.phoneme.length > 40 || ['stressExpected', 'stressDetected'].some(function(k) { return p[k] != null && typeof p[k] !== 'boolean'; })) throw new Error('音素评估数据格式无效。'); });
    w.phonemes.concat(w.syllables).forEach(function(p) { if (!p || (p.accuracy != null && !ppValidScore(p.accuracy))) throw new Error('音素评估分数无效。'); });
  });
  return data;
}
function ppAssessOnline(pcm, rate, token) {
  var reference = _ppState.word, url = new URL(ppValidateEndpoint(ppOnlineEndpoint()));
  url.searchParams.set('reference', reference);
  var controller = new AbortController(); _ppState.assessmentAbort = controller;
  var configured = Number((window.CET6_PRONUNCIATION_CONFIG || {}).requestTimeoutMs) || 25000;
  var timer = setTimeout(function() { controller.abort(); }, Math.max(5000, Math.min(configured, 45000)));
  ppSetStatus('正在上传这段录音并请求在线发音评估…');
  return fetch(url.href, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'Authorization': 'Bearer ' + _ppOnlineToken }, body: ppPCMToWav(pcm, rate), signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' }).then(function(response) {
    return response.json().catch(function() { throw new Error('评估后端没有返回 JSON。'); }).then(function(data) {
      if (!response.ok) throw new Error(data && typeof data.error === 'string' ? data.error.slice(0, 200) : '评估后端返回 HTTP ' + response.status);
      return ppValidateReport(data, reference);
    });
  }).then(function(data) {
    if (token === _ppState.session) ppShowAssessment(data);
    return data;
  }).catch(function(err) { if (controller.signal.aborted) throw new Error('在线评估已取消或超时。'); throw err; }).finally(function() {
    clearTimeout(timer); if (_ppState.assessmentAbort === controller) _ppState.assessmentAbort = null;
  });
}
function ppShowUnknown(message, source) {
  ppClearAssessment();
  var res = document.getElementById('ppResult'); if (res) { res.className = 'pp-result near'; res.textContent = '❔ 无法判断（未计入读对或读错）'; }
  _ppState.gotResult = true; ppListenIdle('🎤 再读一次');
  ppSetStatus((source ? source + ' ' : '') + message);
}
function ppOfflineVerdict(target, heard) {
  var matched = pronNormalize(target) === pronNormalize(heard);
  return { level: matched ? 'ok' : 'bad', text: matched ? '目标词匹配成功（离线判断）' : '未匹配目标词，识别为：' + heard, dist: matched ? 0 : 99 };
}
function ppScoreText(value) { return ppValidScore(value) ? String(Math.round(value * 10) / 10) : '未提供'; }
function ppScoreTone(value) { return !ppValidScore(value) ? 'unknown' : value >= 80 ? 'good' : value >= 60 ? 'fair' : 'low'; }
function ppShowAssessment(data) {
  if (data.status === 'no-speech') { ppShowUnknown('在线服务没有识别到可评估的语音，请回听录音并重试。', '在线评估：'); return; }
  var words = data.words, spoken = words.filter(function(w) { return w.errorType !== 'Insertion'; });
  var enough = spoken.length > 0 && pronNormalize(spoken.map(function(w) { return w.word; }).join(' ')) === pronNormalize(_ppState.word) && spoken.every(function(w) { return ppValidScore(w.accuracy) && w.errorType !== 'NotProvided'; });
  var passed = data.status === 'success' && enough && !words.some(function(w) { return w.errorType === 'Insertion'; }) && data.scores.accuracy >= 80 && spoken.every(function(w) { return w.accuracy >= 80 && w.errorType === 'None'; });
  if (data.status === 'mismatch') { _ppState.gotResult = true; ppListenIdle('🎤 再读一次'); var mismatchResult = document.getElementById('ppResult'); if (mismatchResult) { mismatchResult.className = 'pp-result near'; mismatchResult.textContent = '腾讯云判定本次发音未匹配目标词，请回听后重试（未生成有效准确度）'; } }
  else if (enough) ppFinish({ level: passed ? 'ok' : 'near', text: passed ? '本次达到练习阈值（准确度 ≥ 80）' : '建议继续练习，查看下方音素表现', dist: 0 }, data.transcript);
  else { _ppState.gotResult = true; ppListenIdle('🎤 再读一次'); var res = document.getElementById('ppResult'); if (res) { res.className = 'pp-result near'; res.textContent = '词级证据不足，分数仅供参考，未计入读对或读错'; } }
  var esc = _ppEsc;
  var metrics = [['发音准确度', data.scores.accuracy, 'accuracy'], ['综合分', data.scores.pronunciation, 'pronunciation'], ['流利度', data.scores.fluency, 'fluency'], ['完整度', data.scores.completeness, 'completeness'], ['韵律', data.scores.prosody, 'prosody']];
  var html = '<header class="pp-report-head"><strong>在线发音报告</strong><span>腾讯云智聆 · 英文 · 百分制</span></header><div class="pp-score-grid">';
  metrics.forEach(function(m) { html += '<div class="pp-score ' + (m[2] === 'accuracy' ? 'primary ' : '') + ppScoreTone(m[1]) + '"><span>' + m[0] + '</span><strong>' + ppScoreText(m[1]) + '</strong></div>'; });
  html += '</div><p class="pp-report-note">单词练习优先看准确度和音素表现。单词模式不展示无意义的流利度、完整度；腾讯云未提供的韵律/音节不编造。80 分是本应用练习阈值，不是考试或人工判定标准。</p>';
  var names = { None: '未标记错误', Mispronunciation: '误读', Omission: '漏读', Insertion: '多读', UnexpectedBreak: '不必要停顿', MissingBreak: '缺少停顿', Monotone: '语调平直', NotRecorded: '未检测到该词', NotProvided: '未提供错误类型' };
  var weak = [];
  words.forEach(function(w) {
    html += '<section class="pp-word-report"><div class="pp-word-report-title"><strong>' + esc(w.word) + '</strong><span>' + ppScoreText(w.accuracy) + ' · ' + esc(names[w.errorType] || '未提供错误类型') + '</span></div>';
    if (w.phonemes.length) {
      html += '<div class="pp-phonemes" aria-label="服务返回的音素分数">';
      w.phonemes.forEach(function(p) {
        if (ppValidScore(p.accuracy) && p.accuracy < 80) weak.push(String(p.phoneme || ''));
        var stress = typeof p.stressExpected === 'boolean' && typeof p.stressDetected === 'boolean' ? '<small>重音预期：' + (p.stressExpected ? '有' : '无') + '<br>重音检测：' + (p.stressDetected ? '有' : '无') + '</small>' : '';
        html += '<div class="pp-phoneme ' + ppScoreTone(p.accuracy) + '"><strong>' + esc(p.phoneme || '—') + '</strong><span>' + ppScoreText(p.accuracy) + '</span>' + stress + '<i aria-hidden="true" style="width:' + (ppValidScore(p.accuracy) ? p.accuracy : 0) + '%"></i></div>';
      }); html += '</div>';
    } else html += '<p class="pp-report-note">服务未提供该词的音素明细。</p>';
    if (w.syllables.length) html += '<p class="pp-report-note">音节：' + w.syllables.map(function(s) { return esc(s.syllable || '—') + ' ' + ppScoreText(s.accuracy); }).join(' · ') + '</p>';
    html += '</section>';
  });
  if (!words.length) html += '<p class="pp-report-note">服务未提供词级明细。</p>';
  html += '<p class="pp-practice-advice">' + (weak.length ? '建议优先对照标准发音练习这些低分音素：' + esc(weak.filter(function(p, i, arr) { return arr.indexOf(p) === i; }).join('、')) : '可回听录音，与标准发音对照。') + '</p><p class="pp-report-note">音素符号按服务原样展示，不冒充 IPA；未返回的指标标注为“未提供”。分数受录音质量和口音影响，不是口型或发音问题的人工诊断。</p>';
  var report = document.getElementById('ppAssessment'); if (report) { report.innerHTML = html; report.hidden = false; }
  ppSetStatus('腾讯云在线评估完成' + (data.status === 'mismatch' ? '，本次发音未匹配目标词' : '') + '；本次录音已发送给评估后端及腾讯云。该服务按目标词评测，不将目标文本冒充语音转写。');
}

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
let server, browser, base;
before(async () => {
  server = createServer(async (req, res) => {
    try {
      const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      if (!path.startsWith(root + '\\') && !path.startsWith(root + '/')) throw Error('outside root');
      const body = await readFile(path);
      res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.gz': 'application/gzip' })[extname(path)] || 'application/octet-stream');
      res.setHeader('Content-Length', body.length);
      res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
});
after(async () => { await browser?.close(); await new Promise(r => server?.close(r)); });

async function panel(legacyMode) {
  const page = await browser.newPage();
  await page.goto(base + '/cet6_quiz.html');
  await page.evaluate(legacyMode => {
    speechSynthesis.cancel();
    window.speakWord = () => {};
    if (legacyMode) localStorage.setItem('cet6_pron_mode_v3', legacyMode);
    window.fakeFeeds = 0;
    window.Vosk = { createModel: async () => ({ KaldiRecognizer: class {
      constructor() { this.handlers = {}; this.feeds = 0; }
      setWords() {}
      on(name, cb) { this.handlers[name] = cb; }
      acceptWaveformFloat(samples, rate) {
        if (rate !== 16000 || !samples.length) throw Error('invalid PCM');
        this.feeds++; window.fakeFeeds++; setTimeout(() => this.handlers.partialresult?.({ result: { partial: '' } }), 0);
      }
      retrieveFinalResult() {
        setTimeout(() => this.handlers.result?.({ result: { text: this.feeds ? (typeof window.fakeText === 'string' ? window.fakeText : 'prestige') : '' } }), window.fakeDelay || 100);
      }
      remove() { window.fakeRemoved = (window.fakeRemoved || 0) + 1; }
    } }) };
    window.ppVoskResolveModel = async () => 'test-model';
    openPronPractice('prestige', '/preˈstiːʒ/');
  }, legacyMode);
  return page;
}
async function waitFor(page, fn, timeout = 6000) { await page.waitForFunction(fn, null, { timeout }); }

// Regression for the reported mismatch: playback worked but no audio reached ASR.
test('new users have one practice flow without service controls', async () => {
  const page = await panel();
  try {
    assert.equal(await page.locator('#ppEngOnline, #ppEngVosk, #ppOnlineSettings, #ppAssessment').count(), 0);
    assert.doesNotMatch(await page.locator('#pronPracticePanel').innerText(), /离线|在线评估|线上评估/);
    assert.equal(await page.locator('#ppRecBtn').isEnabled(), true);
  } finally { await page.close(); }
});

test('legacy online preference and endpoint cannot trigger requests or prevent recognition', async () => {
  const page = await panel('online');
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  try {
    await page.evaluate(() => {
      localStorage.setItem('cet6_pron_assessment_endpoint_tencent_v2', 'https://retired-assessment.invalid');
      openPronPractice('prestige', '');
    });
    await page.click('#ppRecBtn');
    await waitFor(page, () => _ppState.listening);
    await page.waitForTimeout(450);
    await page.click('#ppRecBtn');
    await waitFor(page, () => _ppState.gotResult);
    assert.match(await page.locator('#ppResult').innerText(), /匹配成功/);
    assert.ok(await page.evaluate(() => fakeFeeds > 0));
    assert.equal(requests.some(request => request.method === 'POST' || /assessment|retired-assessment/.test(request.url)), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('practice controls fit a narrow screen in light and dark themes', async () => {
  const page = await panel();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      const bounds = await page.locator('.pp-panel').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
      assert.equal(await page.locator('.pp-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      for (const id of ['ppRecBtn', 'ppRecBtn2', 'ppModelLoadBtn', 'ppModelFileBtn', 'ppSelfOk']) {
        assert.equal(await page.locator('#' + id).isVisible(), true);
        const button = await page.locator('#' + id).boundingBox();
        assert.ok(button.x >= 0 && button.x + button.width <= 390, `${theme}: ${id}`);
      }
    }
  } finally { await page.close(); }
});
test('recording comparison transcribes the same captured audio while keeping playback', async () => {
  const page = await panel('vosk');
  try {
    await page.click('#ppRecBtn2');
    await waitFor(page, () => _ppState.recording);
    await page.waitForTimeout(700);
    await page.click('#ppRecBtn2');
    await waitFor(page, () => document.querySelector('#ppStatus').textContent.includes('prestige'));
    assert.ok(await page.evaluate(() => fakeFeeds > 0));
    assert.equal(await page.locator('#ppPlayMineBtn').isVisible(), true);
    assert.match(await page.locator('#ppResult').innerText(), /匹配成功/);
    await page.evaluate(() => {
      const NativeAudio = window.Audio;
      window.Audio = function(...args) { window.lastPlayback = new NativeAudio(...args); return window.lastPlayback; };
    });
    await page.click('#ppPlayMineBtn');
    await waitFor(page, () => window.lastPlayback && !window.lastPlayback.paused && window.lastPlayback.currentTime > 0);
    assert.equal(await page.evaluate(() => lastPlayback.error), null);
    assert.match(await page.evaluate(() => lastPlayback.src), /^blob:/);
  } finally { await page.close(); }
});

test('real deployed Vosk model transcribes all segments of the official speech fixture', { timeout: 90000 }, async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '/cet6_quiz.html');
    const transcript = await page.evaluate(async () => {
      window.speakWord = () => {};
      openPronPractice('prestige', '');
      const bytes = await (await fetch('regression/fixtures/vosk-digits.wav')).arrayBuffer();
      const ac = new AudioContext();
      const decoded = await ac.decodeAudioData(bytes);
      const pcm = decoded.getChannelData(0);
      const text = await ppTranscribePCM(pcm, decoded.sampleRate, _ppState.session);
      await ac.close();
      return text;
    });
    assert.match(transcript, /one zero zero zero one/);
    assert.match(transcript, /zero one eight zero three/);
    const silence = await page.evaluate(() => ppTranscribePCM(new Float32Array(16000), 16000, _ppState.session));
    assert.equal(silence, '');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});


test('wrong and empty transcripts never become a false success', async () => {
  for (const text of ['banana', '']) {
    const page = await panel('vosk');
    try {
      await page.evaluate(text => { window.fakeText = text; }, text);
      await page.click('#ppRecBtn');
      await waitFor(page, () => _ppState.listening);
      await page.waitForTimeout(450);
      await page.click('#ppRecBtn');
      await waitFor(page, () => !_ppState.pending);
      assert.doesNotMatch(await page.locator('#ppResult').innerText(), /匹配成功/);
      assert.equal(await page.evaluate(() => pronStatsGet('prestige').oks), 0);
      if (!text) assert.match(await page.locator('#ppStatus').innerText(), /不等于没有录到声音/);
    } finally { await page.close(); }
  }
});
test('closing during inference isolates the next word and frees the recognizer', async () => {
  const page = await panel('vosk');
  try {
    await page.evaluate(() => { window.fakeDelay = 1200; });
    await page.click('#ppRecBtn2');
    await waitFor(page, () => _ppState.recording);
    await page.waitForTimeout(450);
    await page.click('#ppRecBtn2');
    await waitFor(page, () => !!_ppState.transcribeCancel);
    await page.click('#ppCloseBtn');
    await page.evaluate(() => openPronPractice('ambition', ''));
    await page.waitForTimeout(1400);
    assert.equal(await page.locator('#ppResult').innerText(), '');
    assert.equal(await page.evaluate(() => pronStatsGet('ambition').tries), 0);
    assert.equal(await page.evaluate(() => pronStatsGet('prestige').tries), 0);
    assert.ok(await page.evaluate(() => fakeRemoved > 0));
    assert.equal(await page.evaluate(() => _ppState.stream), null);
  } finally { await page.close(); }
});
test('late microphone permission after closing cannot leak a stream', async () => {
  const page = await panel('vosk');
  try {
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        await new Promise(r => setTimeout(r, 600));
        window.lateStream = await original(constraints);
        return window.lateStream;
      };
    });
    await page.click('#ppRecBtn');
    await page.click('#ppCloseBtn');
    await waitFor(page, () => window.lateStream && window.lateStream.getTracks().every(t => t.readyState === 'ended'));
    assert.equal(await page.evaluate(() => _ppState.stream), null);
    assert.equal(await page.evaluate(() => _ppState.pending), false);
  } finally { await page.close(); }
});
test('microphone denial is surfaced without counting a successful attempt', async () => {
  const page = await panel('vosk');
  try {
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    await page.click('#ppRecBtn');
    await waitFor(page, () => document.querySelector('#ppStatus').textContent.includes('权限被拒绝'));
    assert.equal(await page.locator('#ppRecBtn').isEnabled(), true);
    assert.equal(await page.evaluate(() => pronStatsGet('prestige').tries), 0);
  } finally { await page.close(); }
});
test('lack of Web Speech support does not disable local recognition', async () => {
  const page = await panel('vosk');
  try {
    await page.evaluate(() => {
      window.SpeechRecognition = window.webkitSpeechRecognition = undefined;
      openPronPractice('prestige', '');
    });
    assert.equal(await page.locator('#ppRecBtn').isEnabled(), true);
    await page.click('#ppRecBtn');
    await waitFor(page, () => _ppState.listening);
    await page.waitForTimeout(450);
    await page.click('#ppRecBtn');
    await waitFor(page, () => _ppState.gotResult);
    assert.match(await page.locator('#ppResult').innerText(), /匹配成功/);
  } finally { await page.close(); }
});
test('model failure preserves playback and presents an actionable error', async () => {
  const page = await panel('vosk');
  try {
    await page.evaluate(() => {
      window.ppVoskEnsureModel = () => Promise.reject(new Error('model unavailable'));
    });
    await page.click('#ppRecBtn2');
    await waitFor(page, () => _ppState.recording);
    await page.waitForTimeout(450);
    await page.click('#ppRecBtn2');
    await waitFor(page, () => document.querySelector('#ppStatus').textContent.includes('model unavailable'));
    assert.equal(await page.locator('#ppPlayMineBtn').isVisible(), true);
    assert.equal(await page.locator('#ppRecBtn2').isEnabled(), true);
    assert.equal(await page.evaluate(() => pronStatsGet('prestige').tries), 0);
  } finally { await page.close(); }
});


test('real microphone capture recognizes prestige, keeps playback, and reloads the cached model when requests are unavailable', { timeout: 120000 }, async () => {
  const inputBrowser = await chromium.launch({ args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${resolve(root, 'regression/fixtures/prestige.wav')}`,
    '--autoplay-policy=no-user-gesture-required'
  ] });
  const page = await inputBrowser.newPage();
  try {
    await page.goto(base + '/cet6_quiz.html');
    await page.evaluate(() => { window.speakWord = () => {}; openPronPractice('prestige', ''); });
    await page.click('#ppRecBtn');
    await waitFor(page, () => _ppState.listening);
    await page.waitForTimeout(2200);
    await page.click('#ppRecBtn');
    await waitFor(page, () => _ppState.gotResult, 60000);
    assert.match(await page.locator('#ppStatus').innerText(), /prestige/);
    assert.match(await page.locator('#ppResult').innerText(), /匹配成功/);
    assert.equal(await page.locator('#ppPlayMineBtn').isVisible(), true);
    assert.equal(await page.evaluate(() => _ppState.stream), null);
    await page.evaluate(() => { PP_VOSK.model.terminate(); PP_VOSK.model = PP_VOSK.modelPromise = null; });
    await page.context().setOffline(true);
    await page.click('#ppRecBtn2');
    await waitFor(page, () => _ppState.recording);
    await page.waitForTimeout(2200);
    await page.click('#ppRecBtn2');
    await waitFor(page, () => _ppState.gotResult, 60000);
    assert.match(await page.locator('#ppStatus').innerText(), /prestige/);
    assert.equal(await page.evaluate(() => PP_VOSK.modelSrc), 'cache');
    assert.equal(await page.evaluate(() => pronStatsGet('prestige').oks), 2);
  } finally { await inputBrowser.close(); }
});


test('self-assessment stops recording and cannot be replaced by a later capture result', async () => {
  const page = await panel();
  try {
    await page.click('#ppRecBtn');
    await waitFor(page, () => _ppState.listening);
    await page.waitForTimeout(450);
    await page.click('#ppSelfOk');
    await page.waitForTimeout(500);
    assert.match(await page.locator('#ppResult').innerText(), /自评/);
    assert.equal(await page.evaluate(() => pronStatsGet('prestige').tries), 1);
    assert.equal(await page.evaluate(() => pronStatsGet('prestige').oks), 1);
    assert.equal(await page.evaluate(() => _ppState.stream), null);
    assert.equal(await page.evaluate(() => _ppState.recording || _ppState.pending), false);
    assert.equal(await page.evaluate(() => fakeFeeds), 0);
  } finally { await page.close(); }
});

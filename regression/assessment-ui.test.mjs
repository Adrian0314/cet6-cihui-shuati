import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from '@playwright/test';
const root = resolve(import.meta.dirname, '..');
let server, browser, base;
before(async () => {
  server = createServer(async (req, res) => {
    try {
      const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
      if (!path.startsWith(root + sep)) throw Error('outside root');
      const body = await readFile(path);
      res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.gz': 'application/gzip' })[extname(path)] || 'application/octet-stream');
      res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
});
after(async () => { await browser?.close(); await new Promise(r => server?.close(r)); });
// Contract-only mock. No live Tencent account is used by these browser tests.
const report = { version: 1, provider: 'tencent', status: 'success', reference: 'prestige', transcript: '', transcriptKind: 'not-provided', scores: { accuracy: 86, pronunciation: 84, fluency: null, completeness: null, prosody: null }, phonemeAlphabet: 'service', words: [{ word: 'prestige', accuracy: 86, errorType: 'None', phonemes: [{ phoneme: 'p', accuracy: 94, stressExpected: false, stressDetected: false }, { phoneme: 'r', accuracy: 55, stressExpected: true, stressDetected: false }], syllables: [] }] };
async function panel(online = false) {
  const page = await browser.newPage();
  await page.goto(base + '/cet6_quiz.html');
  await page.evaluate(online => {
    window.speakWord = () => {}; speechSynthesis.cancel();
    window.fakeFeeds = 0; window.Vosk = { createModel: async () => ({ KaldiRecognizer: class {
      constructor() { this.handlers = {}; } on(name, cb) { this.handlers[name] = cb; } setWords() {}
      acceptWaveformFloat() { window.fakeFeeds++; setTimeout(() => this.handlers.partialresult?.({ result: { partial: '' } }), 0); }
      retrieveFinalResult() { setTimeout(() => this.handlers.result?.({ result: { text: window.fakeText ?? 'prestige' } }), 50); } remove() {}
    } }) }; window.ppVoskResolveModel = async () => 'test-model';
    if (online) { ppSaveOnlineSettings('https://assessment.test/assess', 'private-test-access-token-at-least-32'); localStorage.setItem(PP_ENGINE_KEY, 'online'); }
    openPronPractice('prestige', '');
  }, online);
  return page;
}
async function take(page, button = '#ppRecBtn') {
  await page.click(button); await page.waitForFunction(() => _ppState.recording); await page.waitForTimeout(450); await page.click(button);
}
async function consent(page) { await page.check('#ppOnlineConsent'); }
test('offline result says target matched, never pretends it assessed phonemes', async () => {
  const page = await panel();
  try {
    await take(page); await page.waitForFunction(() => _ppState.gotResult);
    assert.match(await page.locator('#ppResult').innerText(), /目标词匹配/);
    assert.ok(!(await page.locator('#ppResult').innerText()).includes('发音正确'));
    assert.equal(await page.locator('#ppAssessment').isVisible(), false);
  } finally { await page.close(); }
});
test('online setup and upload consent are required before opening the microphone', async () => {
  const page = await panel();
  try {
    await page.click('#ppEngOnline'); await page.click('#ppRecBtn');
    assert.equal(await page.evaluate(() => _ppState.stream), null); assert.match(await page.locator('#ppStatus').innerText(), /配置/);
    await page.evaluate(() => { ppSaveOnlineSettings('https://assessment.test/assess', 'private-test-access-token-at-least-32'); ppEngineSet('online'); });
    await page.click('#ppRecBtn'); assert.match(await page.locator('#ppStatus').innerText(), /同意/);
    assert.equal(await page.evaluate(() => _ppState.stream), null);
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('private-test-access-token-at-least-32')), false);
    assert.equal(await page.evaluate(() => JSON.stringify(sessionStorage).includes('private-test-access-token-at-least-32')), false);
    assert.equal(await page.evaluate(() => { try { ppSaveOnlineSettings('http://evil.test/assess', 'token'); return true; } catch { return false; } }), false);
  } finally { await page.close(); }
});
test('online assessment sends real 16k PCM WAV and shows authentic scores with unavailable fields', async () => {
  const page = await panel(true); let calls = 0;
  try {
    await page.route('https://assessment.test/**', async route => {
      calls++; const req = route.request(), bytes = req.postDataBuffer();
      assert.equal(req.headers().authorization, 'Bearer private-test-access-token-at-least-32');
      assert.equal(new URL(req.url()).searchParams.get('reference'), 'prestige');
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.readUInt32LE(24), 16000); assert.ok(bytes.length > 1000);
      await route.fulfill({ json: report });
    });
    await consent(page); await take(page, '#ppRecBtn2'); await page.waitForFunction(() => _ppState.gotResult);
    assert.equal(calls, 1); assert.equal(await page.evaluate(() => fakeFeeds), 0);
    assert.match(await page.locator('#ppAssessment').innerText(), /86/); assert.match(await page.locator('#ppAssessment').innerText(), /55/);
    assert.match(await page.locator('#ppAssessment').innerText(), /未提供/);
    assert.equal(await page.locator('#ppPlayMineBtn').isVisible(), true);
    assert.equal(await page.evaluate(() => pronStatsGet('prestige').oks), 1);
  } finally { await page.close(); }
});
test('online failure reuses the same PCM and labels fallback without fake scores', async () => {
  const page = await panel(true);
  try {
    await page.route('https://assessment.test/**', route => route.fulfill({ status: 503, json: { error: 'service unavailable' } }));
    await consent(page); await take(page); await page.waitForFunction(() => _ppState.gotResult);
    assert.ok(await page.evaluate(() => fakeFeeds > 0)); assert.match(await page.locator('#ppStatus').innerText(), /在线评估失败.*离线/);
    assert.equal(await page.locator('#ppAssessment').isVisible(), false);
    assert.equal(await page.evaluate(() => pronStatsGet('prestige').tries), 1);
  } finally { await page.close(); }
});
test('no-speech online response is unknown, not a wrong word or a fabricated pass', async () => {
  const page = await panel(true);
  try {
    await page.route('https://assessment.test/**', route => route.fulfill({ json: { ...report, status: 'no-speech', scores: null, words: [], transcript: '' } }));
    await consent(page); await take(page); await page.waitForFunction(() => !_ppState.pending && !_ppState.recording);
    assert.match(await page.locator('#ppResult').innerText(), /无法判断/); assert.equal(await page.locator('#ppAssessment').isVisible(), false);
    assert.equal(await page.evaluate(() => pronStatsGet('prestige').tries), 0);
  } finally { await page.close(); }
});
test('low scores and missing scores do not count as a passed pronunciation', async () => {
  for (const accuracy of [40, null]) {
    const page = await panel(true);
    try {
      const data = structuredClone(report); data.scores.accuracy = accuracy;
      if (accuracy === null) await page.evaluate(() => { window.fakeText = 'banana'; });
      await page.route('https://assessment.test/**', route => route.fulfill({ json: data }));
      await consent(page); await take(page); await page.waitForFunction(() => !_ppState.pending && !_ppState.recording);
      assert.equal(await page.evaluate(() => pronStatsGet('prestige').oks), 0);
    } finally { await page.close(); }
  }
});
test('closing during an upload aborts it and cannot change the next word', async () => {
  const page = await panel(true); let requested = false;
  try {
    await page.route('https://assessment.test/**', async route => { requested = true; await new Promise(r => setTimeout(r, 1000)); await route.fulfill({ json: report }).catch(() => {}); });
    await consent(page); await take(page); await page.waitForFunction(() => !!_ppState.assessmentAbort);
    await page.click('#ppCloseBtn'); await page.evaluate(() => openPronPractice('ambition', ''));
    await page.waitForTimeout(1200);
    assert.equal(requested, true); assert.equal(await page.locator('#ppResult').innerText(), '');
    assert.equal(await page.locator('#ppAssessment').isVisible(), false); assert.equal(await page.evaluate(() => pronStatsGet('ambition').tries), 0);
  } finally { await page.close(); }
});

test('a report for the wrong reference is rejected and explicitly falls back', async () => {
  const page = await panel(true);
  try {
    await page.route('https://assessment.test/**', route => route.fulfill({ json: { ...report, reference: 'banana' } }));
    await consent(page); await take(page); await page.waitForFunction(() => _ppState.gotResult);
    assert.match(await page.locator('#ppStatus').innerText(), /目标词不匹配.*仅提供离线/);
    assert.equal(await page.locator('#ppAssessment').isVisible(), false);
    assert.ok(await page.evaluate(() => fakeFeeds > 0));
  } finally { await page.close(); }
});
test('service text is escaped, and missing word evidence never increments practice stats', async () => {
  const page = await panel(true);
  try {
    const data = structuredClone(report);
    data.transcript = '<img src=x onerror="window.injected=true">';
    data.words[0].word = '<img src=x onerror="window.injected=true">';
    data.words[0].phonemes[0].phoneme = '<script>window.injected=true</script>';
    await page.route('https://assessment.test/**', route => route.fulfill({ json: data }));
    await consent(page); await take(page); await page.waitForFunction(() => _ppState.gotResult);
    assert.equal(await page.locator('#ppAssessment img, #ppAssessment script').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.equal(await page.evaluate(() => pronStatsGet('prestige').tries), 0);
    assert.match(await page.locator('#ppResult').innerText(), /词级证据不足/);
  } finally { await page.close(); }
});
test('switching to offline cancels an upload without scoring or automatic fallback', async () => {
  const page = await panel(true);
  try {
    await page.route('https://assessment.test/**', async route => { await new Promise(r => setTimeout(r, 800)); await route.fulfill({ json: report }).catch(() => {}); });
    await consent(page); await take(page); await page.waitForFunction(() => !!_ppState.assessmentAbort);
    await page.click('#ppEngVosk'); await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => fakeFeeds), 0);
    assert.equal(await page.evaluate(() => pronStatsGet('prestige').tries), 0);
    assert.equal(await page.locator('#ppAssessment').isVisible(), false);
    assert.equal(await page.evaluate(() => _ppState.stream), null);
    assert.equal(await page.locator('#ppPlayMineBtn').isVisible(), true);
  } finally { await page.close(); }
});
test('PCM upload resamples, clips, and keeps zeros as valid scores', async () => {
  const page = await panel();
  try {
    const data = await page.evaluate(() => {
      const v = new DataView(ppPCMToWav(new Float32Array([-2, 0, 2, NaN]), 32000));
      return { rate: v.getUint32(24, true), length: v.getUint32(40, true), first: v.getInt16(44, true), last: v.getInt16(46, true), zero: ppScoreText(0) };
    });
    assert.deepEqual(data, { rate: 16000, length: 4, first: -32768, last: 32767, zero: '0' });
  } finally { await page.close(); }
});

test('insertions and missing word-level evidence do not pass even with high overall scores', async () => {
  const page = await panel(true);
  try {
    for (const kind of ['Insertion', 'NotProvided', 'missing-accuracy']) {
      await page.evaluate(({report,kind}) => {
        localStorage.removeItem(PRON_STORE_KEY);
        const data=structuredClone(report);
        if(kind==='Insertion') data.words.push({word:'extra',accuracy:99,errorType:'Insertion',phonemes:[],syllables:[]});
        else if(kind==='NotProvided') data.words[0].errorType='NotProvided';
        else data.words[0].accuracy=null;
        ppShowAssessment(data);
      },{report,kind});
      assert.equal(await page.evaluate(()=>pronStatsGet('prestige').oks),0);
      if(kind!=='Insertion') assert.equal(await page.evaluate(()=>pronStatsGet('prestige').tries),0);
    }
  } finally { await page.close(); }
});
test('revoking upload consent cancels the current recording without a network request', async () => {
  const page=await panel(true); let requests=0;
  try {
    await page.route('https://assessment.test/**',route=>{requests++;return route.fulfill({json:report});});
    await consent(page); await page.click('#ppRecBtn'); await page.waitForFunction(()=>_ppState.recording);
    await page.uncheck('#ppOnlineConsent'); await page.waitForTimeout(200);
    assert.equal(requests,0); assert.equal(await page.evaluate(()=>_ppState.recording),false);
    assert.equal(await page.evaluate(()=>_ppState.stream),null); assert.equal(await page.evaluate(()=>pronStatsGet('prestige').tries),0);
  } finally { await page.close(); }
});

test('domestic connection UI names Tencent, provides ZIP, and does not reuse old Azure endpoint', async () => {
  const page = await panel();
  try {
    await page.evaluate(() => { localStorage.setItem('cet6_pron_assessment_endpoint_v1', 'https://old-azure.test/assess'); ppEngineSet('online'); });
    assert.equal(await page.locator('#ppOnlineEndpoint').inputValue(), '');
    assert.match(await page.locator('.pp-consent').innerText(), /腾讯云智聆/);
    assert.equal(await page.locator('a[download]').getAttribute('href'), './backend/tencent-scf.zip');
    assert.equal(await page.locator('#ppOnlineToken').getAttribute('placeholder'), '不是腾讯云 SecretKey');
  } finally { await page.close(); }
});
test('Tencent mismatch is not misreported as silence, fake zero, offline match or a statistics pass', async () => {
  const page = await panel(true);
  try {
    const data = structuredClone(report); data.status = 'mismatch'; data.scores.accuracy = null; data.scores.pronunciation = null; data.words[0].accuracy = null; data.words[0].errorType = 'NotRecorded';
    await page.route('https://assessment.test/**', route => route.fulfill({ json: data }));
    await consent(page); await take(page); await page.waitForFunction(() => _ppState.gotResult);
    assert.match(await page.locator('#ppResult').innerText(), /未匹配目标词/); assert.equal(await page.evaluate(() => fakeFeeds), 0);
    assert.equal(await page.evaluate(() => pronStatsGet('prestige').tries), 0);
    assert.match(await page.locator('#ppAssessment').innerText(), /未检测到该词/); assert.equal(await page.locator('.pp-score.primary strong').innerText(), '未提供');
    assert.equal(await page.locator('#ppPlayMineBtn').isVisible(), true);
  } finally { await page.close(); }
});
test('old-provider and invalid stress/error schemas are rejected before rendering', async () => {
  const page = await panel(true);
  try {
    const rejected = await page.evaluate(report => {
      return ['provider', 'stress', 'error'].map(kind => {
        const data = structuredClone(report);
        if (kind === 'provider') data.provider = 'azure';
        if (kind === 'stress') data.words[0].phonemes[0].stressDetected = 'true';
        if (kind === 'error') data.words[0].errorType = 'fictional';
        try { ppValidateReport(data, 'prestige'); return false; } catch { return true; }
      });
    }, report); assert.deepEqual(rejected, [true, true, true]);
  } finally { await page.close(); }
});
test('Tencent stress and missing metrics render on mobile in light/dark without overflow', async () => {
  const page = await panel(true);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(({ report, theme }) => { document.documentElement.setAttribute('data-theme', theme); ppShowAssessment(report); }, { report, theme });
      assert.match(await page.locator('#ppAssessment').innerText(), /重音预期：有/); assert.match(await page.locator('#ppAssessment').innerText(), /重音检测：无/);
      assert.equal(await page.locator('.pp-score').nth(2).locator('strong').innerText(), '未提供');
      assert.equal(await page.evaluate(() => { const report = document.getElementById('ppAssessment'); return report.scrollWidth <= report.clientWidth; }), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    if (process.env.CET6_SCREENSHOT_PATH) await page.screenshot({ path: process.env.CET6_SCREENSHOT_PATH });
  } finally { await page.close(); }
});

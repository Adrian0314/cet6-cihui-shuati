import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { normalizeTencentResult, signTencentRequest, MAX_BYTES } from '../backend/pronunciation-worker.js';
import { env, origin, request, wav, result } from './assessment-fixtures.mjs';

test('Tencent normalization preserves word/phone scores and native stress, without fictional ASR/IPA', () => {
  const data = normalizeTencentResult(result, 'prestige');
  assert.equal(data.provider, 'tencent'); assert.equal(data.scores.accuracy, 86); assert.equal(data.scores.pronunciation, 84);
  assert.equal(data.transcript, ''); assert.equal(data.transcriptKind, 'not-provided');
  assert.equal(data.scores.fluency, null); assert.equal(data.scores.completeness, null); assert.equal(data.scores.prosody, null);
  assert.equal(data.words[0].phonemes[1].accuracy, 55); assert.equal(data.words[0].phonemes[1].stressExpected, true); assert.equal(data.words[0].phonemes[1].stressDetected, false);
  assert.deepEqual(data.words[0].syllables, []);
});
test('zero is a real score, -1 is mismatch not silence, and unavailable fields stay null', () => {
  const raw = structuredClone(result); raw.Response.PronAccuracy = 0; raw.Response.SuggestedScore = 0; raw.Response.Words[0].PhoneInfos[0].PronAccuracy = 0;
  assert.equal(normalizeTencentResult(raw, 'prestige').scores.accuracy, 0); assert.equal(normalizeTencentResult(raw, 'prestige').scores.pronunciation, 0); assert.equal(normalizeTencentResult(raw, 'prestige').words[0].phonemes[0].accuracy, 0);
  raw.Response.PronAccuracy = -1; raw.Response.Words[0].PhoneInfos[0].PronAccuracy = -1;
  const data = normalizeTencentResult(raw, 'prestige'); assert.equal(data.status, 'mismatch'); assert.equal(data.scores.accuracy, null); assert.equal(data.scores.pronunciation, null); assert.equal(data.words[0].phonemes[0].accuracy, null);
  delete raw.Response.SuggestedScore; delete raw.Response.Words[0].PhoneInfos[0].Stress;
  assert.equal(normalizeTencentResult(raw, 'prestige').words[0].phonemes[0].stressExpected, null);
});
test('only sentence-mode ratios are converted to percent and invalid ratios never guessed', () => {
  assert.equal(normalizeTencentResult(result, 'good morning').scores.fluency, 90); assert.equal(normalizeTencentResult(result, 'good morning').scores.completeness, 100);
  const raw = structuredClone(result); raw.Response.PronFluency = 90; raw.Response.PronCompletion = -1;
  assert.equal(normalizeTencentResult(raw, 'good morning').scores.fluency, null); assert.equal(normalizeTencentResult(raw, 'good morning').scores.completeness, null);
});
test('Tencent MatchTags map to actual word errors including not-recorded; unknown stays unknown', () => {
  const names = ['None', 'Insertion', 'Omission', 'Mispronunciation', 'NotRecorded', 'NotProvided'];
  for (let i = 0; i < names.length; i++) { const raw = structuredClone(result); raw.Response.Words[0].MatchTag = i; assert.equal(normalizeTencentResult(raw, 'prestige').words[0].errorType, names[i]); }
  const raw = structuredClone(result); raw.Response.Words[0].MatchTag = '0'; assert.equal(normalizeTencentResult(raw, 'prestige').words[0].errorType, 'NotProvided');
});
test('missing, out-of-range, string, and unfinished scores cannot fabricate success', () => {
  for (const value of [undefined, 101, -2, '90', null, NaN]) { const raw = structuredClone(result); raw.Response.PronAccuracy = value; assert.throws(() => normalizeTencentResult(raw, 'prestige')); }
  for (const value of ['Evaluating', 'Failed']) { const raw = structuredClone(result); raw.Response.Status = value; assert.throws(() => normalizeTencentResult(raw, 'prestige')); }
  const raw = structuredClone(result); raw.Response.Words = Array(33).fill(raw.Response.Words[0]); assert.throws(() => normalizeTencentResult(raw, 'prestige'));
  raw.Response.Words = [{ ...result.Response.Words[0], PhoneInfos: Array(101).fill({ Phone: 'p', PronAccuracy: 99 }) }]; assert.throws(() => normalizeTencentResult(raw, 'prestige'));
});
test('TC3 signature matches an independent Python hashlib/HMAC fixed vector, exact bytes and UTC scope', async () => {
  // Generated independently with Python hashlib + hmac using Tencent's published TC3 canonical-request contract.
  const signed = await signTencentRequest('{"RefText":"prestige","ServerType":0}', env, 1791331200);
  assert.equal(signed.Authorization, 'TC3-HMAC-SHA256 Credential=test-secret-id-0123456789/2026-10-07/soe/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=84b31608b24acc85d7ace35ae49584ad9e15537295a940c11a5e4f52b4a30686');
  assert.equal(signed['X-TC-Timestamp'], '1791331200'); assert.equal(signed['X-TC-Version'], '2018-07-24'); assert.equal(signed['X-TC-Action'], 'TransmitOralProcessWithInit');
  assert.notEqual((await signTencentRequest('{"RefText":"Prestige","ServerType":0}', env, 1791331200)).Authorization, signed.Authorization);
});
test('backend requires a real access token, exact allowed origin and configured domestic secrets', async () => {
  for (const [req, config, status] of [
    [request({ auth: 'wrong' }), env, 401], [request({ source: 'https://evil.test' }), env, 403], [request({ source: '' }), env, 403],
    [request(), { ...env, TENCENT_SECRET_KEY: '' }, 503], [request(), { ...env, TENCENT_SECRET_ID: '' }, 503], [request(), { ...env, ASSESSMENT_ACCESS_TOKEN: '' }, 503],
    [request(), { ...env, ALLOWED_ORIGIN: '*' }, 503], [request(), { ...env, ASSESSMENT_RATE_LIMITER: undefined }, 503]
  ]) assert.equal((await worker.fetch(req, config)).status, status);
});
test('CORS preflight works before cloud credentials exist and blocks other origins', async () => {
  const res = await worker.fetch(request({ method: 'OPTIONS' }), { ALLOWED_ORIGIN: origin });
  assert.equal(res.status, 204); assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin); assert.match(res.headers.get('Access-Control-Allow-Headers'), /Authorization/i);
  assert.equal((await worker.fetch(request({ method: 'OPTIONS', source: 'https://evil.test' }), env)).status, 403);
});
test('invalid words, audio format, oversized declared/streamed data and throttling never reach Tencent', async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('should not call'); };
  try {
    for (const req of [request({ reference: '<script>' }), request({ body: new Uint8Array(44) }), request({ contentType: 'audio/webm' }), request({ body: wav(16) }), request({ reference: 'one '.repeat(21).trim() })]) assert.ok([400, 413, 415].includes((await worker.fetch(req, env)).status));
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_BYTES)); c.enqueue(new Uint8Array(100)); c.close(); } });
    assert.equal((await worker.fetch(request({ body: stream }), env)).status, 413);
    assert.equal((await worker.fetch(request(), { ...env, ASSESSMENT_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});
test('digital silence is unknown, does not consume paid service or local rate quota', async () => {
  let limits = 0; const previous = globalThis.fetch; globalThis.fetch = async () => { throw Error('unexpected upstream'); };
  try {
    const res = await worker.fetch(request({ body: wav(1, true) }), { ...env, ASSESSMENT_RATE_LIMITER: { limit: async () => { limits++; return { success: true }; } } });
    assert.equal(res.status, 200); const data = await res.json(); assert.equal(data.status, 'no-speech'); assert.equal(data.scores, null); assert.equal(limits, 0);
  } finally { globalThis.fetch = previous; }
});
test('valid WAV is signed and forwarded only to official Tencent SOE with documented word/sentence parameters', async () => {
  const previous = globalThis.fetch; let mode = 0;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), 'https://soe.tencentcloudapi.com/'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers['X-TC-Action'], 'TransmitOralProcessWithInit'); assert.equal(options.headers['X-TC-Version'], '2018-07-24');
      assert.equal(options.headers.Authorization, (await signTencentRequest(options.body, env, Number(options.headers['X-TC-Timestamp']))).Authorization);
      const config = JSON.parse(options.body); assert.equal(config.RefText, mode ? 'good morning' : 'prestige'); assert.equal(config.EvalMode, mode);
      for (const [key, value] of Object.entries({ SeqId: 1, IsEnd: 1, VoiceFileType: 2, VoiceEncodeType: 1, WorkMode: 1, ScoreCoeff: 4, ServerType: 0, IsAsync: 0 })) assert.equal(config[key], value);
      assert.equal(config.SoeAppId, undefined); assert.match(config.SessionId, /^[0-9a-f-]{36}$/);
      assert.deepEqual(Buffer.from(config.UserVoiceData, 'base64'), Buffer.from(wav())); return Response.json(result);
    };
    for (mode of [0, 1]) {
      const res = await worker.fetch(request({ reference: mode ? 'good morning' : 'prestige', path: '/release/my-function/assess' }), { ...env, SPEECH_ENDPOINT: 'https://evil.test' }); const body = await res.text();
      assert.equal(res.status, 200); assert.equal(JSON.parse(body).provider, 'tencent'); assert.ok(!body.includes(env.TENCENT_SECRET_KEY)); assert.equal(res.headers.get('Cache-Control'), 'no-store');
    }
  } finally { globalThis.fetch = previous; }
});
test('HTTP 200 provider errors and HTTP failures are sanitized; auth/quota/resource messages are actionable', async () => {
  const previous = globalThis.fetch;
  try {
    for (const [code, expected, message] of [['AuthFailure.SignatureFailure', 502, /鉴权/], ['RequestLimitExceeded', 429, /受限/], ['FailedOperation.NoResource', 502, /未开通/], ['InvalidParameterValue', 502, /配置/]]) {
      globalThis.fetch = async () => Response.json({ Response: { Error: { Code: code, Message: 'private-upstream-detail ' + env.TENCENT_SECRET_KEY } } });
      const res = await worker.fetch(request(), env); const body = await res.text(); assert.equal(res.status, expected); assert.match(body, message); assert.ok(!body.includes('private-upstream-detail')); assert.ok(!body.includes(env.TENCENT_SECRET_KEY));
    }
    for (const status of [401, 429, 500]) { globalThis.fetch = async () => new Response('private-upstream-detail', { status }); const res = await worker.fetch(request(), env); assert.ok(res.status >= 400); assert.ok(!(await res.text()).includes('private-upstream-detail')); }
  } finally { globalThis.fetch = previous; }
});
test('health is authenticated, handles gateway prefix and does not prove real service readiness', async () => {
  const res = await worker.fetch(request({ method: 'GET', path: '/release/function/health' }), env);
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ready: true, provider: 'tencent' });
  assert.equal((await worker.fetch(request({ method: 'GET', path: '/health', auth: 'wrong' }), env)).status, 401);
  assert.equal((await worker.fetch(request({ method: 'GET' }), env)).status, 405); assert.equal((await worker.fetch(request({ path: '/other' }), env)).status, 404);
});
test('malformed, missing and unfinished upstream reports fail closed', async () => {
  const previous = globalThis.fetch;
  try {
    for (const body of ['not-json private-details', JSON.stringify({ Response: {} }), JSON.stringify({ Response: { Status: 'Evaluating', PronAccuracy: 99 } })]) {
      globalThis.fetch = async () => new Response(body); const res = await worker.fetch(request(), env); assert.equal(res.status, 502); assert.ok(!(await res.text()).includes('private-details'));
    }
  } finally { globalThis.fetch = previous; }
});
test('caller abort is propagated to provider request and no response is fabricated', async () => {
  const previous = globalThis.fetch; const controller = new AbortController(); let started;
  const entered = new Promise(r => { started = r; });
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => { started(); signal.addEventListener('abort', () => reject(Error('abort')), { once: true }); });
  try { const pending = worker.fetch(request({ signal: controller.signal }), env); await entered; controller.abort(); assert.equal((await pending).status, 504); }
  finally { globalThis.fetch = previous; }
});

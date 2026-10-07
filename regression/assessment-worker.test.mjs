import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { normalizeAzureResult } from '../backend/pronunciation-worker.js';
const origin = 'https://adrian0314.github.io';
const token = 'test-access-token-0123456789abcdef';
const env = { SPEECH_KEY: 'test-azure-key', SPEECH_ENDPOINT: 'https://test.cognitiveservices.azure.com', ASSESSMENT_ACCESS_TOKEN: token, ALLOWED_ORIGIN: origin, ASSESSMENT_RATE_LIMITER: { limit: async () => ({ success: true }) } };
function wav(seconds = 1) {
  const data = new ArrayBuffer(44 + 32000 * seconds), v = new DataView(data);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) [...text].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  v.setUint32(4, data.byteLength - 8, true); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); v.setUint32(40, data.byteLength - 44, true);
  return data;
}
function request({ method = 'POST', source = origin, auth = token, body = wav(), reference = 'prestige', path = '/assess', contentType = 'audio/wav' } = {}) {
  return new Request('https://test.workers.dev' + path + '?reference=' + encodeURIComponent(reference), { method, headers: { Origin: source, Authorization: 'Bearer ' + auth, 'Content-Type': contentType }, ...(method === 'POST' ? { body } : {}) });
}
const result = { RecognitionStatus: 'Success', NBest: [{ Display: 'Prestige.', AccuracyScore: 86, PronScore: 84, FluencyScore: 90, CompletenessScore: 100, Words: [{ Word: 'prestige', AccuracyScore: 86, ErrorType: 'None', Phonemes: [{ Phoneme: 'p', AccuracyScore: 94 }, { Phoneme: 'r', AccuracyScore: 55 }] }] }] };
test('normalization preserves real scores and leaves unavailable metrics null', () => {
  const data = normalizeAzureResult(result, 'prestige');
  assert.equal(data.scores.accuracy, 86); assert.equal(data.scores.prosody, null);
  assert.equal(data.words[0].phonemes[1].accuracy, 55);
  assert.equal(normalizeAzureResult({ RecognitionStatus: 'NoMatch' }, 'prestige').status, 'no-speech');
  const nested = structuredClone(result); nested.NBest[0].PronunciationAssessment = { AccuracyScore: 0, PronScore: 0 };
  assert.equal(normalizeAzureResult(nested, 'prestige').scores.accuracy, 0);
});
test('missing, out-of-range, and string scores cannot fabricate a successful assessment', () => {
  for (const score of [undefined, 101, -1, '90', null]) {
    const raw = structuredClone(result); raw.NBest[0].AccuracyScore = score;
    assert.throws(() => normalizeAzureResult(raw, 'prestige'));
  }
});
test('backend requires a real auth token, exact allowed origin, and configured secrets', async () => {
  for (const [req, config, status] of [
    [request({ auth: 'wrong' }), env, 401], [request({ source: 'https://evil.test' }), env, 403],
    [request(), { ...env, SPEECH_KEY: '' }, 503], [request(), { ...env, ASSESSMENT_ACCESS_TOKEN: '' }, 503],
    [request(), { ...env, ALLOWED_ORIGIN: '*' }, 503], [request(), { ...env, ASSESSMENT_RATE_LIMITER: undefined }, 503]
  ]) assert.equal((await worker.fetch(req, config)).status, status);
});
test('CORS preflight permits only the configured site and required headers', async () => {
  const res = await worker.fetch(request({ method: 'OPTIONS' }), env);
  assert.equal(res.status, 204); assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin);
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /Authorization/i);
  assert.equal((await worker.fetch(request({ method: 'OPTIONS', source: 'https://evil.test' }), env)).status, 403);
});
test('invalid words, audio format, oversized data, and rate limits never reach Azure', async () => {
  for (const req of [request({ reference: '<script>' }), request({ body: new Uint8Array(44) }), request({ contentType: 'audio/webm' }), request({ body: wav(16) })]) {
    assert.ok([400, 413, 415].includes((await worker.fetch(req, env)).status));
  }
  assert.equal((await worker.fetch(request(), { ...env, ASSESSMENT_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
});
test('valid PCM is forwarded with protected Azure key and documented assessment header', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.match(String(url), /^https:\/\/test\.cognitiveservices\.azure\.com\/stt\/speech\/recognition\/conversation\/cognitiveservices\/v1/);
      assert.equal(options.headers['Ocp-Apim-Subscription-Key'], 'test-azure-key');
      const config = JSON.parse(Buffer.from(options.headers['Pronunciation-Assessment'], 'base64').toString());
      assert.equal(config.ReferenceText, 'prestige'); assert.equal(config.Granularity, 'Phoneme'); assert.equal(config.Dimension, 'Comprehensive');
      assert.equal(new DataView(options.body).getUint32(24, true), 16000);
      return Response.json(result);
    };
    const res = await worker.fetch(request(), env); const text = await res.text();
    assert.equal(res.status, 200); assert.equal(JSON.parse(text).provider, 'azure');
    assert.ok(!text.includes('test-azure-key')); assert.equal(res.headers.get('Cache-Control'), 'no-store');
  } finally { globalThis.fetch = previous; }
});
test('upstream auth and quota errors are sanitized, not leaked to the browser', async () => {
  const previous = globalThis.fetch;
  try {
    for (const status of [401, 429, 500]) {
      globalThis.fetch = async () => new Response('private-upstream-detail test-azure-key', { status });
      const res = await worker.fetch(request(), env); const body = await res.text();
      assert.ok(res.status >= 400); assert.ok(!body.includes('private-upstream-detail')); assert.ok(!body.includes('test-azure-key'));
    }
  } finally { globalThis.fetch = previous; }
});

test('health is authenticated, never calls Azure, and is not proof of an upstream assessment', async () => {
  const res = await worker.fetch(request({ method: 'GET', path: '/health' }), env);
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ready: true, provider: 'azure' });
  assert.equal((await worker.fetch(request({ method: 'GET', path: '/health', auth: 'wrong' }), env)).status, 401);
  assert.equal((await worker.fetch(request({ method: 'GET' }), env)).status, 405);
});
test('malformed JSON and missing assessment scores return sanitized failures', async () => {
  const previous = globalThis.fetch;
  try {
    for (const body of ['not-json private-details', JSON.stringify({ RecognitionStatus: 'Success', NBest: [{ Display: 'Prestige.' }] })]) {
      globalThis.fetch = async () => new Response(body);
      const res = await worker.fetch(request(), env);
      assert.equal(res.status, 502); assert.ok(!(await res.text()).includes('private-details'));
    }
  } finally { globalThis.fetch = previous; }
});
test('provider endpoints with credentials, a path, or foreign hosts fail closed', async () => {
  for (const endpoint of ['https://evil.test', 'https://test.cognitiveservices.azure.com.evil.test', 'https://secret@test.cognitiveservices.azure.com', 'https://test.cognitiveservices.azure.com/private']) {
    assert.equal((await worker.fetch(request(), { ...env, SPEECH_ENDPOINT: endpoint })).status, 503);
  }
});
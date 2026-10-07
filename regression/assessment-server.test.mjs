import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createAssessmentServer, createInstanceRateLimiter } from '../backend/server.mjs';
import { env, origin, token, wav, result } from './assessment-fixtures.mjs';
async function running(config, run) {
  const server = createAssessmentServer(config).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
}
const headers = { Origin: origin, Authorization: 'Bearer ' + token, 'Content-Type': 'audio/wav' };
test('SCF adapter serves real HTTP preflight and authenticated prefixed health without npm dependencies', async () => {
  await running(env, async base => {
    const res = await fetch(base + '/release/function/health', { headers }); assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ready: true, provider: 'tencent' });
    assert.equal((await fetch(base + '/health', { headers: { ...headers, Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(base + '/health', { headers: { ...headers, Origin: 'https://evil.test' } })).status, 403);
    assert.equal((await fetch(base + '/assess', { method: 'OPTIONS', headers: { Origin: origin } })).status, 204);
  });
  await running({}, async base => { const res = await fetch(base + '/health', { headers }); assert.equal(res.status, 503); assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin); });
});
test('SCF streamed WAV reaches same Tencent contract; silence remains local', async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, opts) => {
    if (new URL(url).hostname !== 'soe.tencentcloudapi.com') return previous(url, opts);
    calls++; const payload = JSON.parse(opts.body); assert.equal(payload.RefText, 'prestige'); assert.deepEqual(Buffer.from(payload.UserVoiceData, 'base64'), Buffer.from(wav()));
    return Response.json(result);
  };
  try { await running(env, async base => {
    const res = await fetch(base + '/release/function/assess?reference=prestige', { method: 'POST', headers, body: wav() }); assert.equal(res.status, 200); assert.equal((await res.json()).scores.accuracy, 86); assert.equal(calls, 1);
    const quiet = await fetch(base + '/assess?reference=prestige', { method: 'POST', headers, body: wav(1, true) }); assert.equal((await quiet.json()).status, 'no-speech'); assert.equal(calls, 1);
  }); } finally { globalThis.fetch = previous; }
});
test('oversized chunked upload returns readable 413 rather than destroying socket before response', async () => {
  await running(env, async base => {
    const response = await new Promise((resolve, reject) => {
      const req = httpRequest(base + '/assess?reference=prestige', { method: 'POST', headers }, res => { let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body })); });
      req.on('error', reject); req.write(new Uint8Array(300000)); req.end(new Uint8Array(300000));
    });
    assert.equal(response.status, 413); assert.match(response.body, /超出/);
  });
});
test('instance limiter has explicit per-process window semantics and protects HTTP uploads', async () => {
  let now = 0; const limiter = createInstanceRateLimiter(2, 60000, () => now);
  assert.equal((await limiter.limit()).success, true); assert.equal((await limiter.limit()).success, true); assert.equal((await limiter.limit()).success, false); now = 60000; assert.equal((await limiter.limit()).success, true);
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, opts) => { if (new URL(url).hostname !== 'soe.tencentcloudapi.com') return previous(url, opts); calls++; return Response.json(result); };
  try { await running({ ...env, ASSESSMENT_RATE_LIMITER: createInstanceRateLimiter(1) }, async base => {
    assert.equal((await fetch(base + '/assess?reference=prestige', { method: 'POST', headers, body: wav() })).status, 200);
    assert.equal((await fetch(base + '/assess?reference=prestige', { method: 'POST', headers, body: wav() })).status, 429); assert.equal(calls, 1);
  }); } finally { globalThis.fetch = previous; }
});
test('client disconnect aborts Tencent request instead of waiting for provider timeout', async () => {
  const previous = globalThis.fetch; let start, abort;
  const started = new Promise(r => start = r), aborted = new Promise(r => abort = r);
  globalThis.fetch = async (url, opts) => {
    if (new URL(url).hostname !== 'soe.tencentcloudapi.com') return previous(url, opts);
    start(); return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => { abort(); reject(Error('client gone')); }, { once: true }));
  };
  try { await running(env, async base => {
    const controller = new AbortController(); const pending = fetch(base + '/assess?reference=prestige', { method: 'POST', headers, body: wav(), signal: controller.signal }).catch(() => {});
    await started; controller.abort(); await pending;
    let timer; try { await Promise.race([aborted, new Promise((_r, reject) => { timer = setTimeout(() => reject(Error('upstream abort not propagated')), 3000); })]); } finally { clearTimeout(timer); }
  }); } finally { globalThis.fetch = previous; }
});

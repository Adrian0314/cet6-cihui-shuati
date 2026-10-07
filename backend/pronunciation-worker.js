// Tencent SOE credentials stay on the backend. Never log audio, tokens or provider payloads.
export const MAX_BYTES = 44 + 16000 * 2 * 15;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const HOST = 'soe.tencentcloudapi.com', ACTION = 'TransmitOralProcessWithInit';
const CONTENT_TYPE = 'application/json; charset=utf-8';
const score = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const ratioScore = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value * 100 : null;
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const errorType = tag => ({ 0: 'None', 1: 'Insertion', 2: 'Omission', 3: 'Mispronunciation', 4: 'NotRecorded' })[tag] || 'NotProvided';
function emptyReport(reference, status) {
  return { version: 1, provider: 'tencent', status, reference, transcript: '', transcriptKind: 'not-provided', scores: null, words: [], phonemeAlphabet: 'service' };
}
export function normalizeTencentResult(raw, reference) {
  const result = raw?.Response;
  if (!result || result.Error || (result.Status != null && result.Status !== 'Finished') || (result.PronAccuracy !== -1 && score(result.PronAccuracy) === null)) throw new HttpError(502, '腾讯云没有返回有效的最终评测结果，请重试。');
  const words = Array.isArray(result.Words) ? result.Words : [];
  if (words.length > 32 || words.some(w => !w || (Array.isArray(w.PhoneInfos) && w.PhoneInfos.length > 100))) throw new HttpError(502, '腾讯云评测明细超出允许范围，请重试。');
  const isWord = !reference.includes(' '), mismatch = result.PronAccuracy === -1;
  return {
    ...emptyReport(reference, mismatch ? 'mismatch' : 'success'),
    // SOE aligns speech to RefText; Word is NOT proof of a free ASR transcription.
    scores: { accuracy: score(result.PronAccuracy), pronunciation: mismatch ? null : score(result.SuggestedScore), fluency: isWord || mismatch ? null : ratioScore(result.PronFluency), completeness: isWord || mismatch ? null : ratioScore(result.PronCompletion), prosody: null },
    words: words.map(w => ({
      word: text(w.Word, 100), accuracy: score(w.PronAccuracy),
      errorType: Number.isInteger(w.MatchTag) ? errorType(w.MatchTag) : 'NotProvided',
      phonemes: (Array.isArray(w.PhoneInfos) ? w.PhoneInfos : []).map(p => ({
        phoneme: text(p?.Phone, 40), accuracy: score(p?.PronAccuracy),
        stressExpected: typeof p?.Stress === 'boolean' ? p.Stress : null,
        stressDetected: typeof p?.DetectedStress === 'boolean' ? p.DetectedStress : null
      })), syllables: []
    }))
  };
}
const utf8 = value => new TextEncoder().encode(value);
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', utf8(value))); }
async function hmac(key, value) {
  const imported = await crypto.subtle.importKey('raw', typeof key === 'string' ? utf8(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, utf8(value));
}
export async function signTencentRequest(body, env, timestamp = Math.floor(Date.now() / 1000)) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10), scope = date + '/soe/tc3_request';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = 'content-type:' + CONTENT_TYPE + '\nhost:' + HOST + '\nx-tc-action:' + ACTION.toLowerCase() + '\n';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, await digest(body)].join('\n');
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, scope, await digest(canonicalRequest)].join('\n');
  const dateKey = await hmac('TC3' + env.TENCENT_SECRET_KEY, date);
  const serviceKey = await hmac(dateKey, 'soe'), signingKey = await hmac(serviceKey, 'tc3_request');
  return {
    'Content-Type': CONTENT_TYPE, 'X-TC-Action': ACTION, 'X-TC-Version': '2018-07-24', 'X-TC-Timestamp': String(timestamp),
    Authorization: 'TC3-HMAC-SHA256 Credential=' + env.TENCENT_SECRET_ID + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + hex(await hmac(signingKey, stringToSign))
  };
}
function originsFrom(env) {
  const origins = String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origins.length || origins.some(s => { try { const u = new URL(s); return u.origin !== s || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))); } catch { return true; } })) throw new HttpError(503, '评估后端未配置允许访问的站点。');
  return origins;
}
function configuration(env) {
  if (![env.TENCENT_SECRET_ID, env.TENCENT_SECRET_KEY].every(v => typeof v === 'string' && v.length >= 16 && v.length <= 256 && !/\s/.test(v)) || typeof env.ASSESSMENT_ACCESS_TOKEN !== 'string' || env.ASSESSMENT_ACCESS_TOKEN.length < 32 || env.ASSESSMENT_ACCESS_TOKEN.length > 768 || /\s/.test(env.ASSESSMENT_ACCESS_TOKEN) || typeof env.ASSESSMENT_RATE_LIMITER?.limit !== 'function') throw new HttpError(503, '评估后端未完成腾讯云密钥、访问口令或限流配置。');
}
async function sameToken(a, b) {
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', utf8(s))));
  const xx = new Uint8Array(x), yy = new Uint8Array(y); let difference = 0;
  for (let i = 0; i < xx.length; i++) difference |= xx[i] ^ yy[i];
  return difference === 0;
}
async function readLimited(stream, max, cancelOnError = true) {
  if (!stream) throw new HttpError(400, '缺少录音数据。');
  const reader = stream.getReader(); let total = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > max) throw new HttpError(413, '录音数据超出允许大小。'); chunks.push(value);
    }
  } catch (err) { if (cancelOnError) await reader.cancel().catch(() => {}); throw err; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}
function validateWav(bytes) {
  if (bytes.byteLength <= 44 || bytes.byteLength > MAX_BYTES) throw new HttpError(400, '录音为空或时长超过 15 秒。');
  const v = new DataView(bytes), label = (n, str) => [...str].every((c, i) => v.getUint8(n + i) === c.charCodeAt(0));
  if (!label(0, 'RIFF') || !label(8, 'WAVE') || !label(12, 'fmt ') || !label(36, 'data') || v.getUint32(4, true) !== bytes.byteLength - 8 || v.getUint32(16, true) !== 16 || v.getUint16(20, true) !== 1 || v.getUint16(22, true) !== 1 || v.getUint32(24, true) !== 16000 || v.getUint32(28, true) !== 32000 || v.getUint16(32, true) !== 2 || v.getUint16(34, true) !== 16 || v.getUint32(40, true) !== bytes.byteLength - 44 || (bytes.byteLength - 44) % 2) throw new HttpError(400, '需要 16 kHz 单声道 PCM16 WAV 录音。');
}
function base64(bytes) {
  let binary = ''; const data = new Uint8Array(bytes);
  for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(binary);
}
function providerError(code) {
  if (/^LimitExceeded|^RequestLimitExceeded/.test(code)) return new HttpError(429, '腾讯云评测额度或并发受限，请稍后再试。');
  if (/^AuthFailure|^UnauthorizedOperation/.test(code)) return new HttpError(502, '腾讯云鉴权失败，请管理员检查密钥及口语评测权限。');
  if (/^FailedOperation\.(NoResource|ServiceIsolate|ServiceNotOpened|Balance|欠费)/.test(code) || /Resource|Balance|ServiceNotOpened|ServiceIsolate|Arrears/.test(code)) return new HttpError(502, '腾讯云口语评测未开通、额度不足或欠费，请管理员检查英文评测服务。');
  return new HttpError(502, '腾讯云评测暂不可用，请管理员检查服务配置。');
}
export default {
  async fetch(request, env) {
    const headers = { 'Cache-Control': 'no-store', Vary: 'Origin', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
    try {
      const origin = request.headers.get('Origin') || '';
      if (!originsFrom(env).includes(origin)) throw new HttpError(403, '此站点不允许调用评估服务。');
      headers['Access-Control-Allow-Origin'] = origin;
      // The basic SCF gateway may retain /release/<function>/ prefixes. Only route suffixes are used.
      const pathname = new URL(request.url).pathname;
      const route = pathname.endsWith('/assess') ? 'assess' : pathname.endsWith('/health') ? 'health' : '';
      if (!route) throw new HttpError(404, '评估接口不存在。');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' } });
      configuration(env);
      if (!['GET', 'POST'].includes(request.method)) throw new HttpError(405, '不支持此请求方法。');
      const auth = request.headers.get('Authorization') || '';
      if (auth.length > 1024 || !auth.startsWith('Bearer ') || !(await sameToken(auth.slice(7), env.ASSESSMENT_ACCESS_TOKEN))) throw new HttpError(401, '访问口令无效，请在在线设置中检查。');
      if (request.method === 'GET' && route === 'health') return Response.json({ ready: true, provider: 'tencent' }, { headers });
      if (request.method !== 'POST' || route !== 'assess') throw new HttpError(405, '评估需使用 POST /assess。');
      const reference = String(new URL(request.url).searchParams.get('reference') || '').trim();
      if (reference.length > 160 || !/^[a-zA-Z][a-zA-Z'’\-]*(?: [a-zA-Z][a-zA-Z'’\-]*){0,19}$/.test(reference)) throw new HttpError(400, '目标文本必须是英语单词或短句。');
      if (!/^audio\/wav(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw new HttpError(415, '仅接受 PCM WAV 录音。');
      if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) throw new HttpError(413, '录音数据超出允许大小。');
      const audio = await readLimited(request.body, MAX_BYTES, false); validateWav(audio);
      // Only digital silence is detected locally; do not confuse a provider mismatch (-1) with silence.
      if (!new Uint8Array(audio, 44).some(b => b !== 0)) return Response.json(emptyReport(reference, 'no-speech'), { headers });
      if (!(await env.ASSESSMENT_RATE_LIMITER.limit({ key: 'assessment-owner' })).success) throw new HttpError(429, '评估请求过于频繁，请稍后再试。');
      const payload = JSON.stringify({ SeqId: 1, IsEnd: 1, VoiceFileType: 2, VoiceEncodeType: 1, UserVoiceData: base64(audio), SessionId: crypto.randomUUID(), RefText: reference, WorkMode: 1, EvalMode: reference.includes(' ') ? 1 : 0, ScoreCoeff: 4, ServerType: 0, IsAsync: 0 });
      const signed = await signTencentRequest(payload, env);
      const controller = new AbortController(), abort = () => controller.abort();
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) controller.abort();
      const timer = setTimeout(abort, 20000); let data;
      try {
        const upstream = await fetch('https://' + HOST + '/', { method: 'POST', headers: signed, body: payload, signal: controller.signal, redirect: 'error' });
        if (!upstream.ok) throw new HttpError(upstream.status === 429 ? 429 : 502, upstream.status === 429 ? '腾讯云评测额度不足或请求过快，请稍后再试。' : '腾讯云评测暂不可用，请管理员检查服务配置。');
        data = JSON.parse(new TextDecoder().decode(await readLimited(upstream.body, 2 * 1024 * 1024)));
        if (data?.Response?.Error) throw providerError(text(data.Response.Error.Code, 100));
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? '在线发音评估已取消或超时，请重试。' : '腾讯云评测响应异常，请稍后重试。');
      } finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); }
      return Response.json(normalizeTencentResult(data, reference), { headers });
    } catch (err) {
      return Response.json({ error: err instanceof HttpError ? err.message : '评估后端配置或响应异常。' }, { status: err instanceof HttpError ? err.status : 503, headers });
    }
  }
};
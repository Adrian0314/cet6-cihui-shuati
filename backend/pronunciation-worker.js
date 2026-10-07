// Azure credentials stay in Worker secrets. No audio, tokens, or provider payloads are logged.
const MAX_BYTES = 44 + 16000 * 2 * 15;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function score(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null; }
function assessment(value) { return value?.PronunciationAssessment || value || {}; }
export function normalizeAzureResult(raw, reference) {
  if (['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout'].includes(raw?.RecognitionStatus)) {
    return { version: 1, provider: 'azure', status: 'no-speech', reference, transcript: '', scores: null, words: [], phonemeAlphabet: 'service' };
  }
  const best = raw?.NBest?.[0], a = assessment(best);
  if (raw?.RecognitionStatus !== 'Success' || !best || score(a.AccuracyScore) === null) throw new HttpError(502, '评估服务没有返回有效的准确度，请重试。');
  return {
    version: 1, provider: 'azure', status: 'success', reference,
    transcript: String(best.Display || best.Lexical || raw.DisplayText || '').slice(0, 1000),
    scores: { accuracy: score(a.AccuracyScore), pronunciation: score(a.PronScore), fluency: score(a.FluencyScore), completeness: score(a.CompletenessScore), prosody: score(a.ProsodyScore) },
    // The documented REST API does not guarantee IPA. Preserve symbols without relabelling them as IPA.
    phonemeAlphabet: 'service',
    words: (Array.isArray(best.Words) ? best.Words : []).slice(0, 32).map(w => ({
      word: String(w.Word || '').slice(0, 100), accuracy: score(assessment(w).AccuracyScore),
      errorType: ['None', 'Omission', 'Insertion', 'Mispronunciation', 'UnexpectedBreak', 'MissingBreak', 'Monotone'].includes(assessment(w).ErrorType) ? assessment(w).ErrorType : 'NotProvided',
      phonemes: (Array.isArray(w.Phonemes) ? w.Phonemes : []).slice(0, 100).map(p => ({ phoneme: String(p.Phoneme || '').slice(0, 40), accuracy: score(assessment(p).AccuracyScore) })),
      syllables: (Array.isArray(w.Syllables) ? w.Syllables : []).slice(0, 40).map(s => ({ syllable: String(s.Syllable || s.Grapheme || '').slice(0, 40), accuracy: score(assessment(s).AccuracyScore) }))
    }))
  };
}
function configuration(env) {
  const origins = String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origins.length || origins.some(s => { try { const u = new URL(s); return u.origin !== s || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))); } catch { return true; } })) throw new HttpError(503, '评估后端未配置允许访问的站点。');
  const endpoint = new URL(env.SPEECH_ENDPOINT || 'https://not-configured.invalid');
  if (!env.SPEECH_KEY || !env.ASSESSMENT_ACCESS_TOKEN || env.ASSESSMENT_ACCESS_TOKEN.length < 32 || !env.ASSESSMENT_RATE_LIMITER || endpoint.protocol !== 'https:' || !/\.(cognitiveservices\.azure\.com|stt\.speech\.microsoft\.com)$/.test(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new HttpError(503, '评估后端未完成密钥、Azure 地址或限流配置。');
  return { origins, endpoint: endpoint.origin };
}
async function sameToken(a, b) {
  const encode = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', encode.encode(s))));
  const xx = new Uint8Array(x), yy = new Uint8Array(y); let difference = 0;
  for (let i = 0; i < xx.length; i++) difference |= xx[i] ^ yy[i];
  return difference === 0;
}
async function readLimited(stream, max) {
  if (!stream) throw new HttpError(400, '缺少录音数据。');
  const reader = stream.getReader(); let total = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > max) throw new HttpError(413, '录音数据超出允许大小。'); chunks.push(value);
    }
  } catch (err) { await reader.cancel().catch(() => {}); throw err; }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}
function validateWav(bytes) {
  if (bytes.byteLength <= 44 || bytes.byteLength > MAX_BYTES) throw new HttpError(400, '录音为空或时长超过 15 秒。');
  const v = new DataView(bytes), label = (n, text) => [...text].every((c, i) => v.getUint8(n + i) === c.charCodeAt(0));
  if (!label(0, 'RIFF') || !label(8, 'WAVE') || !label(12, 'fmt ') || !label(36, 'data') || v.getUint32(4, true) !== bytes.byteLength - 8 || v.getUint32(16, true) !== 16 || v.getUint16(20, true) !== 1 || v.getUint16(22, true) !== 1 || v.getUint32(24, true) !== 16000 || v.getUint32(28, true) !== 32000 || v.getUint16(32, true) !== 2 || v.getUint16(34, true) !== 16 || v.getUint32(40, true) !== bytes.byteLength - 44 || (bytes.byteLength - 44) % 2) throw new HttpError(400, '需要 16 kHz 单声道 PCM16 WAV 录音。');
}
export default {
  async fetch(request, env) {
    let headers = { 'Cache-Control': 'no-store', 'Vary': 'Origin', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
    try {
      const config = configuration(env), origin = request.headers.get('Origin') || '';
      if (!config.origins.includes(origin)) throw new HttpError(403, '此站点不允许调用评估服务。');
      headers['Access-Control-Allow-Origin'] = origin;
      const url = new URL(request.url);
      if (url.pathname !== '/assess' && url.pathname !== '/health') throw new HttpError(404, '评估接口不存在。');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' } });
      if (!['GET', 'POST'].includes(request.method)) throw new HttpError(405, '不支持此请求方法。');
      const auth = request.headers.get('Authorization') || '';
      if (auth.length > 1024 || !auth.startsWith('Bearer ') || !(await sameToken(auth.slice(7), env.ASSESSMENT_ACCESS_TOKEN))) throw new HttpError(401, '访问口令无效，请在在线设置中检查。');
      if (request.method === 'GET' && url.pathname === '/health') return Response.json({ ready: true, provider: 'azure' }, { headers });
      if (request.method !== 'POST' || url.pathname !== '/assess') throw new HttpError(405, '评估需使用 POST /assess。');
      const reference = String(url.searchParams.get('reference') || '').trim();
      if (reference.length > 160 || !/^[a-zA-Z][a-zA-Z'’\-]*(?: [a-zA-Z][a-zA-Z'’\-]*){0,19}$/.test(reference)) throw new HttpError(400, '目标文本必须是英语单词或短句。');
      if (!/^audio\/wav(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw new HttpError(415, '仅接受 PCM WAV 录音。');
      const length = Number(request.headers.get('Content-Length') || 0);
      if (length > MAX_BYTES) throw new HttpError(413, '录音数据超出允许大小。');
      const body = await readLimited(request.body, MAX_BYTES); validateWav(body);
      // Same key for all authenticated calls: rate limiting does not trust spoofable IP headers.
      const { success } = await env.ASSESSMENT_RATE_LIMITER.limit({ key: 'assessment-owner' });
      if (!success) throw new HttpError(429, '评估请求过于频繁，请稍后再试。');
      const target = new URL(config.endpoint + '/stt/speech/recognition/conversation/cognitiveservices/v1');
      target.searchParams.set('language', 'en-US'); target.searchParams.set('format', 'detailed');
      const params = { ReferenceText: reference, GradingSystem: 'HundredMark', Granularity: 'Phoneme', Dimension: 'Comprehensive', EnableMiscue: 'True', EnableProsodyAssessment: 'True' };
      const utf8 = new TextEncoder().encode(JSON.stringify(params));
      const encoded = btoa(Array.from(utf8, b => String.fromCharCode(b)).join(''));
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      let data;
      try {
        const upstream = await fetch(target, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': env.SPEECH_KEY, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', 'Accept': 'application/json', 'Pronunciation-Assessment': encoded }, body, signal: controller.signal, redirect: 'error' });
        if (!upstream.ok) throw new HttpError(upstream.status === 429 ? 429 : 502, upstream.status === 429 ? '评估服务额度不足或请求过快，请稍后再试。' : '评估服务暂不可用，请管理员检查服务配置。');
        data = JSON.parse(new TextDecoder().decode(await readLimited(upstream.body, 2 * 1024 * 1024)));
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? '在线发音评估超时，请重试。' : '评估服务响应异常，请稍后重试。');
      } finally { clearTimeout(timer); }
      return Response.json(normalizeAzureResult(data, reference), { headers });
    } catch (err) {
      return Response.json({ error: err instanceof HttpError ? err.message : '评估后端配置或响应异常。' }, { status: err instanceof HttpError ? err.status : 503, headers });
    }
  }
};
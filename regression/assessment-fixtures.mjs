// Synthetic audio and provider responses: contract tests, not real pronunciation scores.
export const origin = 'https://adrian0314.github.io';
export const token = 'test-access-token-0123456789abcdef';
export const env = { TENCENT_SECRET_ID: 'test-secret-id-0123456789', TENCENT_SECRET_KEY: 'test-secret-key-0123456789', ASSESSMENT_ACCESS_TOKEN: token, ALLOWED_ORIGIN: origin, ASSESSMENT_RATE_LIMITER: { limit: async () => ({ success: true }) } };
export function wav(seconds = 1, silent = false) {
  const data = new ArrayBuffer(44 + 32000 * seconds), v = new DataView(data);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) [...text].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  v.setUint32(4, data.byteLength - 8, true); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); v.setUint32(40, data.byteLength - 44, true);
  if (!silent) for (let i = 44; i < data.byteLength; i += 2) v.setInt16(i, Math.round(Math.sin(i / 16) * 4000), true);
  return data;
}
export function request({ method = 'POST', source = origin, auth = token, body = wav(), reference = 'prestige', path = '/assess', contentType = 'audio/wav', signal } = {}) {
  return new Request('https://function.test' + path + '?reference=' + encodeURIComponent(reference), { method, headers: { Origin: source, Authorization: 'Bearer ' + auth, 'Content-Type': contentType }, ...(method === 'POST' ? { body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } : {}), ...(signal ? { signal } : {}) });
}
export const result = { Response: { Status: 'Finished', PronAccuracy: 86, SuggestedScore: 84, PronFluency: 0.9, PronCompletion: 1, RequestId: 'mock-request', Words: [{ Word: 'prestige', PronAccuracy: 86, MatchTag: 0, PhoneInfos: [{ Phone: 'p', PronAccuracy: 94, Stress: false, DetectedStress: false }, { Phone: 'r', PronAccuracy: 55, Stress: true, DetectedStress: false }] }] } };

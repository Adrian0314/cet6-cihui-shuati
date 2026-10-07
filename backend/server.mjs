import { createServer } from 'node:http';
import { webcrypto } from 'node:crypto';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import assessment from './pronunciation-worker.js';

globalThis.crypto ||= webcrypto;
export function createInstanceRateLimiter(limit = 10, periodMs = 60000, clock = Date.now) {
  let started = clock(), count = 0;
  return { async limit() {
    const now = clock(); if (now - started >= periodMs) { started = now; count = 0; }
    return { success: ++count <= limit };
  } };
}
export function createAssessmentServer(config = process.env) {
  const env = { ...config, ALLOWED_ORIGIN: config.ALLOWED_ORIGIN || 'https://adrian0314.github.io', ASSESSMENT_RATE_LIMITER: config.ASSESSMENT_RATE_LIMITER || createInstanceRateLimiter() };
  const server = createServer(async (req, res) => {
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      // Do not buffer an unchecked upload; the shared handler enforces the WAV size limit.
      const request = new Request(new URL(req.url, 'http://assessment.local'), { method: req.method, headers, signal: controller.signal, ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
      const response = await assessment.fetch(request, env);
      if (controller.signal.aborted) return;
      const bytes = new Uint8Array(await response.arrayBuffer());
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(bytes);
      if (!req.readableEnded) req.resume();
    } catch {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: '请求格式无效，请重试。' }));
      } else res.destroy();
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 9000);
  createAssessmentServer().listen(port, '0.0.0.0', () => console.info('CET6 Tencent assessment backend listening on port ' + port));
}

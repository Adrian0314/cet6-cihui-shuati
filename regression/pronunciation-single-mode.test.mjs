import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = file => readFile(resolve(root, file), 'utf8');

test('practice has one capture-and-recognition path without service settings', async () => {
  const html = await source('cet6_quiz.html');
  const audio = await source('pronunciation-audio.js');
  assert.equal(/ppEngOnline|ppEngVosk|ppOnline|ppAssessment|pronunciation-(assessment|config)/.test(html), false);
  assert.equal(/ppEngineGet|ppAssessOnline|ppRecognizeOfflineTake|ppClearAssessment|Authorization|audio\/wav/.test(audio), false);
  assert.match(audio, /ppTranscribePCM\(pcm, rate, token, model\)/);
});

test('retired cloud deployment and frontend assets are removed', async () => {
  for (const path of ['backend', 'pronunciation-config.js', 'pronunciation-assessment.js', 'pronunciation-assessment.css', '发音评估双模式部署说明-20261007.md', '离线识别接入说明-vosk-20261006.md']) {
    await assert.rejects(access(resolve(root, path)), { code: 'ENOENT' });
  }
  const sw = await source('sw.js');
  assert.equal(/pronunciation-(assessment|config)/.test(sw), false);
  assert.match(sw, /var CACHE_NAME = 'cet6-cihui-shuati-v\d+';/);
});

test('public descriptions do not advertise alternate connectivity modes', async () => {
  for (const file of ['README.md', 'cet6_quiz.html', 'pronunciation-audio.js', 'word-maps-viewer.html', 'word-maps-viewer-offline.html', '发音练习使用说明.md']) {
    const text = await source(file);
    assert.equal(/离线|在线评估|线上评估|双模式|腾讯云|Azure|国内在线/.test(text), false, file);
  }
});


test('single-file viewer contains unchanged dictionary and map data', async () => {
  const viewer = (await source('word-maps-viewer-offline.html')).replace(/\r\n/g, '\n');
  for (const file of ['core-words.js', 'unit-maps.js']) {
    assert.ok(viewer.includes((await source(file)).replace(/\r\n/g, '\n')), file);
  }
});

test('cache migration clears previous interface assets but preserves recognition resources', async () => {
  const { runInNewContext } = await import('node:vm');
  const handlers = {}, removed = [];
  const modelCache = 'cet6-vosk-model-small-en-us-0.15';
  const sw = await source('sw.js');
  const currentCache = sw.match(/var CACHE_NAME = '([^']+)'/)[1];
  const currentVersion = Number(currentCache.match(/-v(\d+)$/)[1]);
  const previousCache = currentCache.replace(/-v\d+$/, '-v' + (currentVersion - 1));
  runInNewContext(sw, {
    self: {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      clients: { claim() {} },
      location: { origin: 'https://example.test' }
    },
    caches: {
      keys: async () => [previousCache, currentCache, modelCache],
      delete: async name => { removed.push(name); }
    },
    URL
  });
  let finished;
  handlers.activate({ waitUntil: promise => { finished = promise; } });
  await finished;
  assert.deepEqual(removed, [previousCache]);
  for (const url of [
    'https://example.test/vosk/vosk-model-small-en-us-0.15.tar.gz',
    'https://external.test/resource.js'
  ]) {
    let intercepted = false;
    handlers.fetch({ request: { method: 'GET', url }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, url);
  }
});

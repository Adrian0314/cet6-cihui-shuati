import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { chromium } from '@playwright/test';
import { loadRevisions } from '../scripts/mnemonic-maintenance.mjs';

const root = resolve(import.meta.dirname, '..');
const manifest = await loadRevisions();
const cruiseMemo = manifest.revisions.find(item => item.word === 'cruise').memo;
let server, browser, base;
before(async () => {
  server = createServer(async (req, res) => {
    try {
      const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      const rel = relative(root, path);
      if (rel.startsWith('..') || resolve(root, rel) !== path) throw Error('outside root');
      const body = await readFile(path);
      res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' })[extname(path)] || 'application/octet-stream');
      res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function open(onPage = () => {}) {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  onPage(page);
  await page.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  await page.goto(base + '/cet6_quiz.html');
  await page.evaluate(() => { speechSynthesis.cancel(); window.speakWord = () => {}; });
  return page;
}

test('word browser query shows the corrected cruise mnemonic in both pools using the actual dictionary script', async () => {
  let fullRequests = 0;
  const page = await open(page => {
    page.on('request', req => { if (new URL(req.url()).pathname.endsWith('/full-words.js')) fullRequests++; });
  });
  try {
    await page.locator('.tab-btn[data-tab="browse"]').click();
    await page.locator('#browseSearch').fill('cruise');
    await page.locator('#bdbtn-cruise').click();
    assert.ok((await page.locator('#bd-cruise').innerText()).includes(cruiseMemo));
    await page.locator('#browsePoolFull').click();
    await page.waitForFunction(() => Array.isArray(FULL_WORDS) && FULL_WORDS.length === 3324);
    await page.locator('#bdbtn-cruise').click();
    assert.ok((await page.locator('#bd-cruise').innerText()).includes(cruiseMemo));
    assert.ok(fullRequests >= 1, 'full dictionary loaded from its actual script');
  } finally { await page.close(); }
});

test('all repaired entries render their reviewed mnemonic without losing example and derivative sections', async () => {
  const page = await open();
  try {
    await page.evaluate(() => new Promise(resolve => ensureFullWords(resolve)));
    const failures = await page.evaluate(revisions => {
      const errors = [];
      for (const revision of revisions) {
        for (const [pool, words] of [['core', ALL_WORDS], ['full', FULL_WORDS]]) {
          for (const word of words.filter(item => item.word === revision.word)) {
            const box = document.createElement('div');
            box.innerHTML = getWordDetailHTML(word, pool);
            if (!box.textContent.includes(revision.memo)) errors.push(`${pool}:${revision.word}:memo`);
            if (word.example && !box.textContent.includes('例句')) errors.push(`${pool}:${revision.word}:example`);
            if (word.derivative && /[a-z]/i.test(word.derivative) && !box.textContent.includes('派生')) errors.push(`${pool}:${revision.word}:derivative`);
          }
        }
      }
      return errors;
    }, manifest.revisions);
    assert.deepEqual(failures, []);
  } finally { await page.close(); }
});

test('answering a cruise quiz question shows the new mnemonic through the real feedback flow', async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      currentPool = 'core'; currentQuizType = 'choice';
      const word = ALL_WORDS.find(item => item.word === 'cruise');
      buildQuiz('en2cn', [word]);
      advanceQuestion();
      renderAll();
    });
    const correct = await page.evaluate(() => quizState.current.correctIndex);
    await page.locator('#opt-' + correct).click();
    assert.ok((await page.locator('#quizCard').innerText()).includes(cruiseMemo));
    assert.doesNotMatch(await page.locator('#quizCard').innerText(), /克鲁兹|画十字/);
  } finally { await page.close(); }
});

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const QUIZ_URL = pathToFileURL(resolve(process.cwd(), 'cet6_quiz.html')).href;

async function openTtsPage(browser, audioMode) {
  const context = await browser.newContext();
  await context.addInitScript((mode) => {
    window.__ttsTest = { audioUrls: [], audioInstances: [], systemSpeakCount: 0, systemCancelCount: 0, audioMode: mode };
    window.Audio = class {
      constructor(url) {
        if (window.__ttsTest.audioMode === 'constructor-error') throw new Error('Audio unavailable');
        this.src = url;
        this.currentTime = 0;
        this.paused = true;
        this.preload = '';
        window.__ttsTest.audioUrls.push(url);
        window.__ttsTest.audioInstances.push(this);
      }
      play() {
        this.paused = false;
        if (window.__ttsTest.audioMode === 'error') {
          if (this.onerror) this.onerror();
          return Promise.reject(new Error('audio unavailable'));
        }
        if (this.onplaying) this.onplaying();
        return Promise.resolve();
      }
      pause() { this.paused = true; }
      end() { this.paused = true; if (this.onended) this.onended(); }
    };
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [{ lang: 'en-US' }],
        cancel: () => { window.__ttsTest.systemCancelCount++; },
        speak: () => { window.__ttsTest.systemSpeakCount++; }
      }
    });
    if (mode === 'offline') {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    }
    window.SpeechSynthesisUtterance = function(text) { this.text = text; };
    localStorage.setItem('cet6_onboarded', '1');
  }, audioMode);
  const page = await context.newPage();
  await page.goto(QUIZ_URL);
  await page.waitForLoadState('domcontentloaded');
  return { context, page };
}

test('word pronunciation uses media audio before system TTS', async ({ browser }) => {
  const { context, page } = await openTtsPage(browser, 'success');

  await page.evaluate(() => speakWord('ambition'));

  const tts = await page.evaluate(() => window.__ttsTest);
  expect(tts.audioUrls).toHaveLength(1);
  expect(tts.audioUrls[0]).toContain('dict.youdao.com/dictvoice?audio=ambition');
  expect(tts.systemSpeakCount).toBe(0);

  await context.close();
});

test('word pronunciation falls back to system TTS when media audio cannot play', async ({ browser }) => {
  const { context, page } = await openTtsPage(browser, 'error');

  await page.evaluate(() => speakWord('ambition'));
  await page.waitForFunction(() => window.__ttsTest.systemSpeakCount === 1);

  const tts = await page.evaluate(() => window.__ttsTest);
  expect(tts.audioUrls).toHaveLength(1);
  expect(tts.systemSpeakCount).toBe(1);

  await context.close();
});

test('completed media pronunciation does not trigger a delayed system TTS fallback', async ({ browser }) => {
  const { context, page } = await openTtsPage(browser, 'success');

  await page.evaluate(() => speakWord('ambition'));
  await page.evaluate(() => window.__ttsTest.audioInstances[0].end());
  await page.waitForTimeout(2600);

  const tts = await page.evaluate(() => window.__ttsTest);
  expect(tts.systemSpeakCount).toBe(0);

  await context.close();
});

test('offline pronunciation uses system TTS without waiting for network audio', async ({ browser }) => {
  const { context, page } = await openTtsPage(browser, 'offline');

  await page.evaluate(() => speakWord('ambition'));

  const tts = await page.evaluate(() => window.__ttsTest);
  expect(tts.audioUrls).toHaveLength(0);
  expect(tts.systemSpeakCount).toBe(1);

  await context.close();
});

test('a media audio construction failure falls back to system TTS only once', async ({ browser }) => {
  const { context, page } = await openTtsPage(browser, 'constructor-error');

  await page.evaluate(() => speakWord('ambition'));
  await page.waitForTimeout(1700);

  const tts = await page.evaluate(() => window.__ttsTest);
  expect(tts.systemSpeakCount).toBe(1);

  await context.close();
});

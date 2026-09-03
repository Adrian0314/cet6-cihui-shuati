import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const QUIZ_URL = pathToFileURL(resolve(process.cwd(), 'cet6_quiz.html')).href;

test('regular quiz persists queue and answer before a mobile lifecycle exit', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();

  await page.goto(QUIZ_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Array.isArray(window.ALL_WORDS) && ALL_WORDS.length > 0);
  await page.evaluate(() => {
    currentPool = 'core';
    updatePoolUI();
    savePrefs();
  });
  await page.selectOption('#gateSelect', '2');
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');

  const initial = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('cet6_quiz_app_v2') || 'null');
    return saved && saved.suspendedQuiz;
  });
  expect(initial).toEqual(expect.objectContaining({ pos: 0, done: 0, currentId: expect.any(Number) }));
  expect(initial.ids.length).toBeGreaterThan(0);

  await page.evaluate(() => handleAnswer(quizState.current.correctIndex));
  const answered = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('cet6_quiz_app_v2') || 'null');
    return saved && saved.suspendedQuiz;
  });
  expect(answered).toEqual(expect.objectContaining({ pos: 0, done: 1, currentId: initial.currentId }));
  expect(answered.answers).toHaveProperty('0');

  // pagehide is the fallback used when the mobile browser leaves the page.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#savedBar')).toHaveClass(/show/);
  await page.click('#savedBar button[onclick="resumeQuiz()"]');
  await page.waitForFunction(() => quizActive && quizState.current);
  const resumed = await page.evaluate(() => ({
    pos: quizState.pos,
    done: quizState.done,
    currentId: quizState.current.word.id,
    answer: quizState.answers[0]
  }));
  expect(resumed).toEqual({ pos: 0, done: 1, currentId: initial.currentId, answer: answered.answers['0'] });

  await context.close();
});

test('visibilitychange saves the active quiz when a mobile tab is backgrounded', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();

  await page.goto(QUIZ_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Array.isArray(window.ALL_WORDS) && ALL_WORDS.length > 0);
  await page.evaluate(() => {
    currentPool = 'core';
    updatePoolUI();
    savePrefs();
  });
  await page.selectOption('#gateSelect', '2');
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');

  const currentId = await page.evaluate(() => quizState.current.word.id);
  await page.evaluate(() => {
    state.suspendedQuiz = null;
    saveState();
    // `document.hidden` is normally read-only; overriding it in the test
    // lets us exercise the same branch used when a phone backgrounds a tab.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cet6_quiz_app_v2') || 'null').suspendedQuiz);
  expect(saved).toEqual(expect.objectContaining({ pos: 0, done: 0, currentId }));

  await context.close();
});

test('resume waits for an asynchronously loading full vocabulary pool', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();

  await page.goto(QUIZ_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Array.isArray(window.FULL_WORDS) && FULL_WORDS.length > 0, null, { timeout: 15000 });
  await page.evaluate(() => {
    currentPool = 'full';
    updatePoolUI();
    savePrefs();
  });
  await page.selectOption('#gateSelect', '2');
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');

  const snapshot = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('cet6_quiz_app_v2') || 'null');
    quizActive = false;
    return saved.suspendedQuiz;
  });
  expect(snapshot.poolType).toBe('full');

  const waiting = await page.evaluate(() => {
    _fullWordsLoaded = false;
    window._resumeQuizLoading = false;
    checkSuspendedQuiz();
    window.__resumeWordsReady = null;
    window.ensureFullWords = function(cb) { window.__resumeWordsReady = cb; };
    resumeQuiz();
    const btn = document.querySelector('#savedBar button[onclick="resumeQuiz()"]');
    return {
      disabled: !!(btn && btn.disabled),
      savedId: state.suspendedQuiz && state.suspendedQuiz.currentId,
      callbackQueued: typeof window.__resumeWordsReady === 'function'
    };
  });
  expect(waiting).toEqual({ disabled: true, savedId: snapshot.currentId, callbackQueued: true });

  await page.evaluate(() => {
    _fullWordsLoaded = true;
    window.__resumeWordsReady();
  });
  await page.waitForFunction(() => quizActive && quizState.current);
  await expect(page.locator('.opt-btn')).toHaveCount(4);

  await context.close();
});

test('start review waits for an asynchronously loading full vocabulary pool', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();

  await page.goto(QUIZ_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Array.isArray(window.FULL_WORDS) && FULL_WORDS.length > 0, null, { timeout: 15000 });
  await page.evaluate(() => {
    currentPool = 'full';
    updatePoolUI();
    const w = FULL_WORDS[0];
    state.stats.wordAttempts['full:' + w.id] = {
      attempts: 1,
      correct: 1,
      wrong: 0,
      learnedAt: Date.now() - 10 * 60 * 1000,
      grid: [0, 0, 0, 0, 0, 0, 0]
    };
    savePrefs();
    saveState();
    quizActive = false;
    renderReviewBar();
  });

  const waiting = await page.evaluate(() => {
    _fullWordsLoaded = false;
    window._startReviewLoading = false;
    window.__reviewWordsReady = null;
    window.ensureFullWords = function(cb) { window.__reviewWordsReady = cb; };
    startReview();
    const btn = document.querySelector('#reviewBar button[onclick="startReview()"]');
    return {
      disabled: !!(btn && btn.disabled),
      callbackQueued: typeof window.__reviewWordsReady === 'function',
      active: quizActive
    };
  });
  expect(waiting).toEqual({ disabled: true, callbackQueued: true, active: false });

  await page.evaluate(() => {
    _fullWordsLoaded = true;
    window.__reviewWordsReady();
  });
  await page.waitForFunction(() => quizActive && quizState.current);
  await expect(page.locator('.opt-btn')).toHaveCount(4);

  await context.close();
});

test('refresh preserves an in-progress 4-week plan quiz', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();

  await page.goto(QUIZ_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Array.isArray(window.ALL_WORDS) && ALL_WORDS.length > 0);

  await page.evaluate(() => {
    currentPool = 'core';
    state.ebbingActive = true;
    state.ebbingStart = dayKeyStr(new Date());
    state.ebbingPlan = { day: 1, dayKey: state.ebbingStart, completedUnits: [] };
    saveState();
    startMemoryQuiz('en2cn');
  });
  await page.waitForFunction(() => quizActive && quizState.isEbbingPlan && quizState.current);

  await page.evaluate(() => handleAnswer(quizState.current.correctIndex));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cet6_quiz_app_v2')).suspendedQuiz);
  expect(saved).toEqual(expect.objectContaining({
    isEbbingPlan: true,
    pos: 0,
    done: 1,
    poolType: 'core'
  }));
  expect(saved.ebbingPlanUnits).toEqual([1]);
  expect(saved.ebbingPlanAnswered).toHaveProperty(String(saved.ids[0]), true);
  expect(saved.ebbingPlanRemaining).toHaveProperty('1');

  await expect(page.locator('#savedBar')).toHaveClass(/show/);
  await page.click('#savedBar button[onclick="resumeQuiz()"]');
  await page.waitForFunction(() => quizActive && quizState.current);
  const resumed = await page.evaluate(() => ({
    isEbbingPlan: quizState.isEbbingPlan,
    pos: quizState.pos,
    done: quizState.done,
    currentId: quizState.current.word.id
  }));
  expect(resumed).toEqual({
    isEbbingPlan: true,
    pos: 0,
    done: 1,
    currentId: saved.currentId
  });

  await context.close();
});

test('resuming a 4-week plan review restores the active question', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();

  await page.goto(QUIZ_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Array.isArray(window.ALL_WORDS) && ALL_WORDS.length > 0);

  await page.evaluate(() => {
    currentPool = 'core';
    updatePoolUI();
    savePrefs();
    activateEbbing();
    startReview();
  });
  await page.waitForFunction(() => quizActive && quizState.isReview && quizState.current);

  for (let index = 0; index < 4; index++) {
    await page.evaluate(() => handleAnswer(quizState.current.correctIndex));
    if (index < 3) await page.evaluate(() => advanceQuestion());
  }
  const beforeReload = await page.evaluate(() => ({
    pos: quizState.pos,
    done: quizState.done,
    currentId: quizState.current.word.id
  }));

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.click('#savedBar button[onclick="resumeQuiz()"]');

  await expect(page.locator('.opt-btn')).toHaveCount(4);
  const resumed = await page.evaluate(() => ({
    pos: quizState.pos,
    done: quizState.done,
    currentId: quizState.current.word.id,
    isReview: quizState.isReview,
    isEbbingPlan: quizState.isEbbingPlan
  }));
  expect(resumed).toEqual({
    ...beforeReload,
    isReview: true,
    isEbbingPlan: true
  });

  await context.close();
});

test('starting review resumes an unfinished 4-week plan on the same day', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();

  await page.goto(QUIZ_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Array.isArray(window.ALL_WORDS) && ALL_WORDS.length > 0);

  await page.evaluate(() => {
    currentPool = 'core';
    updatePoolUI();
    savePrefs();
    activateEbbing();
    startReview();
  });
  await page.waitForFunction(() => quizActive && quizState.isReview && quizState.current);

  for (let index = 0; index < 4; index++) {
    await page.evaluate(() => handleAnswer(quizState.current.correctIndex));
    if (index < 3) await page.evaluate(() => advanceQuestion());
  }
  const beforeReload = await page.evaluate(() => ({
    pos: quizState.pos,
    done: quizState.done,
    currentId: quizState.current.word.id
  }));

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#reviewBar')).toHaveClass(/show/);
  await page.click('#reviewBar button[onclick="startReview()"]');

  await expect(page.locator('.opt-btn')).toHaveCount(4);
  const resumed = await page.evaluate(() => ({
    pos: quizState.pos,
    done: quizState.done,
    currentId: quizState.current.word.id,
    isReview: quizState.isReview,
    isEbbingPlan: quizState.isEbbingPlan
  }));
  expect(resumed).toEqual({
    ...beforeReload,
    isReview: true,
    isEbbingPlan: true
  });

  await context.close();
});

test('a previous-day 4-week plan snapshot is not resumed', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();

  await page.goto(QUIZ_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    state.ebbingActive = true;
    state.ebbingStart = '2000-01-01';
    state.ebbingPlan = { day: 1, dayKey: state.ebbingStart, completedUnits: [] };
    state.suspendedQuiz = {
      mode: 'en2cn',
      isReview: true,
      isEbbingPlan: true,
      ids: [1],
      pos: 0,
      answers: {},
      done: 0,
      poolType: 'core'
    };
    saveState();
  });

  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#savedBar')).not.toHaveClass(/show/);
  await expect.poll(() => page.evaluate(() => state.suspendedQuiz)).toBeNull();

  await context.close();
});

test('4-week review reminder shows the saved queue progress', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();

  await page.goto(QUIZ_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Array.isArray(window.ALL_WORDS) && ALL_WORDS.length > 0);

  await page.evaluate(() => {
    currentPool = 'core';
    updatePoolUI();
    savePrefs();
    activateEbbing();
    startReview();
  });
  await page.waitForFunction(() => quizActive && quizState.isReview && quizState.current);
  const total = await page.evaluate(() => quizState.ids.length);

  for (let index = 0; index < 4; index++) {
    await page.evaluate(() => handleAnswer(quizState.current.correctIndex));
    if (index < 3) await page.evaluate(() => advanceQuestion());
  }
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const reminderText = await page.evaluate(() => {
    const existing = document.getElementById('reviewReminderModal');
    if (existing) existing.remove();
    checkSpacedRepetition();
    return document.querySelector('#reviewReminderModal pre').textContent;
  });
  expect(reminderText).toContain('已完成 4 题');
  expect(reminderText).toContain('待完成 ' + (total - 4) + ' 题（共 ' + total + ' 题）');
  expect(reminderText).not.toContain('...还有');

  await context.close();
});

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const QUIZ_URL = pathToFileURL(resolve(process.cwd(), 'cet6_quiz.html')).href;

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

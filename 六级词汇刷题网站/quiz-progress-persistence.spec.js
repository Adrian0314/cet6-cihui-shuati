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

import { test, expect } from '@playwright/test';

const quizUrl = 'file:///C:/Users/zheng/Desktop/%E5%AD%A6%E4%B9%A0%E4%B8%8E%E8%80%83%E8%AF%95/Study/%E8%8B%B1%E8%AF%AD%E5%9B%9B%E5%85%AD%E7%BA%A7/%E5%85%AD%E7%BA%A7%E8%AF%8D%E6%B1%87%E5%88%B7%E9%A2%98%E7%BD%91%E7%AB%99/cet6_quiz.html';

test('fresh visits use the requested memory quiz defaults', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();
  await page.goto(quizUrl);
  await page.waitForLoadState('domcontentloaded');

  const config = await page.evaluate(() => ({
    pool: currentPool,
    gate: gateLevel,
    mode: currentMode,
    type: currentQuizType,
    memory: memoryModeOn(),
    prefs: state.prefs,
    controls: {
      pool: document.getElementById('poolSelect').value,
      gate: document.getElementById('gateSelect').value,
      mode: document.getElementById('modeSelect').value,
      type: document.getElementById('typeSelect').value,
      memoryActive: document.getElementById('memoryBtn').classList.contains('active')
    }
  }));

  expect(config).toEqual({
    pool: 'full',
    gate: 2,
    mode: 'en2cn',
    type: 'choice',
    memory: true,
    prefs: expect.objectContaining({
      pool: 'full',
      gate: 2,
      mode: 'en2cn',
      type: 'choice',
      memory: true
    }),
    controls: {
      pool: 'full',
      gate: '2',
      mode: 'en2cn',
      type: 'choice',
      memoryActive: true
    }
  });

  await context.close();
});

test('the default start action opens an English-to-Chinese choice quiz', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();
  await page.goto(quizUrl);
  await page.waitForLoadState('domcontentloaded');
  await page.click('#startBtn');
  await page.waitForSelector('.opt-btn');

  await expect(page.locator('.opt-btn')).toHaveCount(4);
  await expect(page.locator('.q-label')).toContainText('看英文选中文');
  await expect(page.locator('.q-label')).toContainText('记忆');

  await context.close();
});

test('Ebbinghaus check-in quiz explanations omit the word-group map', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();
  await page.goto(quizUrl);
  await page.waitForLoadState('domcontentloaded');

  const mapHtml = await page.evaluate(() => {
    currentPool = 'full';
    FULL_WORDS = [
      { id: 1, word: 'alpha', unit: 1, lesson: 1, seq: 1, group_id: 1, group_name: 'test' },
      { id: 2, word: 'bravo', unit: 1, lesson: 1, seq: 2, group_id: 1, group_name: 'test' },
      { id: 3, word: 'charlie', unit: 1, lesson: 1, seq: 3, group_id: 1, group_name: 'test' }
    ];
    selectedUnits = [0];
    return groupMapSVG(FULL_WORDS[0]);
  });

  expect(mapHtml).toBe('');

  await context.close();
});

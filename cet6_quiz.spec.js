// Playwright tests for CET-6 Quiz System
// Run with: npx playwright test
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // 预置 localStorage，跳过首次引导浮层，避免遮挡点击
  await page.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  await page.goto('file:///C:/Users/zheng/Desktop/%E5%AD%A6%E4%B9%A0%E4%B8%8E%E8%80%83%E8%AF%95/Study/%E8%8B%B1%E8%AF%AD%E5%9B%9B%E5%85%AD%E7%BA%A7/cet6_quiz.html');
  await page.waitForLoadState('domcontentloaded');
});

test('page loads successfully', async ({ page }) => {
  await expect(page.locator('h1')).toContainText('英语六级词汇');
});

test('start quiz shows options', async ({ page }) => {
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');
  const count = await page.locator('.opt-btn').count();
  expect(count).toBe(4);
});

test('answering a question updates progress', async ({ page }) => {
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');
  await page.locator('.opt-btn').first().click();
  await page.waitForSelector('.next-btn.show');
  const feedback = await page.locator('.feedback.show').textContent();
  expect(feedback).toBeTruthy();
});

test('stats tab loads charts', async ({ page }) => {
  await page.click('button[data-tab="stats-page"]');
  await page.waitForTimeout(500);
  const canvasCount = await page.locator('canvas').count();
  expect(canvasCount).toBeGreaterThan(0);
});

test('browse tab shows word list', async ({ page }) => {
  await page.click('button[data-tab="browse"]');
  await page.waitForSelector('#browseList strong');
  const count = await page.locator('#browseList strong').count();
  expect(count).toBeGreaterThan(0);
});

test('keyboard shortcut 1 selects first option', async ({ page }) => {
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');
  await page.keyboard.press('1');
  await page.waitForSelector('.next-btn.show');
  await expect(page.locator('.feedback.show')).toBeVisible();
});

test('skip button works', async ({ page }) => {
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.skip-btn');
  await page.click('.skip-btn');
  await page.waitForSelector('.next-btn.show');
  await expect(page.locator('#feedback')).toContainText('已跳过');
});

test('tab switching works', async ({ page }) => {
  const tabs = ['wrong', 'retry', 'stats-page', 'browse', 'quiz'];
  for (const tab of tabs) {
    await page.click(`button[data-tab="${tab}"]`);
    await page.waitForTimeout(200);
    await expect(page.locator(`#tab-${tab}`)).toBeVisible();
  }
});

test('fullscreen button text stays correct after re-render', async ({ page }) => {
  // 进入答题
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');
  await page.waitForTimeout(400); // 等选项入场动画结束
  await expect(page.locator('#toggleFsBtn')).toContainText('全屏');

  // 点击进入全屏 → 按钮文字应为「退出全屏」
  await page.click('#toggleFsBtn');
  await expect(page.locator('#toggleFsBtn')).toContainText('退出全屏');
  await expect(page.locator('#quizCard')).toHaveClass(/fullscreen/);

  // 答题 → 下一题（触发 renderQuizCard 重建按钮）→ 文字不应回退为「全屏」
  await page.locator('.opt-btn').first().click();
  await page.waitForSelector('.next-btn.show');
  await page.click('.next-btn');
  await page.waitForSelector('.opt-btn');
  await page.waitForTimeout(400); // 等新题选项入场动画结束
  await expect(page.locator('#toggleFsBtn')).toContainText('退出全屏');
  await expect(page.locator('#quizCard')).toHaveClass(/fullscreen/);

  // 再次点击 → 退出全屏 → 文字变回「全屏」
  await page.click('#toggleFsBtn');
  await expect(page.locator('#toggleFsBtn')).toContainText('全屏');
  await expect(page.locator('#quizCard')).not.toHaveClass(/fullscreen/);
});

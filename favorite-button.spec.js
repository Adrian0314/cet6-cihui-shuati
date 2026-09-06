import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const quizUrl = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), 'cet6_quiz.html')).href;

test('favorite button is beside the word information and toggles with the current question', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  const page = await context.newPage();
  await page.goto(quizUrl);
  await page.waitForLoadState('domcontentloaded');

  if (await page.locator('#memoryBtn').evaluate((button) => button.classList.contains('active'))) {
    await page.click('#memoryBtn');
  }
  await page.click('#startBtn');
  const favorite = page.locator('.word-info-actions [data-favorite-toggle]');
  await expect(favorite).toHaveCount(1);
  await expect(page.locator('.quiz-top-row [data-favorite-toggle]')).toHaveCount(0);
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');

  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await expect(favorite).toHaveText('★ 已标记');

  const firstKey = await favorite.getAttribute('data-favorite-key');
  await page.click('#nextQBtn');
  const nextFavorite = page.locator('.word-info-actions [data-favorite-toggle]');
  await expect(nextFavorite).toHaveCount(1);
  await expect(nextFavorite).not.toHaveAttribute('data-favorite-key', firstKey);
  await expect(nextFavorite).toHaveAttribute('aria-pressed', 'false');

  await nextFavorite.click();
  await expect(nextFavorite).toHaveAttribute('aria-pressed', 'true');
  await nextFavorite.click();
  await expect(nextFavorite).toHaveAttribute('aria-pressed', 'false');

  await context.close();
});

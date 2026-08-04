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

test('heatmap renders with range switch and tooltip', async ({ page }) => {
  // 注入一天学习数据（今天：10题，9对，达标）
  await page.evaluate(() => {
    const k = 'cet6_quiz_app_v2';
    let st = {};
    try { st = JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) {}
    st.stats = st.stats || {};
    st.stats.dailyHistory = st.stats.dailyHistory || {};
    const today = new Date().toISOString().split('T')[0];
    st.stats.dailyHistory[today] = { attempts: 10, correct: 9, wrong: 1 };
    st.dailyGoal = 10; // 与注入的 10 题匹配，让今天达标
    localStorage.setItem(k, JSON.stringify(st));
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await page.click('button[data-tab="stats-page"]');
  await page.waitForTimeout(300);
  const canvas = page.locator('#heatmapChart');
  await expect(canvas).toBeVisible();
  const dims = await canvas.evaluate(c => ({ w: c.width, h: c.height }));
  expect(dims.w).toBeGreaterThan(200);
  expect(dims.h).toBe(200);

  // 范围切换按钮工作
  await page.click('.hm-range[data-days="30"]');
  await expect(page.locator('.hm-range.active')).toHaveAttribute('data-days', '30');
  await page.click('.hm-range[data-days="365"]');
  await expect(page.locator('.hm-range.active')).toHaveAttribute('data-days', '365');
  await page.click('.hm-range[data-days="90"]');
  await expect(page.locator('.hm-range.active')).toHaveAttribute('data-days', '90');

  // 点击今天格子 → tooltip 显示：做题数/正确率/达标/连续打卡
  const box = await canvas.boundingBox();
  const pos = await canvas.evaluate(() => {
    const today = new Date().toISOString().split('T')[0];
    for (const cell of _heatCells) {
      if (cell.date === today) return { x: cell.x + cell.size / 2, y: cell.y + cell.size / 2 };
    }
    return null;
  });
  expect(pos).not.toBeNull();
  await page.mouse.click(box.x + pos.x, box.y + pos.y);
  await expect(page.locator('#heatmapTip')).toBeVisible();
  await expect(page.locator('#heatmapTip')).toContainText('做题 10 题');
  await expect(page.locator('#heatmapTip')).toContainText('正确率 90%');
  await expect(page.locator('#heatmapTip')).toContainText('已达标');
  await expect(page.locator('#heatmapTip')).toContainText('连续打卡 1 天');

  // 点击 canvas 外部（标题）→ tooltip 隐藏
  await page.locator('h2:has-text("学习热力图")').click();
  await expect(page.locator('#heatmapTip')).toBeHidden();
});

test('multi-POS words render uniform POS badges', async ({ page }) => {
  // splitMeaning 解析逻辑：多词性 / 联合词性 / 中间夹音标
  const r1 = await page.evaluate(() => splitMeaning('n.手指 v.告发，拨弄'));
  expect(r1).toEqual([{ pos: 'n.', cn: '手指' }, { pos: 'v.', cn: '告发，拨弄' }]);
  const r2 = await page.evaluate(() => splitMeaning('v./n. 辩论，讨论'));
  expect(r2).toEqual([{ pos: 'v./n.', cn: '辩论，讨论' }]);
  const r3 = await page.evaluate(() => splitMeaning("n.影响 /ɪm'pækt/ v.有影响"));
  expect(r3).toEqual([{ pos: 'n.', cn: '影响' }, { pos: 'v.', cn: '有影响' }]);

  // 题目渲染：多词性单词的每个词性都有 badge
  const badgeCount = await page.evaluate(() => {
    const w = ALL_WORDS.find(x => (x.meaning.match(/[a-z]+\./g) || []).length > 1);
    const entries = splitMeaning(w.meaning);
    const html = entries.map(e => (e.pos ? '<span class="pos-badge">' + e.pos + '</span>' : '') + e.cn).join(' ');
    return (html.match(/pos-badge/g) || []).length;
  });
  expect(badgeCount).toBeGreaterThan(1);
});

test('wrong answer shows picked word meaning with speak button', async ({ page }) => {
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');
  await page.waitForTimeout(400); // 等选项入场动画

  // 故意答错：点击正确选项之外的一项
  const wrongIdx = await page.evaluate(() => {
    const ci = quizState.current.correctIndex;
    return (ci + 1) % 4;
  });
  await page.click(`#opt-${wrongIdx}`);
  await page.waitForSelector('.next-btn.show');

  const fb = page.locator('.feedback.show');
  await expect(fb).toContainText('回答错误');
  await expect(fb).toContainText('你选的答案');
  // "你选的答案"行里有朗读按钮，且中文释义非空
  const pickRow = fb.locator('div:has-text("你选的答案")').first();
  await expect(pickRow).toBeVisible();
  const speakCount = await pickRow.locator('span[onclick*="speakWord"]').count();
  expect(speakCount).toBe(1);
  const pickText = await pickRow.textContent();
  expect(pickText.replace('你选的答案：', '').trim().length).toBeGreaterThan(0);
});

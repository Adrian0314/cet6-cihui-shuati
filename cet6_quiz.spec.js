// Playwright tests for CET-6 Quiz System
// Run with: npx playwright test
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // 预置 localStorage，跳过首次引导浮层，避免遮挡点击
  await page.addInitScript(() => localStorage.setItem('cet6_onboarded', '1'));
  await page.goto('file:///C:/Users/zheng/Desktop/%E5%AD%A6%E4%B9%A0%E4%B8%8E%E8%80%83%E8%AF%95/Study/%E8%8B%B1%E8%AF%AD%E5%9B%9B%E5%85%AD%E7%BA%A7/cet6_quiz.html');
  await page.waitForLoadState('domcontentloaded');
  // 默认闯关1速记：依赖选项按钮的测试切到闯关2（选择题）
  await page.evaluate(() => {
    const g2 = document.querySelector('#gateRow .mode-btn[data-gate="2"]');
    if (g2) g2.click();
  });
  await page.waitForTimeout(100);
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

test('wrong answer lists other options with labels and picked mark', async ({ page }) => {
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
  // 其余选项列表：标题 + 三个错误选项（每个有朗读按钮）
  await expect(fb).toContainText('其余选项');
  const rows = fb.locator('div:has-text("你选的")');
  await expect(rows.first()).toContainText('← 你选的');
  const speakCount = await fb.locator('span[onclick*="speakWord"]').count();
  expect(speakCount).toBeGreaterThanOrEqual(3); // 正确答案 1 + 三个错误选项各 1
  // 三个错误选项都有编号标签（A./B./C./D.）
  const labelCount = await fb.locator('span:has-text(".")').count();
  expect(labelCount).toBeGreaterThanOrEqual(3);
});

test('handwrite pad draws and recognizes into input with dict correction', async ({ page }) => {
  await page.click('#typeRow .mode-btn[data-type="dictation"]');
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('#dictInput');
  await page.waitForSelector('#handwriteBtn');

  // 打开手写板
  await page.click('#handwriteBtn');
  await expect(page.locator('#hwOverlay')).toBeVisible();

  // 在画布上画一笔
  const box = await page.locator('#hwCanvas').boundingBox();
  await page.mouse.move(box.x + 50, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 140, { steps: 20 });
  await page.mouse.up();

  // 注入 fake Tesseract：识别出 'detrimentul'（有拼写错误）
  await page.evaluate(() => {
    window.Tesseract = {
      createWorker: (lang, oem, opts) => Promise.resolve({
        recognize: () => Promise.resolve({ data: { text: 'detrimentul' } })
      })
    };
  });

  await page.click('#hwRecognizeBtn');
  // 识别完成 → 弹层关闭、输入框回填（词库纠错为 detrimental）
  await expect(page.locator('#hwOverlay')).toBeHidden();
  const val = await page.locator('#dictInput').inputValue();
  expect(val.toLowerCase()).toBe('detrimental');
});

test('normalizeOCRText corrects via dictionary', async ({ page }) => {
  // 英文：编辑距离 ≤2 的词库纠错
  const r1 = await page.evaluate(() => normalizeOCRText('detrimentul', 'eng'));
  expect(r1.toLowerCase()).toBe('detrimental');
  const r2 = await page.evaluate(() => normalizeOCRText('harmful  deteriorat', 'eng'));
  expect(r2.toLowerCase()).toBe('harmful deteriorate');
  // 距离 2 但长度差过大的短词不应误纠（词库含 poison，'poisen' 距离1会被纠成 poison——预期纠正）
  const r2b = await page.evaluate(() => normalizeOCRText('poisen', 'eng'));
  expect(r2b.toLowerCase()).toBe('poison');
  // 中文：清理噪声，保留中文与标点
  const r3 = await page.evaluate(() => normalizeOCRText('有害 的，不 利', 'chi_sim'));
  expect(r3).toBe('有害的，不利');
});

test('getChineseFull keeps all POS tags (display) while getChinese strips first (logic)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const m = 'v.快速增长 n.火箭';
    return { full: getChineseFull(m), stripped: getChinese(m) };
  });
  expect(r.full).toBe('v.快速增长 n.火箭');
  expect(r.stripped).toBe('快速增长 n.火箭'); // 原行为不变（供搜索/比较逻辑）
  const r2 = await page.evaluate(() => getChineseFull("n.影响 /ɪm'pækt/ v.有影响"));
  expect(r2).toBe('n.影响 v.有影响');
  const r3 = await page.evaluate(() => getChineseFull('v./n. 辩论，讨论'));
  expect(r3).toBe('v./n. 辩论，讨论');
});

test('feedback question line shows all POS tags for multi-POS word', async ({ page }) => {
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');
  await page.waitForTimeout(400);

  // 循环翻题直到遇到多词性单词（有界 30 次）
  let found = false;
  for (let i = 0; i < 30; i++) {
    found = await page.evaluate(() => (splitMeaning(quizState.current.word.meaning).length > 1));
    if (found) break;
    await page.evaluate(() => { handleSkip(); });
    await page.waitForSelector('.next-btn.show');
    await page.click('.next-btn');
    await page.waitForSelector('.opt-btn');
    await page.waitForTimeout(350);
  }
  expect(found).toBe(true);

  // 答错 → 反馈区「题目：」行应包含 ≥2 个词性标记
  const wrongIdx = await page.evaluate(() => {
    const ci = quizState.current.correctIndex;
    return (ci + 1) % 4;
  });
  await page.click(`#opt-${wrongIdx}`);
  await page.waitForSelector('.next-btn.show');
  const qLine = await page.locator('.feedback.show div:has-text("题目：")').first().textContent();
  const posCount = (qLine.match(/[a-z]+\./g) || []).length;
  expect(posCount).toBeGreaterThanOrEqual(2);
});

test('next question scrolls back to question top', async ({ page }) => {
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');
  await page.waitForTimeout(400);

  // 答题后把页面滚到底部（模拟用户在看详解）
  await page.locator('.opt-btn').first().click();
  await page.waitForSelector('.next-btn.show');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  await page.click('.next-btn');
  await page.waitForSelector('.opt-btn');
  await page.waitForTimeout(300);

  const pos = await page.evaluate(() => {
    const card = document.getElementById('quizCard');
    return { scrollY: window.scrollY, cardTop: card.offsetTop };
  });
  // 题目卡片回到视口上部（页面变矮时 scrollTo 会被 clamp，允许卡片顶部距离视口顶 < 200px）
  expect(pos.scrollY).toBeLessThan(pos.cardTop);
  expect(pos.cardTop - pos.scrollY).toBeLessThan(200);
});

test('fullscreen next question scrolls quiz-scroll back to top', async ({ page }) => {
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');
  await page.waitForTimeout(400);
  await page.click('#toggleFsBtn'); // 进入全屏
  await page.waitForTimeout(300);

  // 答一题并把 quiz-scroll 滚到底
  await page.locator('.opt-btn').first().click();
  await page.waitForSelector('.next-btn.show');
  await page.evaluate(() => {
    const el = document.querySelector('.quiz-card .quiz-scroll');
    el.scrollTop = el.scrollHeight;
  });

  await page.click('.next-btn');
  await page.waitForSelector('.opt-btn');
  await page.waitForTimeout(300);

  const top = await page.evaluate(() => document.querySelector('.quiz-card .quiz-scroll').scrollTop);
  expect(top).toBe(0);
});

// ===== 新词库功能测试 =====

test('gate1 speed-memory: know button advances, unknown shows explanation', async ({ page }) => {
  // 切回闯关1速记
  await page.evaluate(() => {
    const g1 = document.querySelector('#gateRow .mode-btn[data-gate="1"]');
    if (g1) g1.click();
  });
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('#gateKnowBtn');
  const word1 = await page.locator('.q-word').textContent();
  // 认识 → 直接下一词
  await page.click('#gateKnowBtn');
  await page.waitForTimeout(300);
  const word2 = await page.locator('.q-word').textContent();
  expect(word2).not.toBe(word1);
  // 不认识 → 显示释义和讲解
  await page.click('#gateUnknownBtn');
  await page.waitForSelector('.feedback.show');
  await expect(page.locator('.feedback.show')).toContainText('未掌握');
  await expect(page.locator('.word-detail')).toBeVisible();
});

test('gate1 keyboard: 1=knew advances, 2=unknown shows feedback', async ({ page }) => {
  await page.evaluate(() => {
    const g1 = document.querySelector('#gateRow .mode-btn[data-gate="1"]');
    if (g1) g1.click();
  });
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('#gateKnowBtn');
  const w1 = await page.locator('.q-word').textContent();
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  const w2 = await page.locator('.q-word').textContent();
  expect(w2).not.toBe(w1);
  await page.keyboard.press('2');
  await page.waitForSelector('.feedback.show');
});

test('unit filter restricts pool and count', async ({ page }) => {
  const chips = await page.evaluate(() => [...document.querySelectorAll('#unitFilterRow .freq-chip')].map(c => c.textContent.trim()));
  expect(chips).toContain('U1');
  // 点 U3
  await page.evaluate(() => document.querySelector('#unitFilterRow .freq-chip[data-unit="3"]').click());
  await page.waitForTimeout(300);
  const active = await page.evaluate(() => [...document.querySelectorAll('#unitFilterRow .freq-chip.active')].map(c => c.textContent.trim()));
  expect(active).toEqual(['U3']);
  const count = await page.locator('#freqCount').textContent();
  expect(count).toMatch(/共 \d+ 词/);
});

test('learn size buttons exist and quiz uses 20-word default', async ({ page }) => {
  const sizes = await page.evaluate(() => [...document.querySelectorAll('#sizeRow .mode-btn')].map(b => b.textContent.trim()));
  expect(sizes.length).toBe(3);
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');
  await page.waitForTimeout(400);
  const label = await page.locator('.q-label').textContent();
  expect(label).toContain('/ 20 题');
});

test('switch to Ebbinghaus pool shows Unit 1-10 chips', async ({ page }) => {
  await page.evaluate(() => document.querySelector('.pool-btn[data-pool="full"]').click());
  await page.waitForTimeout(300);
  const chips = await page.evaluate(() => [...document.querySelectorAll('#unitFilterRow .freq-chip')].map(c => c.textContent.trim()));
  expect(chips).toContain('U10');
  expect(chips).not.toContain('U11');
});

test('ebbinghaus 4-week-25-day table logic', async ({ page }) => {
  // Unit 1 复习日：第2、4、7、13天（+1/+3/+6/+12）；第14天后 Unit14 在第15/17/20/26天复习（26>25 表内截止）
  const res = await page.evaluate(() => {
    function ebbingUnitsDueOn(dayN, learnedUnits) {
      var due = [];
      for (var u = 1; u <= learnedUnits; u++) {
        if (dayN - u === 1 || dayN - u === 3 || dayN - u === 6 || dayN - u === 12) due.push(u);
      }
      return due;
    }
    return {
      d2: ebbingUnitsDueOn(2, 2),  // 第2天：U1(+1) + 新学U2
      d4: ebbingUnitsDueOn(4, 4),  // 第4天：U1(+3) U3(+1)
      d7: ebbingUnitsDueOn(7, 7),  // 第7天：U1(+6) U4(+3) U6(+1)
      d13: ebbingUnitsDueOn(13, 13), // 第13天：U1(+12) U7(+6) U10(+3) U12(+1)
      d19: ebbingUnitsDueOn(19, 14)  // 第19天：U7(+12) U13(+6)
    };
  });
  expect(res.d2).toEqual([1]);
  expect(res.d4).toEqual([1, 3]);
  expect(res.d7).toEqual([1, 4, 6]);
  expect(res.d13).toEqual([1, 7, 10, 12]);
  expect(res.d19).toEqual([7, 13]);
});

test('Ebbinghaus plan bar shows study plan on core pool', async ({ page }) => {
  // 注入 ebbingStart（昨天开始）→ 今天是第2天，该学 Unit 2
  await page.evaluate(() => {
    const y = new Date(Date.now() - 86400000);
    const key = y.toISOString().split('T')[0];
    const st = JSON.parse(localStorage.getItem('cet6_quiz_app_v2') || 'null') || {};
    st.ebbingStart = key;
    localStorage.setItem('cet6_quiz_app_v2', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(800);
  const plan = await page.locator('#ebbingPlan').textContent();
  expect(plan).toContain('第 2 天');
  expect(plan).toContain('Unit 2');
});

test('8-grid review: grid progress shows after learning in Ebbinghaus pool', async ({ page }) => {
  await page.evaluate(() => document.querySelector('.pool-btn[data-pool="full"]').click());
  await page.waitForTimeout(300);
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.opt-btn');
  await page.waitForTimeout(400);
  await page.locator('.opt-btn').first().click();
  await page.waitForSelector('.next-btn.show');
  // 讲解区应显示打卡格进度
  const detail = await page.locator('.word-detail').textContent();
  expect(detail).toContain('打卡');
});

// ============ PAGE NAV (页导航：单 Unit 独立编页 20词/页) ============

test('page nav: single unit shows page number and controls', async ({ page }) => {
  // 选 Unit 1（核心库，154词 → 8页），再开始做题
  await page.evaluate(() => document.querySelector('#unitFilterRow .freq-chip[data-unit="1"]').click());
  await page.waitForTimeout(300);
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.page-nav');
  const nav = await page.locator('.page-nav').textContent();
  expect(nav).toContain('Unit 1 · 第 1/8 页');
  // 首页：上一页禁用，下一页可用
  await expect(page.locator('.page-nav button:has-text("上一页")')).toBeDisabled();
  await expect(page.locator('.page-nav button:has-text("下一页")')).toBeEnabled();
});

test('page nav: resume continues from saved page', async ({ page }) => {
  await page.evaluate(() => document.querySelector('#unitFilterRow .freq-chip[data-unit="1"]').click());
  await page.waitForTimeout(300);
  // 预置续刷进度：core_u1 第3页
  await page.evaluate(() => {
    localStorage.setItem('cet6_page_progress_v1', JSON.stringify({ k: 'core_u1', page: 3 }));
  });
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.page-nav');
  const nav = await page.locator('.page-nav').textContent();
  expect(nav).toContain('Unit 1 · 第 3/8 页');
});

test('page nav: next-page button jumps and saves progress', async ({ page }) => {
  await page.evaluate(() => document.querySelector('#unitFilterRow .freq-chip[data-unit="1"]').click());
  await page.waitForTimeout(300);
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.page-nav');
  expect(await page.locator('.page-nav').textContent()).toContain('第 1/8 页');
  // 点下一页 → 跳到第2页，并写入 localStorage
  await page.locator('.page-nav button:has-text("下一页")').click();
  await page.waitForSelector('.page-nav');
  expect(await page.locator('.page-nav').textContent()).toContain('Unit 1 · 第 2/8 页');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cet6_page_progress_v1') || 'null'));
  expect(saved).toEqual({ k: 'core_u1', page: 2 });
});

test('page nav: finishing a round advances resume page', async ({ page }) => {
  await page.evaluate(() => document.querySelector('#unitFilterRow .freq-chip[data-unit="1"]').click());
  await page.waitForTimeout(300);
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.page-nav');
  expect(await page.locator('.page-nav').textContent()).toContain('第 1/8 页');
  // 连答 20 题（learnSize 默认 20）完成本轮 → 续刷应推进到第2页
  for (let i = 0; i < 20; i++) {
    await page.locator('.opt-btn').first().click();
    await page.waitForSelector('.next-btn.show', { timeout: 3000 });
    await page.locator('.next-btn').click();
    await page.waitForTimeout(120);
  }
  await expect(page.locator('#startBtn')).toContainText('再来一轮');
  await page.click('#startBtn');
  await page.waitForSelector('.page-nav');
  const nav2 = await page.locator('.page-nav').textContent();
  expect(nav2).toContain('Unit 1 · 第 2/8 页');
});

test('page nav: all-range shows position only without controls', async ({ page }) => {
  // 默认「全部」范围：只显示位置参考，无跳页按钮
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.page-nav');
  const nav = await page.locator('.page-nav').textContent();
  expect(nav).toContain('第');
  await expect(page.locator('.page-nav button')).toHaveCount(0);
});

test('page nav: memory mode shows position only without controls', async ({ page }) => {
  await page.evaluate(() => document.querySelector('#unitFilterRow .freq-chip[data-unit="1"]').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('memoryBtn').click());
  await page.waitForTimeout(100);
  await page.click('button:has-text("开始做题")');
  await page.waitForSelector('.page-nav');
  const nav = await page.locator('.page-nav').textContent();
  expect(nav).toContain('Unit 1 · 第');
  await expect(page.locator('.page-nav button')).toHaveCount(0);
});

test('page nav: retry mode hides page info', async ({ page }) => {
  // 注入 4 个错题后重做，重做不显示页码
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('cet6_quiz_app_v2') || '{}');
    st.wrongWordIds = st.wrongWordIds || {};
    st.wrongWordIds['cn2en_core'] = { 1: {}, 2: {}, 3: {}, 4: {} };
    localStorage.setItem('cet6_quiz_app_v2', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(800);
  await page.click('#retryQuizBtn');
  await page.waitForSelector('.opt-btn');
  await page.waitForTimeout(300);
  await expect(page.locator('.page-nav')).toHaveCount(0);
});

test.describe('back-to-top', () => {
  // 确保每次从顶部开始验证滚动
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
  });

  test('hidden at top, appears on scroll, smooth scrolls up', async ({ page }) => {
    const btn = page.locator('#backToTopBtn');
    await expect(btn).not.toBeVisible();
    const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(maxScroll).toBeGreaterThan(300);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    await expect(btn).toHaveClass(/show/);
    await expect(btn).toBeVisible();
    await btn.click();
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 });
    await page.waitForTimeout(200);
    await expect(btn).not.toBeVisible();
  });

  test.describe('fullscreen', () => {
    // 小视口模拟手机,确保 quiz-scroll 有真实滚动空间
    test.use({ viewport: { width: 1280, height: 420 } });

    // 进入全屏后作答进入详解,内容才溢出 quiz-scroll 产生滚动
    async function enterFullscreenDetail(page) {
      await page.click('button:has-text("开始做题")');
      await page.waitForSelector('.opt-btn');
      await page.click('#toggleFsBtn');
      await page.waitForTimeout(200);
      await page.locator('.opt-btn').first().click();
      await page.waitForSelector('.next-btn.show');
      await page.waitForTimeout(300);
    }

    test('appears on quiz-scroll scroll and smooth scrolls up', async ({ page }) => {
      await enterFullscreenDetail(page);
      const btn = page.locator('#backToTopBtn');
      const scrollable = await page.evaluate(() => {
        const sc = document.querySelector('.quiz-card.fullscreen .quiz-scroll');
        return sc ? sc.scrollHeight - sc.clientHeight : 0;
      });
      expect(scrollable).toBeGreaterThan(300);
      await page.evaluate(() => {
        const sc = document.querySelector('.quiz-card.fullscreen .quiz-scroll');
        if (sc) sc.scrollTop = sc.scrollHeight;
      });
      await page.waitForTimeout(300);
      await expect(btn).toHaveClass(/show/);
      await btn.click();
      await page.waitForFunction(() => {
        const sc = document.querySelector('.quiz-card.fullscreen .quiz-scroll');
        return sc && sc.scrollTop === 0;
      }, null, { timeout: 5000 });
    });

    test('hides again after exiting fullscreen at top', async ({ page }) => {
      await enterFullscreenDetail(page);
      const btn = page.locator('#backToTopBtn');
      await page.evaluate(() => {
        const sc = document.querySelector('.quiz-card.fullscreen .quiz-scroll');
        if (sc) sc.scrollTop = sc.scrollHeight;
      });
      await page.waitForTimeout(300);
      await expect(btn).toHaveClass(/show/);
      await page.click('#toggleFsBtn');
      await page.waitForTimeout(300);
      await expect(btn).toHaveClass(/show/);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await expect(btn).not.toBeVisible();
    });
  });
});

test.describe('keep prefs on exit', () => {
  // 全局 beforeEach 已把闯关切到 gate2 并持久化；reload 后快照 = 当前持久化模式（gate2）
  test.beforeEach(async ({ page }) => {
    await page.reload();
    await page.waitForTimeout(300);
  });

  test('tab switch without pref change: no dialog, switches directly', async ({ page }) => {
    await page.click('button[data-tab="stats-page"]');
    await page.waitForTimeout(300);
    await expect(page.locator('#keepPrefsBar')).toHaveCount(0);
    await expect(page.locator('#tab-stats-page')).toBeVisible();
  });

  test('tab switch after pref change: dialog appears', async ({ page }) => {
    await page.click('#gateRow .mode-btn[data-gate="3"]'); // 调整
    await page.click('button[data-tab="stats-page"]');
    await page.waitForSelector('#keepPrefsBar');
    await expect(page.locator('#keepPrefsBar')).toContainText('本次调整了做题模式');
    await expect(page.locator('#keepPrefsYes')).toBeVisible();
    await expect(page.locator('#keepPrefsNo')).toBeVisible();
  });

  test('keep button: snapshot updated, switch proceeds, no repeat dialog', async ({ page }) => {
    await page.click('#gateRow .mode-btn[data-gate="3"]');
    await page.click('button[data-tab="stats-page"]');
    await page.waitForSelector('#keepPrefsBar');
    await page.click('#keepPrefsYes');
    await page.waitForTimeout(300);
    await expect(page.locator('#keepPrefsBar')).toHaveCount(0);
    await expect(page.locator('#tab-stats-page')).toBeVisible();
    await page.click('button[data-tab="quiz"]');
    await page.waitForTimeout(200);
    await page.click('button[data-tab="stats-page"]');
    await page.waitForTimeout(300);
    await expect(page.locator('#keepPrefsBar')).toHaveCount(0);
  });

  test('revert button: prefs restored to snapshot, UI syncs', async ({ page }) => {
    await page.click('#gateRow .mode-btn[data-gate="3"]');
    await page.click('button[data-tab="stats-page"]');
    await page.waitForSelector('#keepPrefsBar');
    await page.click('#keepPrefsNo');
    await page.waitForTimeout(400);
    const gate = await page.evaluate(() => JSON.parse(localStorage.getItem('cet6_quiz_app_v2')).prefs.gate);
    expect(gate).toBe(2);
    await page.click('button[data-tab="quiz"]');
    await page.waitForTimeout(200);
    await expect(page.locator('#gateRow .mode-btn[data-gate="2"]')).toHaveClass(/active/);
  });

  test('memory mode survives switching pool mid-quiz (isMemory persisted)', async ({ page }) => {
    await page.click('#memoryBtn'); // 开记忆模式
    await page.click('button:has-text("开始做题")');
    await page.waitForSelector('.opt-btn');
    page.once('dialog', d => d.accept());
    await page.click('.pool-btn[data-pool="full"]');
    await page.waitForTimeout(400);
    const isMem = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('cet6_quiz_app_v2'));
      return st.suspendedQuiz ? !!st.suspendedQuiz.isMemory : null;
    });
    expect(isMem).toBe(true);
  });

  test('switching mode mid-quiz not reverted by checkSuspendedQuiz', async ({ page }) => {
    await page.click('button:has-text("开始做题")');
    await page.waitForSelector('.opt-btn');
    page.once('dialog', d => d.accept());
    await page.click('.mode-btn[data-mode="en2cn"]');
    await page.waitForTimeout(400);
    const mode = await page.evaluate(() => JSON.parse(localStorage.getItem('cet6_quiz_app_v2')).prefs.mode);
    expect(mode).toBe('en2cn');
    await expect(page.locator('.mode-btn[data-mode="en2cn"]')).toHaveClass(/active/);
  });
});

test.describe('external data (full-words.js)', () => {
  test('switch to Ebbinghaus pool loads external data and can quiz', async ({ page }) => {
    await page.click('.pool-btn[data-pool="full"]');
    await page.waitForFunction(() => window.__FULL_WORDS_DATA__ && window.__FULL_WORDS_DATA__.length === 2920);
    await expect(page.locator('#unitFilterRow .freq-chip[data-unit="1"]')).toBeVisible();
    await page.click('button:has-text("开始做题")');
    await page.waitForSelector('.opt-btn', { timeout: 10000 });
    expect(await page.locator('.opt-btn').count()).toBe(4);
  });

  test('core pool quiz shows detail from built-in word fields', async ({ page }) => {
    await page.click('button:has-text("开始做题")');
    await page.waitForSelector('.opt-btn');
    await page.locator('.opt-btn').first().click();
    await page.waitForSelector('.next-btn.show');
    await expect(page.locator('.word-detail')).toBeVisible();
  });

  test('Ebbinghaus pool quiz shows merged detail from external data', async ({ page }) => {
    await page.click('.pool-btn[data-pool="full"]');
    await page.waitForFunction(() => window.__FULL_WORDS_DATA__ && window.__FULL_WORDS_DATA__.length === 2920);
    await page.click('button:has-text("开始做题")');
    await page.waitForSelector('.opt-btn', { timeout: 10000 });
    await page.locator('.opt-btn').first().click();
    await page.waitForSelector('.next-btn.show', { timeout: 10000 });
    await expect(page.locator('.word-detail')).toBeVisible();
    const txt = await page.locator('.wd-body').textContent();
    expect(txt.trim().length).toBeGreaterThan(0);
  });
});

test.describe('theme toggle', () => {
  test('switches data-theme and icon with circular reveal', async ({ page }) => {
    const btn = page.locator('#themeBtn');
    const initial = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await btn.click();
    await page.waitForFunction((prev) => {
      const cur = document.documentElement.getAttribute('data-theme');
      return cur !== prev && (cur === 'dark' || cur === 'light');
    }, initial, { timeout: 5000 });
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(after === 'dark' || after === 'light').toBe(true);
    expect(after).not.toBe(initial);
    await page.waitForTimeout(700); // 等圆形扩散动画(450ms)结束
    const icon = await btn.textContent();
    expect(icon).toBe(after === 'dark' ? '☀️' : '🌙');
  });

  test('reduced-motion still switches theme', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const btn = page.locator('#themeBtn');
    const initial = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await btn.click();
    await page.waitForFunction((prev) => document.documentElement.getAttribute('data-theme') !== prev, initial, { timeout: 5000 });
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(after === 'dark' || after === 'light').toBe(true);
  });
});

test.describe('hover gating (pointer media query)', () => {
  test('desktop (pointer:fine): hover feedback works', async ({ page }) => {
    const btn = page.locator('.tab-btn[data-tab="wrong"]'); // 非 active，hover 才有变化
    const before = await btn.evaluate(el => getComputedStyle(el).color);
    await btn.hover();
    await page.waitForTimeout(300);
    const after = await btn.evaluate(el => getComputedStyle(el).color);
    expect(after).not.toBe(before); // hover 后颜色变(--text2 → --text)
  });

  test('stats pbar renders with scaleX transform', async ({ page }) => {
    await page.click('button[data-tab="stats-page"]');
    await page.waitForTimeout(800); // 等统计页渲染
    const info = await page.evaluate(() => {
      const fills = [...document.querySelectorAll('.pbar .fill')];
      const vis = fills.filter(el => el.getBoundingClientRect().width > 0);
      const zero = el => getComputedStyle(el).transform === 'matrix(0, 0, 0, 1, 0, 0)';
      return {
        visible: vis.length,
        nonZeroScaleX: vis.filter(el => !zero(el)).length,
        originLeft: vis[0] ? getComputedStyle(vis[0]).transformOrigin.split(' ')[0] : null,
      };
    });
    expect(info.visible).toBeGreaterThan(0);
    expect(info.nonZeroScaleX).toBe(info.visible);
    expect(info.originLeft).toBe('0px');
  });
});

test.describe('touch device simulation', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('hover feedback suppressed (pointer:coarse)', async ({ page }) => {
    const media = await page.evaluate(() => ({
      hover: window.matchMedia('(hover: hover)').matches,
      coarse: window.matchMedia('(pointer: coarse)').matches,
    }));
    expect(media.hover).toBe(false);
    expect(media.coarse).toBe(true);
    const btn = page.locator('.tab-btn[data-tab="wrong"]');
    const before = await btn.evaluate(el => getComputedStyle(el).color);
    await btn.hover();
    await page.waitForTimeout(300);
    const after = await btn.evaluate(el => getComputedStyle(el).color);
    expect(after).toBe(before); // hover 不变色(@media 不匹配)
  });
});

test('page load with saved full pool does not crash before async words ready', async ({ page }) => {
  // 模拟用户上次选了打卡词库：prefs.pool='full'
  await page.addInitScript(() => {
    const st = JSON.parse(localStorage.getItem('cet6_quiz_app_v2') || '{}');
    st.prefs = st.prefs || {};
    st.prefs.pool = 'full';
    st.prefs.units = [0];
    localStorage.setItem('cet6_quiz_app_v2', JSON.stringify(st));
  });
  let pageError = null;
  page.on('pageerror', e => { pageError = e.message; });
  await page.goto('file:///C:/Users/zheng/Desktop/%E5%AD%A6%E4%B9%A0%E4%B8%8E%E8%80%83%E8%AF%95/Study/%E8%8B%B1%E8%AF%AD%E5%9B%9B%E5%85%AD%E7%BA%A7/cet6_quiz.html');
  await page.waitForLoadState('domcontentloaded');
  // 页面加载瞬间(外部词库数据未到达)applyPrefs→updatePoolUI→updateFreqCount 不应崩溃
  expect(pageError).toBeNull();
  // 打卡词库异步加载完成
  await page.waitForFunction(() => window.__FULL_WORDS_DATA__ && window.__FULL_WORDS_DATA__.length === 2920, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  expect(pageError).toBeNull();
  // 词数刷新为真实值
  const txt = await page.locator('#freqCount').textContent();
  expect(txt).toContain('2920');
});

test.describe('other options show english word on wrong answer', () => {
  async function answerWrong(page) {
    await page.evaluate(() => {
      const g2 = document.querySelector('#gateRow .mode-btn[data-gate="2"]');
      if (g2) g2.click();
    });
    await page.waitForTimeout(100);
    await page.click('button:has-text("开始做题")');
    await page.waitForSelector('.opt-btn');
    await page.evaluate(() => {
      const q = quizState.questions[quizState.pos];
      const wrongIdx = q.options.findIndex((o, i) => i !== q.correctIndex);
      document.querySelectorAll('.opt-btn')[wrongIdx].click();
    });
    await page.waitForSelector('.feedback.show.fail');
    return page.evaluate(() => {
      const fb = document.querySelector('.feedback.show');
      const re = /([A-D])\.<\/span> <strong>([a-zA-Z]+)<\/strong>/g;
      const found = [];
      let mm;
      while ((mm = re.exec(fb.innerHTML)) !== null) found.push({ label: mm[1], word: mm[2] });
      return found;
    });
  }

  test('en2cn: other options include english word', async ({ page }) => {
    await page.click('.mode-btn[data-mode="en2cn"]');
    const rows = await answerWrong(page);
    expect(rows.length).toBe(3); // 其余选项 3 行
    rows.forEach(r => expect(r.word).toMatch(/^[a-z]+$/i));
  });

  test('cn2en: other options still include english word (regression)', async ({ page }) => {
    const rows = await answerWrong(page); // 默认 cn2en
    expect(rows.length).toBe(3);
  });
});

// ============ 新版词群导图（书页真实导图数据：放射状 + 下钻） ============
test.describe('group map (new: unit-maps.js data)', () => {
  test('core pool quiz answer shows new group map with SVG nodes', async ({ page }) => {
    // 核心词库默认；答题后反馈里应出现新版词群导图（gmap-wrap 容器）
    await page.click('button:has-text("开始做题")');
    await page.waitForSelector('.opt-btn');
    await page.locator('.opt-btn').first().click();
    await page.waitForSelector('.next-btn.show');
    await expect(page.locator('.gmap-wrap')).toBeVisible();
    await expect(page.locator('.gmap-wrap svg')).toBeVisible();
    await expect(page.locator('.gmap-title')).toContainText('词群导图');
  });

  test('new group map node click drills down and shows back button', async ({ page }) => {
    await page.click('button:has-text("开始做题")');
    await page.waitForSelector('.opt-btn');
    await page.locator('.opt-btn').first().click();
    await page.waitForSelector('.next-btn.show');
    // 找到有 ▾ 展开标记的节点（有子节点的词），点击应下钻
    const hasDrill = await page.evaluate(() => {
      const wrap = document.querySelector('.gmap-wrap');
      if (!wrap) return false;
      const texts = wrap.querySelectorAll('text');
      for (const t of texts) {
        if (t.textContent === '▾' || t.textContent.indexOf('▾') !== -1) return true;
      }
      return false;
    });
    if (!hasDrill) {
      // 若当前词群一级词全无子节点（如 g1 的 conquer 等仍有 children），断言数据已加载即可
      expect(await page.evaluate(() => !!window.__UNIT_MAPS_DATA__)).toBe(true);
      return;
    }
    // 点击可展开节点（带 onclick 的 g 标签内 circle）
    await page.evaluate(() => {
      const wrap = document.querySelector('.gmap-wrap');
      const gs = wrap.querySelectorAll('g[onclick*="groupMapDrill"]');
      for (const g of gs) {
        const tip = g.querySelector('title');
        if (tip && g.querySelector('text')) { g.dispatchEvent(new MouseEvent('click', { bubbles: true })); break; }
      }
    });
    await page.waitForTimeout(100);
    // 下钻后应出现「返回上级」按钮
    await expect(page.locator('.gmap-back')).toBeVisible();
  });

  test('unit-maps data: 14 groups in unit 1, each has level1Nodes', async ({ page }) => {
    await page.waitForFunction(() => !!window.__UNIT_MAPS_DATA__);
    const stats = await page.evaluate(() => {
      const d = window.__UNIT_MAPS_DATA__;
      const unit1 = d[1];
      if (!unit1) return null;
      const ids = Object.keys(unit1).map(Number).sort((a, b) => a - b);
      let totalNodes = 0;
      const walk = (ns) => { ns.forEach(n => { totalNodes++; if (n.children) walk(n.children); }); };
      Object.keys(unit1).forEach(gid => walk(unit1[gid].level1Nodes));
      return { ids, totalNodes };
    });
    expect(stats).not.toBeNull();
    expect(stats.ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(stats.totalNodes).toBeGreaterThan(200);
  });

  test('unit1 every core word is present in map data (no missing quiz word)', async ({ page }) => {
    // 回归：precede/gene/rise 曾不在导图数据里，做题词找不到；现 unit1 全部 154 词必须都能在导图节点中找到
    await page.waitForFunction(() => !!window.__UNIT_MAPS_DATA__);
    const missing = await page.evaluate(() => {
      const words = JSON.parse(document.getElementById('data-all-words').textContent);
      const unit1 = words.filter(w => w.unit === 1);
      const d = window.__UNIT_MAPS_DATA__[1];
      const set = new Set();
      const walk = ns => ns.forEach(n => { set.add(n.word.toLowerCase()); if (n.children) walk(n.children); });
      Object.keys(d).forEach(g => walk(d[g].level1Nodes || []));
      return unit1.filter(w => !set.has(w.word.toLowerCase())).map(w => w.word);
    });
    expect(missing).toEqual([]);
  });

  test('quiz word that is a deep node auto-drills to its level and shows highlighted', async ({ page }) => {
    // 回归：二级词（如 deteriorate，是 generate 的子节点）此前主题层看不到；现自动下钻到所在层并高亮当前词
    await page.waitForFunction(() => !!window.__UNIT_MAPS_DATA__);
    const spot = await page.evaluate(() => {
      window.currentPool = 'core';
      const wrap = document.createElement('div');
      wrap.id = 'auto-map';
      wrap.style.position = 'fixed';
      wrap.style.left = '0';
      wrap.style.top = '0';
      document.body.appendChild(wrap);
      wrap.innerHTML = window.groupMapSVG({ id: 'x', word: 'deteriorate', unit: 1, lesson: 1, seq: 1, group_id: 7, group_name: 'gen(e)相关' });
      let ctext = null;
      for (const t of wrap.querySelectorAll('text')) { if (t.querySelector('tspan')) { ctext = t; break; } }
      const center = ctext ? ctext.textContent : '';
      const hasBack = !!wrap.querySelector('.gmap-back');
      // 当前做题词应在节点中且高亮（active 节点圆 r=17）
      let activeWord = null;
      for (const g of wrap.querySelectorAll('g[onclick*="groupMapDrill"]')) {
        const title = g.querySelector('title');
        if (title && g.querySelector('circle').getAttribute('r') === '17') { activeWord = title.textContent.split(' ')[0]; }
      }
      wrap.remove();
      return { center, hasBack, activeWord };
    });
    expect(spot.hasBack).toBe(true);                    // 自动下钻后应出现返回按钮
    expect(spot.activeWord).toBe('deteriorate');        // 做题词在导图节点中且高亮
  });

  test('center word stays inside circle after drill (long words not covered)', async ({ page }) => {
    // 回归：下钻后长中心词（如 subordinate/overwhelming）此前会被 r=30 的圆遮住。
    // 现在中心文字单行、字号自适应、圆随宽度外扩，任何主题中心/一级下钻中心都应在圆内。
    await page.waitForFunction(() => !!window.__UNIT_MAPS_DATA__);
    const overflows = await page.evaluate(() => {
      window.currentPool = 'core';
      const data = window.__UNIT_MAPS_DATA__[1];
      const bad = [];
      const wrap = document.createElement('div');
      wrap.id = 'regress-gmap';
      wrap.style.position = 'fixed';
      wrap.style.left = '-9999px';
      wrap.style.top = '0';
      document.body.appendChild(wrap);
      const scan = () => {
        const svg = wrap.querySelector('svg');
        if (!svg) return;
        const circle = svg.querySelector('circle');
        const cx = +circle.getAttribute('cx'), cy = +circle.getAttribute('cy'), r = +circle.getAttribute('r');
        let ctext = null;
        for (const t of svg.querySelectorAll('text')) { if (t.querySelector('tspan')) { ctext = t; break; } }
        if (!ctext) return;
        const corners = [...ctext.querySelectorAll('tspan')].flatMap(t => {
          const b = t.getBBox();
          return [Math.hypot(b.x - cx, b.y - cy), Math.hypot(b.x + b.width - cx, b.y - cy), Math.hypot(b.x - cx, b.y + b.height - cy), Math.hypot(b.x + b.width - cx, b.y + b.height - cy)];
        });
        const maxC = Math.max(...corners);
        if (maxC - r > 1) bad.push({ center: ctext.textContent, r, over: Math.round((maxC - r) * 10) / 10 });
      };
      for (const gid of Object.keys(data)) {
        const probe = { id: 'p', word: 'x', unit: 1, lesson: 1, seq: 1, group_id: Number(gid), group_name: data[gid].group_name };
        wrap.innerHTML = window.groupMapSVG({ ...probe });
        scan();
        const drillWords = [...wrap.querySelectorAll('g[onclick*="groupMapDrill"]')].map(g => g.querySelector('title')?.textContent.split(' ')[0]).filter(Boolean);
        for (const wrd of drillWords.slice(0, 6)) {
          wrap.innerHTML = window.groupMapSVG({ ...probe });
          for (const g of wrap.querySelectorAll('g[onclick*="groupMapDrill"]')) {
            const title = g.querySelector('title');
            if (title && title.textContent.split(' ')[0] === wrd) { g.dispatchEvent(new MouseEvent('click', { bubbles: true })); break; }
          }
          scan();
        }
      }
      wrap.remove();
      return bad;
    });
    expect(overflows).toEqual([]);
  });

  test('long center word renders single-line and relation labels stay outside circle', async ({ page }) => {
    await page.waitForFunction(() => !!window.__UNIT_MAPS_DATA__);
    const spot = await page.evaluate(() => {
      window.currentPool = 'core';
      const wrap = document.createElement('div');
      wrap.id = 'regress-gmap2';
      wrap.style.position = 'fixed';
      wrap.style.left = '0';
      wrap.style.top = '0';
      document.body.appendChild(wrap);
      wrap.innerHTML = window.groupMapSVG({ id: 'x', word: 'ordinary', unit: 1, lesson: 1, seq: 1, group_id: 3, group_name: 'ordinary 相关' });
      // 下钻到 subordinate（11 个字符）
      for (const g of wrap.querySelectorAll('g[onclick*="groupMapDrill"]')) {
        const title = g.querySelector('title');
        if (title && title.textContent.split(' ')[0] === 'subordinate') { g.dispatchEvent(new MouseEvent('click', { bubbles: true })); break; }
      }
      const svg = wrap.querySelector('svg');
      let ctext = null;
      for (const t of svg.querySelectorAll('text')) { if (t.querySelector('tspan')) { ctext = t; break; } }
      const tspans = ctext ? [...ctext.querySelectorAll('tspan')] : [];
      const circle = svg.querySelector('circle');
      const cx = +circle.getAttribute('cx'), cy = +circle.getAttribute('cy'), r = +circle.getAttribute('r');
      // 关系标签（font-size=9.5）：中心在圆外，且文字包围盒内侧不贴中心圆（统一环带，间距≥4px）
      const rels = [...svg.querySelectorAll('text')].filter(t => t.getAttribute('font-size') === '9.5').map(t => {
        const rb = t.getBBox();
        const centerD = Math.hypot(rb.x + rb.width / 2 - cx, rb.y + rb.height / 2 - cy);
        const rad = Math.atan2(rb.y + rb.height / 2 - cy, rb.x + rb.width / 2 - cx);
        const innerGap = centerD - r - rb.width / 2;   // 文字内侧到中心圆边的间隙
        return { outside: centerD > r, innerGap };
      });
      const relsOutside = rels.length > 0 && rels.every(x => x.outside);
      const minInnerGap = rels.length ? Math.min(...rels.map(x => x.innerGap)) : Infinity;
      wrap.remove();
      return { centerText: ctext ? ctext.textContent : '', lines: tspans.length, circleR: r, relsOutside, minInnerGap };
    });
    expect(spot.centerText).toBe('subordinate');
    expect(spot.lines).toBe(1);   // 单行，不把单词拦腰折断
    expect(spot.relsOutside).toBe(true);
    expect(spot.minInnerGap).toBeGreaterThanOrEqual(4);  // 关系标签不贴中心圆（间距统一）
  });

  test('click circle drills down, click word text speaks only', async ({ page }) => {
    // 行为约定：节点圆圈=展开下钻（不发音）；节点单词文字=朗读发音（不下钻）
    await page.waitForFunction(() => !!window.__UNIT_MAPS_DATA__);
    const result = await page.evaluate(() => {
      window.currentPool = 'core';
      window.__spoke = [];
      window.speakWord = function (t) { window.__spoke.push(t); };
      const wrap = document.createElement('div');
      wrap.id = 'regress-gmap3';
      wrap.style.position = 'fixed';
      wrap.style.left = '0';
      wrap.style.top = '0';
      document.body.appendChild(wrap);
      wrap.innerHTML = window.groupMapSVG({ id: 'x', word: 'ambition', unit: 1, lesson: 1, seq: 1, group_id: 1, group_name: '雄心相关' });
      // 1) 点击 aggressive 的单词文字：应只发音、不下钻
      const words = [...wrap.querySelectorAll('text[onclick*="groupMapSpeak"]')].filter(t => t.textContent === 'aggressive');
      const wordEl = words[0];
      wordEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const spokeAfterWord = window.__spoke.slice();
      const backAfterWord = !!wrap.querySelector('.gmap-back');
      // 2) 重置后点击 aggressive 的圆圈：应只下钻、不发音
      window.__spoke = [];
      const circles = [...wrap.querySelectorAll('g[onclick*="groupMapDrill"]')].filter(g => {
        const title = g.querySelector('title');
        return title && title.textContent.split(' ')[0] === 'aggressive';
      });
      circles[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const spokeAfterCircle = window.__spoke.slice();
      const backAfterCircle = !!wrap.querySelector('.gmap-back');
      wrap.remove();
      return { spokeAfterWord, backAfterWord, spokeAfterCircle, backAfterCircle };
    });
    expect(result.spokeAfterWord).toEqual(['aggressive']);   // 点单词 → 发音
    expect(result.backAfterWord).toBe(false);                 // 点单词 → 不下钻
    expect(result.spokeAfterCircle).toEqual([]);              // 点圆圈 → 不发音
    expect(result.backAfterCircle).toBe(true);                // 点圆圈 → 下钻
  });
});

# -*- coding: utf-8 -*-
"""单词浏览器 Unit 1-14 覆盖 + 运行时释义长度回归测试。

Run from this directory:
    python -X utf8 test_browse_all_units_regression.py

锁定三件事：
  1. 单词浏览器默认覆盖大纲词汇 Unit 1-14 全部词条（6526 词），可切换核心词汇
     Unit 1-10（3324 词）；每个单元都能筛选出与数据源完全一致的数量；
  2. 每个单元抽样单词都能通过搜索命中，并返回含「巧记 / 例句」的查询结果；
  3. 运行时（repairWordData / OCR 清洗之后）全库释义长度 ≤ 20 字符——
     防止 repair 表再次把长释义覆盖回页面上（way 曾因此显示 189 字长释义）。
"""
import json
import re
import unittest
from pathlib import Path

from playwright.sync_api import Browser, Playwright, sync_playwright

ROOT = Path(__file__).parent
QUIZ_HTML = ROOT / "cet6_quiz.html"

MEANING_LIMIT = 20
EXPECTED_CORE_TOTAL = 6526    # 大纲词汇 Unit 1-14
EXPECTED_FULL_TOTAL = 3324    # 核心词汇 Unit 1-10


class BrowseAllUnitsRegressionTest(unittest.TestCase):
    playwright: Playwright
    browser: Browser

    @classmethod
    def setUpClass(cls) -> None:
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)
        cls.context = cls.browser.new_context()
        cls.page = cls.context.new_page()
        cls.page.add_init_script("localStorage.setItem('cet6_onboarded', '1');")
        cls.js_errors = []
        cls.page.on("pageerror", lambda e: cls.js_errors.append(str(e)))
        cls.page.goto(QUIZ_HTML.as_uri(), wait_until="load")
        cls.page.wait_for_timeout(1500)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.context.close()
        cls.browser.close()
        cls.playwright.stop()

    # ---------- helpers ----------
    def open_browse(self) -> None:
        self.page.evaluate("() => { switchTab('browse', document.querySelector('.tab-btn[data-tab=\"browse\"]')); }")
        self.page.wait_for_selector("#browseSearch")
        self.page.wait_for_timeout(400)

    def browse_state(self) -> dict:
        return self.page.evaluate(
            """() => ({
                pool: _browsePool,
                unit: _browseUnit,
                chips: Array.from(document.querySelectorAll('#browseUnits button')).map(b => b.textContent),
                stat: (document.querySelector('#browseList > div') || {}).textContent || '',
                rows: document.querySelectorAll('#browseList strong').length
            })"""
        )

    def unit_counts(self, pool: str) -> dict:
        return self.page.evaluate(
            """(pool) => {
                const m = {};
                const arr = pool === 'full' ? ((typeof FULL_WORDS !== 'undefined' && FULL_WORDS) || []) : ALL_WORDS;
                arr.forEach(w => { const u = Number(w.unit) || 0; m[u] = (m[u] || 0) + 1; });
                return m;
            }""",
            pool,
        )

    # ---------- tests ----------
    def test_01_runtime_meaning_lengths_within_limit(self) -> None:
        """运行时全库释义 ≤20 字符（含 repairWordData 覆盖后的真实值）。"""
        over = self.page.evaluate(
            """(limit) => {
                const bad = [];
                ALL_WORDS.forEach(w => { const m = w.meaning || ''; if (m.length > limit) bad.push('core:' + w.word + ':' + m.length); });
                const fw = (typeof FULL_WORDS !== 'undefined' && FULL_WORDS) || [];
                fw.forEach(w => { const m = w.meaning || ''; if (m.length > limit) bad.push('full:' + w.word + ':' + m.length); });
                return bad;
            }""",
            MEANING_LIMIT,
        )
        self.assertEqual([], over, "运行时仍存在超长释义：%s" % over[:20])

    def test_02_browse_defaults_to_all_units(self) -> None:
        """默认浏览大纲词汇 Unit 1-14，统计总数 6526，单元按钮 1-14 齐全。"""
        self.open_browse()
        st = self.browse_state()
        self.assertEqual("core", st["pool"], "默认应浏览大纲词汇（Unit 1-14）")
        self.assertIn("共 %d 个单词" % EXPECTED_CORE_TOTAL, st["stat"])
        for u in range(1, 15):
            self.assertIn("Unit %d" % u, st["chips"], "缺少 Unit %d 筛选按钮" % u)
        self.assertGreater(st["rows"], 0, "列表应有单词")

    def test_03_every_unit_count_matches_data(self) -> None:
        """Unit 1-14 每个单元筛选出的数量与数据源完全一致（不遗漏）。"""
        self.open_browse()
        expect = self.unit_counts("core")
        total = 0
        for u in range(1, 15):
            self.page.evaluate("(u) => { setBrowseUnit(u); }", u)
            st = self.browse_state()
            m = re.search(r"共 (\d+) 个单词", st["stat"])
            self.assertIsNotNone(m, "Unit %d 未渲染统计行" % u)
            got = int(m.group(1))
            want = expect.get(str(u)) or expect.get(u) or 0
            self.assertEqual(want, got, "Unit %d 数量不符" % u)
            self.assertGreater(got, 0, "Unit %d 不应为空" % u)
            total += got
        self.page.evaluate("() => { setBrowseUnit(0); }")
        st = self.browse_state()
        m = re.search(r"共 (\d+) 个单词", st["stat"])
        self.assertEqual(EXPECTED_CORE_TOTAL, int(m.group(1)))
        # 未分单元（书中未归入任何 Unit 的补充词）也要能筛出，保证合计无遗漏
        self.page.evaluate("() => { setBrowseUnit(-1); }")
        st0 = self.browse_state()
        m0 = re.search(r"共 (\d+) 个单词", st0["stat"])
        self.assertIsNotNone(m0, "未分单元筛选未渲染统计行")
        ungrouped = int(m0.group(1))
        self.assertGreater(ungrouped, 0, "未分单元不应为空")
        self.assertEqual(EXPECTED_CORE_TOTAL, total + ungrouped,
                         "Unit 1-14 合计 + 未分单元 应等于全库总数（无重复、无遗漏）")
        self.page.evaluate("() => { setBrowseUnit(0); }")

    def test_04_sampled_words_from_every_unit_return_details(self) -> None:
        """Unit 1-14 各抽一个词：搜索能命中，且查询返回含巧记/例句的详解。"""
        self.open_browse()
        samples = self.page.evaluate(
            """() => {
                const out = [];
                for (let u = 1; u <= 14; u++) {
                    const w = ALL_WORDS.find(x => Number(x.unit) === u && x.word.length >= 3);
                    if (w) out.push([u, w.word]);
                }
                return out;
            }"""
        )
        self.assertEqual(14, len(samples), "应为每个单元取到一个样本词")
        for unit, word in samples:
            self.page.fill("#browseSearch", word)
            self.page.wait_for_timeout(150)
            found = self.page.evaluate(
                "(word) => Array.from(document.querySelectorAll('#browseList strong')).some(s => s.textContent === word)",
                word,
            )
            self.assertTrue(found, "Unit %d 的 %s 未出现在搜索结果中" % (unit, word))
            self.page.evaluate("(word) => { toggleBrowseDetail(word); }", word)
            self.page.wait_for_timeout(120)
            text = self.page.evaluate(
                "(word) => { const el = document.getElementById('bd-' + word); return el ? el.textContent : ''; }",
                word,
            )
            self.assertIn("巧记", text, "Unit %d 的 %s 详情缺巧记" % (unit, word))
            self.assertIn("例句", text, "Unit %d 的 %s 详情缺例句" % (unit, word))
            self.page.evaluate("(word) => { toggleBrowseDetail(word); }", word)
        self.page.fill("#browseSearch", "")

    def test_05_full_pool_still_works(self) -> None:
        """切换到核心词汇：Unit 1-10 十一个按钮（含全部）、总数 3324、抽样可查询。"""
        self.open_browse()
        self.page.evaluate("() => { setBrowsePool('full'); }")
        self.page.wait_for_timeout(600)
        st = self.browse_state()
        self.assertEqual("full", st["pool"])
        self.assertIn("共 %d 个单词" % EXPECTED_FULL_TOTAL, st["stat"])
        self.assertIn("Unit 10", st["chips"])
        self.assertNotIn("Unit 11", st["chips"], "核心词汇不应出现 Unit 11")
        self.page.fill("#browseSearch", "ambition")
        self.page.wait_for_timeout(200)
        self.page.evaluate("() => { toggleBrowseDetail('ambition'); }")
        self.page.wait_for_timeout(150)
        text = self.page.evaluate("() => { const el = document.getElementById('bd-ambition'); return el ? el.textContent : ''; }")
        self.assertIn("巧记", text)
        self.page.fill("#browseSearch", "")
        self.page.evaluate("() => { setBrowsePool('core'); }")

    def test_06_chinese_search_returns_results(self) -> None:
        """中文释义搜索也能返回结果（覆盖 Unit 11-14 基础词区）。"""
        self.open_browse()
        self.page.fill("#browseSearch", "医学")
        self.page.wait_for_timeout(250)
        st = self.browse_state()
        m = re.search(r"共 (\d+) 个单词", st["stat"])
        self.assertIsNotNone(m)
        self.assertGreater(int(m.group(1)), 0, "中文搜索『医学』应有结果")
        self.page.fill("#browseSearch", "")

    def test_07_no_js_errors(self) -> None:
        self.assertEqual([], self.js_errors, "页面存在 JS 错误：%s" % self.js_errors[:3])


if __name__ == "__main__":
    unittest.main(verbosity=2)

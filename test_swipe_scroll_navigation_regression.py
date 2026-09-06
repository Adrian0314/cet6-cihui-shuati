"""Regression coverage for swipe navigation scope and arrow-key page scrolling.

1. 手机端做题时，非全屏与全屏页面都支持左右滑动切换上一题/下一题；
2. 记忆模式下滑动不切题（做完一题即从队列移除，滑动会跳过未作答的词）；
3. 纵向为主的触摸不触发切题（保留页面滚动），起点在按钮/输入框上的
   触摸也不触发切题；
4. 电脑端做题时 ↑/↓ 方向键滚动页面。
"""

import unittest
from pathlib import Path

from playwright.sync_api import Browser, Playwright, sync_playwright


QUIZ_HTML = Path(__file__).with_name("cet6_quiz.html")

START_QUIZ_JS = """
() => {
    localStorage.setItem('cet6_onboarded', '1');
}
"""

SWIPE_JS = """
(args) => {
    const card = document.getElementById('quizCard');
    const blocked = (el) => !!(el && el.closest &&
        el.closest('button,input,textarea,select,a,canvas,.gmap-wrap,.question-progress'));
    const crect = card.getBoundingClientRect();
    const dx = args.dx;
    const dy = args.dy || 0;
    // 在卡片上找一条起点/终点都不落在交互元素上的横向路径（按钮行附近
    // 可能没有空隙，逐行扫描即可），与真实用户在空白处滑动的行为一致。
    let chosen = null;
    for (let fy = 0.15; fy <= 0.85 && !chosen; fy += 0.05) {
        const y = crect.top + crect.height * fy;
        for (let fx = 0.05; fx <= 0.6; fx += 0.05) {
            const x1 = crect.left + crect.width * (dx > 0 ? fx : 1 - fx);
            const x2 = x1 + dx;
            if (x2 < crect.left + 2 || x2 > crect.right - 2) continue;
            if (!blocked(document.elementFromPoint(x1, y)) && !blocked(document.elementFromPoint(x2, y))) {
                chosen = { x1, x2, y };
                break;
            }
        }
    }
    const before = quizState.pos;
    if (!chosen) return { before, after: quizState.pos, noClearPath: true };
    const touch = (type, x, y) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        const point = { clientX: x, clientY: y };
        Object.defineProperty(event, type === 'touchstart' ? 'touches' : 'changedTouches', { value: [point] });
        card.dispatchEvent(event);
    };
    touch('touchstart', chosen.x1, chosen.y);
    touch('touchend', chosen.x2, chosen.y + dy);
    return { before, after: quizState.pos, fullscreen: card.classList.contains('fullscreen') };
}
"""


class SwipeScrollNavigationRegressionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.playwright: Playwright = sync_playwright().start()
        cls.browser: Browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.browser.close()
        cls.playwright.stop()

    def _start_quiz(self, viewport, mobile):
        context = self.browser.new_context(viewport=viewport, has_touch=mobile, is_mobile=mobile)
        page = context.new_page()
        page.goto(QUIZ_HTML.as_uri(), wait_until="load")
        page.evaluate(START_QUIZ_JS)
        page.reload(wait_until="load")
        page.select_option('#gateSelect', '2')
        page.click('button:has-text("开始做题")')
        page.wait_for_selector('.opt-btn')
        return context, page

    def test_swipe_navigates_questions_outside_fullscreen(self) -> None:
        context, page = self._start_quiz({'width': 390, 'height': 844}, mobile=True)
        try:
            result = page.evaluate(SWIPE_JS, {"dx": -160})
            self.assertEqual(0, result["before"])
            self.assertFalse(result["fullscreen"])
            self.assertEqual(1, result["after"], "非全屏左滑应切换到下一题")

            result = page.evaluate(SWIPE_JS, {"dx": 160})
            self.assertEqual(1, result["before"])
            self.assertEqual(0, result["after"], "右滑应回到上一题")
        finally:
            context.close()

    def test_swipe_navigates_questions_in_fullscreen(self) -> None:
        context, page = self._start_quiz({'width': 390, 'height': 844}, mobile=True)
        try:
            page.click('#toggleFsBtn')
            page.wait_for_function("() => document.getElementById('quizCard').classList.contains('fullscreen')")
            result = page.evaluate(SWIPE_JS, {"dx": -160})
            self.assertTrue(result["fullscreen"])
            self.assertEqual(1, result["after"], "全屏左滑应切换到下一题")
        finally:
            context.close()

    def test_swipe_is_ignored_in_memory_mode(self) -> None:
        context, page = self._start_quiz({'width': 390, 'height': 844}, mobile=True)
        try:
            page.evaluate("() => { quizState.isMemory = true; }")
            result = page.evaluate(SWIPE_JS, {"dx": -160})
            self.assertEqual(result["before"], result["after"], "记忆模式下滑动不应切题")
        finally:
            context.close()

    def test_vertical_dominant_touch_does_not_navigate(self) -> None:
        context, page = self._start_quiz({'width': 390, 'height': 844}, mobile=True)
        try:
            result = page.evaluate(SWIPE_JS, {"dx": -160, "dy": 300})
            self.assertEqual(result["before"], result["after"], "纵向为主的触摸应保留页面滚动，不切题")
        finally:
            context.close()

    def test_swipe_starting_on_option_button_does_not_navigate(self) -> None:
        context, page = self._start_quiz({'width': 390, 'height': 844}, mobile=True)
        try:
            result = page.evaluate(
                """() => {
                    const card = document.getElementById('quizCard');
                    const btn = card.querySelector('.opt-btn');
                    const rect = btn.getBoundingClientRect();
                    const touch = (type, x, y) => {
                        const event = new Event(type, { bubbles: true, cancelable: true });
                        const point = { clientX: x, clientY: y };
                        Object.defineProperty(event, type === 'touchstart' ? 'touches' : 'changedTouches', { value: [point] });
                        btn.dispatchEvent(event);
                    };
                    const before = quizState.pos;
                    touch('touchstart', rect.left + rect.width / 2, rect.top + rect.height / 2);
                    touch('touchend', rect.left + rect.width / 2 - 160, rect.top + rect.height / 2);
                    return { before, after: quizState.pos };
                }"""
            )
            self.assertEqual(result["before"], result["after"], "起点在选项按钮上的滑动不应切题")
        finally:
            context.close()

    def test_arrow_keys_scroll_page_during_quiz(self) -> None:
        context, page = self._start_quiz({'width': 800, 'height': 600}, mobile=False)
        try:
            page.evaluate("() => window.scrollTo(0, 0)")
            page.keyboard.press('ArrowDown')
            page.keyboard.press('ArrowDown')
            top_after_down = page.evaluate("() => window.scrollY")
            self.assertGreaterEqual(top_after_down, 100, "按下 ↓ 应向下滚动页面")

            page.keyboard.press('ArrowUp')
            page.keyboard.press('ArrowUp')
            top_after_up = page.evaluate("() => window.scrollY")
            self.assertLess(top_after_up, top_after_down, "按下 ↑ 应向上滚动页面")
            self.assertLessEqual(top_after_up, 0, "滚动位置不应低于页面顶部")
        finally:
            context.close()


if __name__ == "__main__":
    unittest.main()

"""Regression coverage for swipe navigation scope and arrow-key page scrolling.

1. 手机端做题时，非全屏与全屏页面都支持左右滑动切换上一题/下一题；
2. 记忆模式下滑动不切题（做完一题即从队列移除，滑动会跳过未作答的词）；
3. 纵向为主的触摸不触发切题（保留页面滚动），起点在按钮/输入框上的
   触摸也不触发切题；
4. 电脑端 ↑/↓ 方向键滚动页面：普通模式滚文档、全屏模式滚题卡内部的
   .quiz-scroll（全屏时 body 是 overflow:hidden，只滚文档会完全没反应）、
   词库等标签页滚其列表；焦点在输入框内时保持浏览器原生行为；
5. 切后台再回前台后，浏览器补发的旧事件（时间戳停留在切走前）既不作答也不切题，
   而回前台之后的真实点击仍然正常工作。
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
    // 手势闸门是同步的：滑动在 touchend 里立即生效，直接读结果即可。
    return {
        before, after: quizState.pos,
        fullscreen: card.classList.contains('fullscreen')
    };
}
"""

# 等待平滑滚动动画停稳：连续 3 帧位置不变才算结束（按下后立刻读位置会读到动画起点）。
SETTLE_SCROLL_JS = """
() => new Promise((resolve) => {
    let last = -1;
    let stable = 0;
    const tick = () => {
        const y = window.scrollY;
        if (y === last) {
            if (++stable >= 3) return resolve(true);
        } else {
            stable = 0;
            last = y;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
})
"""

# 伪造「切到后台 → 一段时间后回到前台」，并把切走时刻放在足够大的时基上：
# eventPerfTime 会把非正数时间戳当成"无法判定"（返回 0），基准线太靠近页面加载
# 时刻时补发时间戳会变成负数，陈旧判定就失效了。
ARROW_BACKGROUND_JS = """
([hiddenAgo, visibleAgo]) => {
    const now = performance.now();
    _ghostEverHidden = true;
    _ghostHiddenAt = now - hiddenAgo;
    _ghostVisibleAt = now - visibleAgo;
    _gesture = null;
    return { hiddenAt: _ghostHiddenAt };
}
"""

# 补发的旧方向键：时间戳停留在切走之前。
DISPATCH_ARROW_JS = """
(args) => {
    const el = document.querySelector('#quizCard .quiz-scroll');
    const doc = document.scrollingElement || document.documentElement;
    const read = () => (el && el.scrollHeight > el.clientHeight) ? el.scrollTop : doc.scrollTop;
    const ev = new KeyboardEvent('keydown', {
        key: args.dir, bubbles: true, cancelable: true
    });
    Object.defineProperty(ev, 'timeStamp', { value: args.ts });
    document.dispatchEvent(ev);
    return { before: read() };
}
"""

# 模拟"切到后台、过一会儿再切回前台"：把切走/回前台时刻写进闸门的基准线。
BACKGROUND_JS = """
([hiddenAgo, visibleAgo]) => {
    const now = performance.now();
    _ghostEverHidden = true;
    _ghostHiddenAt = now - hiddenAgo;
    _ghostVisibleAt = now - visibleAgo;
    _gesture = null;
    return true;
}
"""

# 浏览器在回到前台时补发的旧输入：完整序列 + 时间戳停留在切走之前。
GHOST_REPLAY_JS = """
() => {
    const card = document.getElementById('quizCard');
    const opt = card.querySelector('.opt-btn');
    const next = document.getElementById('nextBtn');
    const before = quizState.pos;
    const answeredBefore = !!quizState.answers[before];
    const hiddenAt = _ghostHiddenAt;
    const rect = opt.getBoundingClientRect();
    const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };

    const replay = (target, type, tx) => {
        let ev;
        if (type === 'click') {
            ev = new MouseEvent('click', { bubbles: true, cancelable: true });
        } else {
            ev = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(ev, type === 'touchstart' ? 'touches' : 'changedTouches',
                { value: [point] });
        }
        // 补发事件保留切走前的原始时间戳
        Object.defineProperty(ev, 'timeStamp', { value: tx });
        target.dispatchEvent(ev);
    };

    replay(card, 'touchstart', hiddenAt - 4000);   // 切走前的旧滑动
    replay(card, 'touchend', hiddenAt - 3990);
    replay(opt, 'touchstart', hiddenAt - 3000);    // 切走前的旧点选项
    replay(opt, 'touchend', hiddenAt - 2990);
    replay(opt, 'click', hiddenAt - 2980);
    if (next) replay(next, 'click', hiddenAt - 2900);  // 切走前的旧"下一题"点击

    return {
        before,
        after: quizState.pos,
        answeredBefore,
        answeredAfter: !!quizState.answers[before]
    };
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
        page.click('button:has-text("开始做题")', delay=60)
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
            page.click('#toggleFsBtn', delay=60)
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

    # ---- 切后台恢复：补发的旧事件必须被丢弃 -------------------------------

    def test_replayed_events_after_background_are_ignored(self) -> None:
        """切后台恢复后，浏览器补发的旧触摸/点击既不作答也不切题。"""
        context, page = self._start_quiz({'width': 390, 'height': 844}, mobile=True)
        try:
            page.evaluate(BACKGROUND_JS, [1000, 0])
            result = page.evaluate(GHOST_REPLAY_JS)
            self.assertEqual(result["before"], result["after"],
                             "补发的旧事件不应切换题目（点选项/点下一题都不行）")
            self.assertFalse(result["answeredBefore"])
            self.assertFalse(result["answeredAfter"],
                             "补发的旧点击不应把当前题作答掉")
        finally:
            context.close()

    def test_replayed_events_do_not_skip_question(self) -> None:
        """补发的旧事件不能把当前题「跳过」掉。"""
        context, page = self._start_quiz({'width': 390, 'height': 844}, mobile=True)
        try:
            page.evaluate(BACKGROUND_JS, [1000, 0])
            result = page.evaluate(
                """() => {
                    const hiddenAt = _ghostHiddenAt;
                    const skip = document.getElementById('skipBtn');
                    const before = quizState.pos;
                    for (const tx of [hiddenAt - 3000, hiddenAt - 2990, hiddenAt - 2980]) {
                        const ev = new MouseEvent('click', {
                            bubbles: true, cancelable: true, detail: 1
                        });
                        Object.defineProperty(ev, 'timeStamp', { value: tx });
                        skip.dispatchEvent(ev);
                    }
                    return { before, after: quizState.pos, answered: !!quizState.answers[before] };
                }"""
            )
            self.assertEqual(result["before"], result["after"], "补发的旧点击不应切题")
            self.assertFalse(result["answered"], "补发的旧点击不应触发「不会，跳过」")
        finally:
            context.close()

    def test_fresh_input_after_background_still_works(self) -> None:
        """回到前台之后的真实操作必须照常生效：答题、上一题、下一题都不受影响。"""
        context, page = self._start_quiz({'width': 390, 'height': 844}, mobile=True)
        try:
            page.evaluate(BACKGROUND_JS, [5000, 1500])
            page.click('#opt-0', delay=60)
            page.wait_for_function("() => document.getElementById('nextBtn').classList.contains('show')")
            pos_after_answer = page.evaluate("() => quizState.pos")
            self.assertTrue(
                page.evaluate(
                    "(p) => Object.prototype.hasOwnProperty.call(quizState.answers, p)",
                    pos_after_answer),
                "回前台后点选项应正常作答")

            page.click('#nextQBtn', delay=60)
            self.assertEqual(pos_after_answer + 1, page.evaluate("() => quizState.pos"),
                             "回前台后点「下一题」应正常切题")

            page.click('#prevQBtn', delay=60)
            self.assertEqual(pos_after_answer, page.evaluate("() => quizState.pos"),
                             "回前台后点「上一题」应正常回到上一题")
        finally:
            context.close()

    def test_fresh_swipe_after_background_still_works(self) -> None:
        """回前台后，滑动切题仍然可用（不会被防误触逻辑吞掉）。"""
        context, page = self._start_quiz({'width': 390, 'height': 844}, mobile=True)
        try:
            page.evaluate(BACKGROUND_JS, [5000, 1500])
            result = page.evaluate(SWIPE_JS, {"dx": -160})
            self.assertEqual(1, result["after"], "回前台后左滑应正常切到下一题")
            result = page.evaluate(SWIPE_JS, {"dx": 160})
            self.assertEqual(0, result["after"], "回前台后右滑应正常回到上一题")
        finally:
            context.close()

    def test_arrow_keys_scroll_page_during_quiz(self) -> None:
        context, page = self._start_quiz({'width': 800, 'height': 600}, mobile=False)
        try:
            page.evaluate("() => window.scrollTo(0, 0)")
            # 滚动是平滑动画，按下后要等它落定再读位置
            page.keyboard.press('ArrowDown')
            page.keyboard.press('ArrowDown')
            page.wait_for_function(SETTLE_SCROLL_JS)
            top_after_down = page.evaluate("() => window.scrollY")
            self.assertGreaterEqual(top_after_down, 100, "按下 ↓ 应向下滚动页面")

            page.keyboard.press('ArrowUp')
            page.keyboard.press('ArrowUp')
            page.wait_for_function(SETTLE_SCROLL_JS)
            top_after_up = page.evaluate("() => window.scrollY")
            self.assertLess(top_after_up, top_after_down, "按下 ↑ 应向上滚动页面")
            self.assertLessEqual(top_after_up, 0, "滚动位置不应低于页面顶部")
        finally:
            context.close()

    def test_arrow_keys_scroll_quiz_card_in_fullscreen(self) -> None:
        """全屏时 body 是 overflow:hidden，真正滚动的是题卡内部的 .quiz-scroll。

        旧实现写死 window.scrollBy，全屏下方向键毫无反应；矮视口让题面必然溢出
        （实测各题溢出量都在 200px 以上，远大于一次滚动的步长）。
        """
        context, page = self._start_quiz({'width': 800, 'height': 340}, mobile=False)
        try:
            page.click('#toggleFsBtn', delay=60)
            page.wait_for_function(
                "() => document.getElementById('quizCard').classList.contains('fullscreen')")
            page.wait_for_timeout(300)
            over = page.evaluate(
                "() => { const sc = document.querySelector('#quizCard .quiz-scroll');"
                " return sc.scrollHeight - sc.clientHeight; }")
            self.assertGreater(over, 0, "测试前提：全屏题卡的内容应超出视口高度")

            page.keyboard.press('ArrowDown')
            page.wait_for_function(
                "() => document.querySelector('#quizCard .quiz-scroll').scrollTop > 0")
            after_down = page.evaluate(
                "() => document.querySelector('#quizCard .quiz-scroll').scrollTop")
            self.assertGreater(after_down, 0, "全屏下按 ↓ 应滚动题卡内容")

            page.keyboard.press('ArrowUp')
            page.wait_for_function(
                "(top) => document.querySelector('#quizCard .quiz-scroll').scrollTop < top",
                arg=after_down)
            self.assertLess(
                page.evaluate(
                    "() => document.querySelector('#quizCard .quiz-scroll').scrollTop"),
                after_down, "全屏下按 ↑ 应向上滚动")
        finally:
            context.close()

    def test_arrow_keys_scroll_word_list_tab(self) -> None:
        """词库 / 错题本等标签页一样很长，方向键也该能翻。

        这条同时守住"按键处理不能只在做题时生效"这一条：切到词库标签页后
        quizActive 仍是 true，但真正的滚动容器已经换成列表自身的滚动条。
        """
        context, page = self._start_quiz({'width': 900, 'height': 600}, mobile=False)
        try:
            page.click('.tab-btn[data-tab="browse"]', delay=60)
            page.fill('#browseSearch', 'a')            # 填充列表使其可滚动
            page.wait_for_timeout(400)
            page.evaluate("() => document.activeElement.blur()")
            over = page.evaluate(
                "() => { const l = document.getElementById('browseList');"
                " return l.scrollHeight - l.clientHeight; }")
            self.assertGreater(over, 0, "测试前提：词库列表应超出其可视高度")

            page.keyboard.press('ArrowDown')
            page.wait_for_function(
                "() => document.getElementById('browseList').scrollTop > 0")
            self.assertGreater(
                page.evaluate("() => document.getElementById('browseList').scrollTop"), 0,
                "词库列表页按 ↓ 应滚动列表")

            page.keyboard.press('ArrowUp')
            page.wait_for_function(
                "() => document.getElementById('browseList').scrollTop === 0")
        finally:
            context.close()

    def test_arrow_keys_leave_text_fields_to_browser(self) -> None:
        """焦点在输入框内时，方向键属于浏览器原生行为（移动光标/翻候选），不该被抢走。"""
        context, page = self._start_quiz({'width': 900, 'height': 600}, mobile=False)
        try:
            page.click('.tab-btn[data-tab="browse"]', delay=60)
            page.fill('#browseSearch', 'a')
            page.wait_for_timeout(400)
            page.evaluate(
                "() => { document.getElementById('browseList').scrollTop = 0; window.scrollTo(0, 0); }")
            page.focus('#browseSearch')
            self.assertEqual('browseSearch',
                             page.evaluate("() => document.activeElement.id"))

            page.keyboard.press('ArrowDown')
            page.wait_for_timeout(700)
            self.assertEqual(
                0, page.evaluate("() => document.getElementById('browseList').scrollTop"),
                "输入框内的方向键不应滚动列表")
            self.assertEqual(0, page.evaluate("() => window.scrollY"),
                             "输入框内的方向键不应滚动页面")
        finally:
            context.close()

    def test_replayed_arrow_key_after_resume_does_not_scroll(self) -> None:
        """切后台期间积压的旧方向键（时间戳停留在切走前）不应把页面顶走。"""
        context, page = self._start_quiz({'width': 800, 'height': 600}, mobile=False)
        try:
            page.wait_for_function("() => performance.now() > 3000")
            info = page.evaluate(ARROW_BACKGROUND_JS, [2500, 200])
            self.assertGreater(info["hiddenAt"], 0,
                               "测试前提：切后台时刻应是正数时间戳")

            page.evaluate("() => window.scrollTo(0, 0)")
            page.evaluate(DISPATCH_ARROW_JS,
                          {"dir": "ArrowDown", "ts": info["hiddenAt"] - 400})
            page.wait_for_timeout(700)
            self.assertEqual(0, page.evaluate("() => window.scrollY"),
                             "补发的旧方向键不应滚动页面")

            # 回前台之后的真实按键照常生效
            page.keyboard.press('ArrowDown')
            page.wait_for_function("() => window.scrollY > 0")
        finally:
            context.close()


if __name__ == "__main__":
    unittest.main()

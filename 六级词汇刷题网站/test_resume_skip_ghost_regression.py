"""Regression coverage for the post-background ghost-skip bug (切后台恢复误跳过).

Run from this directory:
    python .\\test_resume_skip_ghost_regression.py

Simulates the Android Chrome behaviour that skips a question the moment the
user taps an option after returning from another app: the queued touch from
BEFORE the app switch is replayed on the skip button, flushed together with
the user's next tap. Replays may arrive as a bare compat mouse sequence
(mousedown/mouseup/click — no new pointer start) or as a full pointer/touch
replay (pointerdown/pointerup/touchstart/touchend + click).

The fix stacks three defences:
  1. a skip click must be preceded by a real pointer/touch start-or-end on
     the skip button within 1.5s (bare compat replays fail here);
  2. a skip click within 350ms of option activity is rejected outright
     (one finger cannot press two buttons);
  3. handleSkip is deferred by one macrotask, so an option click in the same
     input burst always answers first and vetoes the pending skip.
"""

import time
from pathlib import Path
import unittest

from playwright.sync_api import Browser, Page, Playwright, sync_playwright


QUIZ_HTML = Path(__file__).with_name("cet6_quiz.html")

SIMULATE_RESUME_JS = """
() => {
    // 模拟切后台 → 切回前台：触发 visibilitychange 的两个分支（armResumeInputGuard）
    window.__fakeHidden = true;
    Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => window.__fakeHidden
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.__fakeHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
}
"""

DISPATCH_JS = """
(spec) => {
    // spec: {sel: '#skipBtn', seq: ['mousedown','pointerdown','click', ...]}
    const el = document.querySelector(spec.sel);
    if (!el) return 'missing: ' + spec.sel;
    spec.seq.forEach((kind) => {
        let ev;
        if (kind === 'pointerdown' || kind === 'pointerup') {
            ev = new PointerEvent(kind, { bubbles: true, cancelable: true });
        } else if (kind === 'touchstart' || kind === 'touchend') {
            ev = new Event(kind, { bubbles: true, cancelable: true });
        } else {
            ev = new MouseEvent(kind, { bubbles: true, cancelable: true });
        }
        el.dispatchEvent(ev);
    });
    return 'ok';
}
"""

DISPATCH_ON_FIRST_OPTION_JS = """
(seq) => {
    const el = document.querySelector('.quiz-card .opt-btn:not([disabled])');
    if (!el) return 'missing option';
    seq.forEach((kind) => {
        let ev;
        if (kind === 'pointerdown' || kind === 'pointerup') {
            ev = new PointerEvent(kind, { bubbles: true, cancelable: true });
        } else if (kind === 'touchstart' || kind === 'touchend') {
            ev = new Event(kind, { bubbles: true, cancelable: true });
        } else {
            ev = new MouseEvent(kind, { bubbles: true, cancelable: true });
        }
        el.dispatchEvent(ev);
    });
    return 'ok';
}
"""

QUIZ_STATE_JS = """
() => ({
    active: quizActive,
    hasAnswer: !!(quizState && quizState.answers &&
                  Object.prototype.hasOwnProperty.call(quizState.answers, quizState.pos)),
    answer: quizState && quizState.answers ? quizState.answers[quizState.pos] : null,
    feedback: (document.getElementById('feedback') || { textContent: '' }).textContent
})
"""

# 跳过现在延迟 200ms 执行（选项批次否决窗口），断言前留出执行窗口
SKIP_SETTLE_MS = 400


class ResumeSkipGhostRegressionTest(unittest.TestCase):
    playwright: Playwright
    browser: Browser

    @classmethod
    def setUpClass(cls) -> None:
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self) -> None:
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.page.add_init_script("localStorage.setItem('cet6_onboarded', '1');")
        self.page.goto(QUIZ_HTML.as_uri(), wait_until="load")
        # 固定为「大纲词汇 + 选择题 + 关闭记忆模式」，避免默认记忆模式改变队列行为
        self.page.locator("#poolSelect").select_option("core")
        self.page.locator("#memoryBtn").click()
        self.page.locator("#startBtn").click()
        self.page.wait_for_selector(".opt-btn")

    def tearDown(self) -> None:
        self.context.close()

    # ---------- helpers ----------

    def state(self) -> dict:
        return self.page.evaluate(QUIZ_STATE_JS)

    def dispatch(self, sel: str, seq: list) -> None:
        result = self.page.evaluate(DISPATCH_JS, {"sel": sel, "seq": seq})
        self.assertEqual("ok", result)

    def dispatch_on_first_option(self, seq: list) -> None:
        result = self.page.evaluate(DISPATCH_ON_FIRST_OPTION_JS, seq)
        self.assertEqual("ok", result)

    def settle(self) -> None:
        self.page.wait_for_timeout(SKIP_SETTLE_MS)

    def simulate_background_resume(self) -> None:
        self.page.evaluate(SIMULATE_RESUME_JS)

    # ---------- tests ----------

    def test_01_ghost_compat_click_after_resume_is_ignored(self) -> None:
        """恢复后补发的兼容鼠标序列（mousedown/mouseup/click）不得跳过当前题。"""
        self.simulate_background_resume()
        self.dispatch("#skipBtn", ["mousedown", "mouseup", "click"])
        self.settle()
        st = self.state()
        self.assertFalse(st["hasAnswer"], "补发的旧 skip click 不应生效")
        self.assertNotIn("已跳过", st["feedback"])

    def test_02_ghost_flush_between_option_events_does_not_skip(self) -> None:
        """用户点击选项时夹在中间补发的 skip click：选项正常作答，不误跳过。"""
        self.simulate_background_resume()
        # 用户手指按下选项（真实输入开始）
        self.dispatch_on_first_option(["pointerdown"])
        # 浏览器此刻补发切走前的旧触点序列到跳过按钮上
        self.dispatch("#skipBtn", ["mousedown", "mouseup", "click"])
        # 用户手指抬起，选项的 click 正常派发
        self.dispatch_on_first_option(["click"])
        self.settle()
        st = self.state()
        self.assertTrue(st["hasAnswer"], "选项点击应正常作答")
        self.assertNotEqual("skip", st["answer"], "不得被补发事件跳过")
        self.assertNotIn("已跳过", st["feedback"])

    def test_03_detached_skip_button_click_after_resume_is_ignored(self) -> None:
        """脱离文档树的旧跳过按钮 click（上一题渲染前入队）不得生效。"""
        self.simulate_background_resume()
        result = self.page.evaluate(
            """() => {
                const skip = document.getElementById('skipBtn');
                if (!skip) return 'missing skipBtn';
                const stale = skip.cloneNode(true); // 旧渲染的残留节点
                stale.dispatchEvent(new MouseEvent('click', { cancelable: true })); // 不冒泡，绕过 document 捕获
                return 'ok';
            }"""
        )
        self.assertEqual("ok", result)
        self.settle()
        st = self.state()
        self.assertFalse(st["hasAnswer"], "脱离文档树的旧 click 不应生效")
        self.assertNotIn("已跳过", st["feedback"])

    def test_04_real_skip_after_resume_still_works(self) -> None:
        """恢复后真实点击跳过按钮（pointer 按下→抬起→click）应正常跳过。"""
        self.simulate_background_resume()
        self.dispatch("#skipBtn", ["pointerdown", "pointerup", "click"])
        self.settle()
        st = self.state()
        self.assertEqual("skip", st["answer"], "真实跳过点击应生效")
        self.assertIn("已跳过", st["feedback"])

    def test_05_touch_skip_after_resume_still_works(self) -> None:
        """恢复后真实触摸跳过按钮（touchstart→touchend→click）应正常跳过。"""
        self.simulate_background_resume()
        self.dispatch("#skipBtn", ["touchstart", "touchend", "click"])
        self.settle()
        st = self.state()
        self.assertEqual("skip", st["answer"], "真实触摸跳过应生效")
        self.assertIn("已跳过", st["feedback"])

    def test_06_ghost_click_without_resume_is_ignored(self) -> None:
        """未发生切后台时，无起手的裸 skip click 同样被拒（覆盖页面被回收后重载的场景）。"""
        self.dispatch("#skipBtn", ["mousedown", "mouseup", "click"])
        self.settle()
        st = self.state()
        self.assertFalse(st["hasAnswer"], "无真实起手的 click 不应生效")
        self.assertNotIn("已跳过", st["feedback"])

    def test_07_long_press_skip_still_works(self) -> None:
        """长按跳过按钮（按下超过 1.5 秒后松手）应正常跳过：pointerup 会刷新起手时间。"""
        self.page.evaluate(
            """() => {
                const skip = document.getElementById('skipBtn');
                skip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            }"""
        )
        self.page.wait_for_timeout(1800)
        self.dispatch("#skipBtn", ["pointerup", "click"])
        self.settle()
        st = self.state()
        self.assertEqual("skip", st["answer"], "长按后松手的跳过应生效")
        self.assertIn("已跳过", st["feedback"])

    def test_08_keyboard_space_skip_works(self) -> None:
        """键盘空格跳过（真实键盘输入）不受影响。"""
        self.page.evaluate(
            """() => {
                document.body.dispatchEvent(new KeyboardEvent('keydown', {
                    key: ' ', bubbles: true, cancelable: true
                }));
            }"""
        )
        self.settle()
        st = self.state()
        self.assertEqual("skip", st["answer"], "空格跳过应生效")
        self.assertIn("已跳过", st["feedback"])

    def test_09_normal_option_answer_regression(self) -> None:
        """常规答题不受影响：点击选项正常记录答案。"""
        self.simulate_background_resume()
        self.page.locator(".quiz-card .opt-btn:not([disabled])").first.click()
        st = self.state()
        self.assertTrue(st["hasAnswer"], "点击选项应正常作答")
        self.assertNotEqual("skip", st["answer"])

    def test_10_full_pointer_replay_between_option_events_does_not_skip(self) -> None:
        """补发为完整指针序列（pointerdown/up+click）且夹在选项按下与抬起之间：
        选项必须正常作答，不得被跳过取代。"""
        self.simulate_background_resume()
        self.dispatch_on_first_option(["pointerdown"])
        self.dispatch("#skipBtn", ["pointerdown", "pointerup", "click"])
        self.dispatch_on_first_option(["click"])
        self.settle()
        st = self.state()
        self.assertTrue(st["hasAnswer"], "选项点击应正常作答")
        self.assertNotEqual("skip", st["answer"], "完整指针重放不得跳过本题")
        self.assertNotIn("已跳过", st["feedback"])

    def test_11_full_touch_replay_between_option_events_does_not_skip(self) -> None:
        """补发为完整触摸序列（touchstart/end+click）且夹在选项按下与抬起之间。"""
        self.simulate_background_resume()
        self.dispatch_on_first_option(["touchstart"])
        self.dispatch("#skipBtn", ["touchstart", "touchend", "click"])
        self.dispatch_on_first_option(["click"])
        self.settle()
        st = self.state()
        self.assertTrue(st["hasAnswer"], "选项点击应正常作答")
        self.assertNotEqual("skip", st["answer"], "完整触摸重放不得跳过本题")
        self.assertNotIn("已跳过", st["feedback"])

    def test_12_full_pointer_replay_before_option_press_is_vetoed(self) -> None:
        """补发的完整指针序列先于用户选项点击到达（先跳后答顺序）：
        延迟一拍执行让选项作答否决跳过。"""
        self.simulate_background_resume()
        self.dispatch("#skipBtn", ["pointerdown", "pointerup", "click"])
        self.dispatch_on_first_option(["click"])
        self.settle()
        st = self.state()
        self.assertTrue(st["hasAnswer"], "用户的选项点击应正常作答")
        self.assertNotEqual("skip", st["answer"], "补发跳过应被选项作答否决")
        self.assertNotIn("已跳过", st["feedback"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

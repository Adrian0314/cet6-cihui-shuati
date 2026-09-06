"""Regression coverage for the post-background ghost-skip bug (切后台恢复误跳过).

Run from this directory:
    python .\\test_resume_skip_ghost_regression.py

Simulates the Android Chrome behaviour that skips a question the moment the
user taps an option after returning from another app: the queued touch from
BEFORE the app switch is replayed on the skip button, flushed together with
the user's next tap. Replays may take three shapes:
  a. bare compat mouse sequence (mousedown/mouseup/click — no pointer start);
  b. full pointer/touch replay with original pre-background event timestamps;
  c. full pointer/touch replay flushed as a compressed burst (down→up ≈ 0ms).

The fix stacks four defences in handleSkip/noteSkipPointer:
  1. freshness: a skip click needs a pointer/touch start-or-end on the skip
     button within 1.5s (defeats shape a);
  2. timestamp gate: arming events older than the last background transition
     are rejected (defeats shape b — replays keep their original timestamps);
  3. compression gate: a down→up pair compressed under 25ms is not a human
     tap (defeats shape c);
  4. option-batch veto: option activity within 350ms (before) or an option
     click landing during the 200ms defer window vetoes the skip — tapping an
     option can never be replaced by a skip, whatever the event order.
"""

from pathlib import Path
import unittest

from playwright.sync_api import Browser, Page, Playwright, sync_playwright


QUIZ_HTML = Path(__file__).with_name("cet6_quiz.html")

SIMULATE_RESUME_JS = """
() => {
    // 模拟切后台 → 切回前台：触发 visibilitychange 的两个分支（armResumeInputGuard）。
    // 返回切后台时刻（performance.now 时基），供伪造“切后台前”的事件时间戳使用。
    window.__fakeHidden = true;
    Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => window.__fakeHidden
    });
    document.dispatchEvent(new Event('visibilitychange'));
    const hiddenAt = performance.now();
    window.__fakeHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    return hiddenAt;
}
"""

DISPATCH_JS = """
(spec) => {
    // spec: {sel, seq}；seq 元素为字符串或 {kind, ts}（ts 用于伪造事件时间戳）
    const el = document.querySelector(spec.sel);
    if (!el) return 'missing: ' + spec.sel;
    spec.seq.forEach((item) => {
        const kind = typeof item === 'string' ? item : item.kind;
        let ev;
        if (kind === 'pointerdown' || kind === 'pointerup') {
            ev = new PointerEvent(kind, { bubbles: true, cancelable: true });
        } else if (kind === 'touchstart' || kind === 'touchend') {
            ev = new Event(kind, { bubbles: true, cancelable: true });
        } else {
            ev = new MouseEvent(kind, { bubbles: true, cancelable: true });
        }
        if (typeof item === 'object' && item.ts !== undefined) {
            Object.defineProperty(ev, 'timeStamp', { value: item.ts });
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

# 跳过延迟 200ms 执行（选项批次否决窗口），断言前留出执行窗口
SKIP_SETTLE_MS = 400
# 人手点按的按下→抬起间隔（须 ≥25ms 才被认作真实起手）
HUMAN_TAP_GAP_MS = 70


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

    def simulate_background_resume(self) -> int:
        """切后台再切回，返回切后台时刻（performance.now 时基）。"""
        return self.page.evaluate(SIMULATE_RESUME_JS)

    def human_skip_tap(self, pre_hidden_ts: int = None) -> None:
        """以人手节奏点击跳过按钮（按下→70ms→抬起→click）。"""
        down = {"kind": "pointerdown"}
        up = {"kind": "pointerup"}
        if pre_hidden_ts is not None:
            down["ts"] = pre_hidden_ts
            up["ts"] = pre_hidden_ts + HUMAN_TAP_GAP_MS
        self.dispatch("#skipBtn", [down])
        self.page.wait_for_timeout(HUMAN_TAP_GAP_MS)
        self.dispatch("#skipBtn", [up])
        self.page.wait_for_timeout(30)
        self.dispatch("#skipBtn", ["click"])

    # ---------- tests ----------

    def test_01_ghost_compat_click_after_resume_is_ignored(self):
        """恢复后补发的兼容鼠标序列（mousedown/mouseup/click）不得跳过当前题。"""
        self.simulate_background_resume()
        self.dispatch("#skipBtn", ["mousedown", "mouseup", "click"])
        self.settle()
        st = self.state()
        self.assertFalse(st["hasAnswer"], "补发的旧 skip click 不应生效")
        self.assertNotIn("已跳过", st["feedback"])

    def test_02_ghost_flush_between_option_events_does_not_skip(self):
        """用户点击选项时夹在中间补发的 skip click：选项正常作答，不误跳过。"""
        self.simulate_background_resume()
        self.dispatch_on_first_option(["pointerdown"])
        self.dispatch("#skipBtn", ["mousedown", "mouseup", "click"])
        self.dispatch_on_first_option(["click"])
        self.settle()
        st = self.state()
        self.assertTrue(st["hasAnswer"], "选项点击应正常作答")
        self.assertNotEqual("skip", st["answer"], "不得被补发事件跳过")
        self.assertNotIn("已跳过", st["feedback"])

    def test_03_detached_skip_button_click_after_resume_is_ignored(self):
        """脱离文档树的旧跳过按钮 click（上一题渲染前入队）不得生效。"""
        self.simulate_background_resume()
        result = self.page.evaluate(
            """() => {
                const skip = document.getElementById('skipBtn');
                if (!skip) return 'missing skipBtn';
                const stale = skip.cloneNode(true);
                stale.dispatchEvent(new MouseEvent('click', { cancelable: true }));
                return 'ok';
            }"""
        )
        self.assertEqual("ok", result)
        self.settle()
        st = self.state()
        self.assertFalse(st["hasAnswer"], "脱离文档树的旧 click 不应生效")
        self.assertNotIn("已跳过", st["feedback"])

    def test_04_real_skip_after_resume_still_works(self):
        """恢复后真实点击跳过按钮（按下→抬起→click）应正常跳过。"""
        self.simulate_background_resume()
        self.human_skip_tap()
        self.settle()
        st = self.state()
        self.assertEqual("skip", st["answer"], "真实跳过点击应生效")
        self.assertIn("已跳过", st["feedback"])

    def test_05_touch_skip_after_resume_still_works(self):
        """恢复后真实触摸跳过按钮（touchstart→touchend→click）应正常跳过。"""
        self.simulate_background_resume()
        self.dispatch("#skipBtn", ["touchstart"])
        self.page.wait_for_timeout(HUMAN_TAP_GAP_MS)
        self.dispatch("#skipBtn", ["touchend"])
        self.page.wait_for_timeout(30)
        self.dispatch("#skipBtn", ["click"])
        self.settle()
        st = self.state()
        self.assertEqual("skip", st["answer"], "真实触摸跳过应生效")
        self.assertIn("已跳过", st["feedback"])

    def test_06_ghost_click_without_resume_is_ignored(self):
        """未发生切后台时，无起手的裸 skip click 同样被拒（覆盖页面被回收后重载的场景）。"""
        self.dispatch("#skipBtn", ["mousedown", "mouseup", "click"])
        self.settle()
        st = self.state()
        self.assertFalse(st["hasAnswer"], "无真实起手的 click 不应生效")
        self.assertNotIn("已跳过", st["feedback"])

    def test_07_long_press_skip_still_works(self):
        """长按跳过按钮（按下超过 1.5 秒后松手）应正常跳过。"""
        self.dispatch("#skipBtn", ["pointerdown"])
        self.page.wait_for_timeout(1800)
        self.dispatch("#skipBtn", ["pointerup"])
        self.page.wait_for_timeout(30)
        self.dispatch("#skipBtn", ["click"])
        self.settle()
        st = self.state()
        self.assertEqual("skip", st["answer"], "长按后松手的跳过应生效")
        self.assertIn("已跳过", st["feedback"])

    def test_08_keyboard_space_skip_works(self):
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

    def test_09_normal_option_answer_regression(self):
        """常规答题不受影响：点击选项正常记录答案。"""
        self.simulate_background_resume()
        self.page.locator(".quiz-card .opt-btn:not([disabled])").first.click()
        st = self.state()
        self.assertTrue(st["hasAnswer"], "点击选项应正常作答")
        self.assertNotEqual("skip", st["answer"])

    def test_10_compressed_pointer_replay_between_option_events_does_not_skip(self):
        """补发为压缩冲刷的完整指针序列（按下→抬起≈0ms）夹在选项事件之间：
        选项正常作答，不误跳过。"""
        self.simulate_background_resume()
        self.dispatch_on_first_option(["pointerdown"])
        self.dispatch("#skipBtn", ["pointerdown", "pointerup", "click"])
        self.dispatch_on_first_option(["click"])
        self.settle()
        st = self.state()
        self.assertTrue(st["hasAnswer"], "选项点击应正常作答")
        self.assertNotEqual("skip", st["answer"], "压缩重放不得跳过本题")
        self.assertNotIn("已跳过", st["feedback"])

    def test_11_full_pointer_replay_with_pre_background_timestamps_is_ignored(self):
        """补发保留切后台前时间戳的完整指针重放（即使节奏像人手）不得跳过。"""
        hidden_at = self.simulate_background_resume()
        # 伪造“切后台前 1 秒”的时间戳（须为正数，时间戳≤0 会被兜底放行）
        pre_ts = max(5.0, hidden_at - 1000.0)
        self.human_skip_tap(pre_hidden_ts=pre_ts)
        self.settle()
        st = self.state()
        self.assertFalse(st["hasAnswer"], "切后台前的旧触摸重放不应生效")
        self.assertNotIn("已跳过", st["feedback"])

    def test_12_compressed_touch_replay_between_option_events_does_not_skip(self):
        """补发为压缩冲刷的完整触摸序列夹在选项事件之间：选项正常作答。"""
        self.simulate_background_resume()
        self.dispatch_on_first_option(["touchstart"])
        self.dispatch("#skipBtn", ["touchstart", "touchend", "click"])
        self.dispatch_on_first_option(["click"])
        self.settle()
        st = self.state()
        self.assertTrue(st["hasAnswer"], "选项点击应正常作答")
        self.assertNotEqual("skip", st["answer"], "压缩触摸重放不得跳过本题")
        self.assertNotIn("已跳过", st["feedback"])

    def test_13_realistic_pointer_replay_before_option_click_is_vetoed(self):
        """节奏像人手的完整指针重放先于用户选项点击到达（先跳后答顺序）：
        延迟执行让选项作答否决跳过。"""
        self.simulate_background_resume()
        self.human_skip_tap()
        self.dispatch_on_first_option(["click"])
        self.settle()
        st = self.state()
        self.assertTrue(st["hasAnswer"], "用户的选项点击应正常作答")
        self.assertNotEqual("skip", st["answer"], "补发跳过应被选项作答否决")
        self.assertNotIn("已跳过", st["feedback"])

    def test_14_touch_replay_with_pre_background_timestamps_is_ignored(self):
        """补发保留切后台前时间戳的完整触摸重放不得跳过。"""
        hidden_at = self.simulate_background_resume()
        pre_ts = max(5.0, hidden_at - 1000.0)
        self.dispatch("#skipBtn", [
            {"kind": "touchstart", "ts": pre_ts},
            {"kind": "touchend", "ts": pre_ts + 100},
            "click",
        ])
        self.settle()
        st = self.state()
        self.assertFalse(st["hasAnswer"], "切后台前的旧触摸重放不应生效")
        self.assertNotIn("已跳过", st["feedback"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

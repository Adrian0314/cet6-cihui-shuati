"""Regression coverage for the post-background ghost-input bug (切后台恢复误触).

Run from this directory:
    python .\\test_resume_skip_ghost_regression.py

问题现场（Android Chrome / 全屏 WebView）：把做题页切到后台、过一段时间再切回
前台后，浏览器会把切走前积压的输入在回到前台时一次性补发。补发可能是

  a. 裸的兼容鼠标序列（mousedown/mouseup/click，没有指针/触摸起手）；
  b. 保留了切走前原始时间戳的完整 pointer/touch 重放；
  c. 被压缩冲刷的完整 pointer/touch 重放（down→up ≈ 0ms）。

它们落在选项、"不会，跳过"、"下一题"上就表现为"点一下选项却连跳好几题"
"想回上一题反而被切到下一题"。

现在的实现是"统一手势闸门"（cet6_quiz.html 里的 gestureAllows）：
  1. 起手时间戳必须晚于最近一次切到后台的时刻（命中 b）；
  2. 收尾事件必须落在当前手势里，时间戳不得倒流（命中 a：没有配对起手）；
  3. 一个手势只属于一个起手目标，点选项的手势触发不了下一题/跳过；
  4. 触摸手势 / 回前台保护窗口 / 触摸为主设备上的鼠标手势，都要求起手到收尾
     有真实人手耗时（命中 c）。
闸门里没有延迟执行、也没有冷却期，所以真人操作不会被吞掉，也不会执行两次。
"""

import unittest
from pathlib import Path

from playwright.sync_api import Browser, Page, Playwright, sync_playwright


QUIZ_HTML = Path(__file__).with_name("cet6_quiz.html")

# 模拟切后台 → 切回前台：走真实的 visibilitychange 分支，让闸门记录下基准线，
# 并返回切后台时刻（performance.now 时基），供伪造"切走前"的时间戳使用。
SIMULATE_RESUME_JS = """
() => {
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
    // spec: {sel, seq}; seq 元素为字符串或 {kind, ts, detail}
    // 返回每个事件是否被 preventDefault（用于断言重放事件被整事件取消）。
    const el = document.querySelector(spec.sel);
    if (!el) return { result: 'missing: ' + spec.sel, prevented: [] };
    const prevented = [];
    spec.seq.forEach((item) => {
        const kind = typeof item === 'string' ? item : item.kind;
        let ev;
        if (kind === 'pointerdown' || kind === 'pointerup') {
            ev = new PointerEvent(kind, { bubbles: true, cancelable: true });
        } else if (kind === 'touchstart' || kind === 'touchend') {
            ev = new Event(kind, { bubbles: true, cancelable: true });
        } else {
            ev = new MouseEvent(kind, {
                bubbles: true, cancelable: true,
                // 真实指针派生的 click 是 detail=1；detail=0 只属于键盘/辅助技术激活，
                // 需要显式指定。
                detail: (item && item.detail !== undefined) ? item.detail
                    : (kind === 'click' ? 1 : 0)
            });
        }
        if (typeof item === 'object' && item.ts !== undefined) {
            Object.defineProperty(ev, 'timeStamp', { value: item.ts });
        }
        el.dispatchEvent(ev);
        prevented.push(!!ev.defaultPrevented);
    });
    return { result: 'ok', prevented: prevented };
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

# 人手点按的按下→抬起间隔
HUMAN_TAP_GAP_MS = 70
# 闸门要求的最小人手耗时（见 cet6_quiz.html: GHOST_MIN_TAP_MS）
GHOST_MIN_TAP_MS = 24


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
        # 触摸为主的移动端上下文：与用户实际遇到问题的环境一致
        self.context = self.browser.new_context(has_touch=True, is_mobile=True)
        self.page = self.context.new_page()
        self.page.add_init_script("localStorage.setItem('cet6_onboarded', '1');")
        self.page.goto(QUIZ_HTML.as_uri(), wait_until="load")
        self.page.locator("#poolSelect").select_option("core")
        if self.page.evaluate("memoryModeOn()"):
            self.page.locator("#memoryBtn").click()
        self.page.locator("#startBtn").click()
        self.page.wait_for_selector(".opt-btn")

    def tearDown(self) -> None:
        self.context.close()

    # ---------- helpers ----------

    def state(self) -> dict:
        return self.page.evaluate(QUIZ_STATE_JS)

    def dispatch(self, sel: str, seq: list) -> dict:
        result = self.page.evaluate(DISPATCH_JS, {"sel": sel, "seq": seq})
        self.assertEqual("ok", result["result"])
        return result

    def dispatch_on_first_option(self, seq: list) -> None:
        self.assertEqual("ok", self.page.evaluate(DISPATCH_ON_FIRST_OPTION_JS, seq))

    def simulate_background_resume(self) -> float:
        """切后台再切回，返回切后台时刻（performance.now 时基）。"""
        self._hidden_at = self.page.evaluate(SIMULATE_RESUME_JS)
        return self._hidden_at

    def human_tap(self, sel: str, use_touch: bool = False, pre_hidden_ts=None) -> None:
        """以人手节奏点按（起手 → 等待 → 收尾 → click）。"""
        down, up = ("touchstart", "touchend") if use_touch else ("pointerdown", "pointerup")
        first = {"kind": down}
        second = {"kind": up}
        if pre_hidden_ts is not None:
            first["ts"] = pre_hidden_ts
            second["ts"] = pre_hidden_ts + HUMAN_TAP_GAP_MS
        self.dispatch(sel, [first])
        self.page.wait_for_timeout(HUMAN_TAP_GAP_MS)
        self.dispatch(sel, [second])
        self.page.wait_for_timeout(30)
        self.dispatch(sel, ["click"])

    # ---------- 幽灵输入：必须被丢弃 ----------

    def test_01_ghost_compat_click_after_resume_is_ignored(self):
        """恢复后补发的兼容鼠标序列（mousedown/mouseup/click，间隔≈0ms）不得跳过。"""
        self.simulate_background_resume()
        self.dispatch("#skipBtn", ["mousedown", "mouseup", "click"])
        st = self.state()
        self.assertFalse(st["hasAnswer"], "补发的旧 skip click 不应生效")
        self.assertNotIn("已跳过", st["feedback"])

    def test_02_ghost_skip_between_option_events_does_not_skip(self):
        """夹在选项事件之间补发的 skip click：选项正常作答，且绝不跳过。"""
        self.simulate_background_resume()
        self.dispatch_on_first_option(["touchstart"])
        self.dispatch("#skipBtn", ["mousedown", "mouseup", "click"])
        self.page.wait_for_timeout(HUMAN_TAP_GAP_MS)
        self.dispatch_on_first_option(["click"])
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
                stale.dispatchEvent(new MouseEvent('click', { cancelable: true, detail: 1 }));
                return 'ok';
            }"""
        )
        self.assertEqual("ok", result)
        st = self.state()
        self.assertFalse(st["hasAnswer"], "脱离文档树的旧 click 不应生效")
        self.assertNotIn("已跳过", st["feedback"])

    def test_04_compressed_pointer_replay_between_option_events_does_not_skip(self):
        """被压缩冲刷的完整指针重放（down→up≈0ms）夹在选项事件之间：不跳过。"""
        self.simulate_background_resume()
        self.dispatch_on_first_option(["touchstart"])
        self.dispatch("#skipBtn", ["pointerdown", "pointerup", "click"])
        self.page.wait_for_timeout(HUMAN_TAP_GAP_MS)
        self.dispatch_on_first_option(["click"])
        st = self.state()
        self.assertTrue(st["hasAnswer"], "选项点击应正常作答")
        self.assertNotEqual("skip", st["answer"], "压缩重放不得跳过本题")

    def test_05_pointer_replay_with_pre_background_timestamps_is_ignored(self):
        """保留切后台前时间戳的完整指针重放（节奏像人手）不得跳过。"""
        hidden_at = self.simulate_background_resume()
        pre_ts = max(5.0, hidden_at - 1000.0)
        self.human_tap("#skipBtn", pre_hidden_ts=pre_ts)
        st = self.state()
        self.assertFalse(st["hasAnswer"], "切后台前的旧触摸重放不应生效")
        self.assertNotIn("已跳过", st["feedback"])

    def test_06_touch_replay_with_pre_background_timestamps_is_ignored(self):
        """保留切后台前时间戳的完整触摸重放不得跳过。"""
        hidden_at = self.simulate_background_resume()
        pre_ts = max(5.0, hidden_at - 1000.0)
        self.dispatch("#skipBtn", [
            {"kind": "touchstart", "ts": pre_ts},
            {"kind": "touchend", "ts": pre_ts + 100},
            "click",
        ])
        st = self.state()
        self.assertFalse(st["hasAnswer"], "切后台前的旧触摸重放不应生效")
        self.assertNotIn("已跳过", st["feedback"])

    def test_07_pre_background_pointer_events_are_canceled(self):
        """切走前的旧按下/抬起应被整事件取消（消除按钮 ：active 闪烁与合成 click）。"""
        hidden_at = self.simulate_background_resume()
        pre_ts = max(5.0, hidden_at - 1000.0)
        res = self.dispatch("#skipBtn", [
            {"kind": "pointerdown", "ts": pre_ts},
            {"kind": "pointerup", "ts": pre_ts + 100},
            "click",
        ])
        self.assertTrue(res["prevented"][0], "旧触摸按下应被取消（防闪烁）")
        self.assertTrue(res["prevented"][1], "旧触摸抬起应被取消")
        self.assertFalse(self.state()["hasAnswer"], "被取消的重放不应产生跳过")

    def test_08_pre_background_touch_events_are_canceled(self):
        """切走前的旧 touchstart/touchend 应被整事件取消。"""
        hidden_at = self.simulate_background_resume()
        pre_ts = max(5.0, hidden_at - 1000.0)
        res = self.dispatch("#skipBtn", [
            {"kind": "touchstart", "ts": pre_ts},
            {"kind": "touchend", "ts": pre_ts + 100},
            "click",
        ])
        self.assertTrue(res["prevented"][0], "旧 touchstart 应被取消")
        self.assertTrue(res["prevented"][1], "旧 touchend 应被取消")
        self.assertFalse(self.state()["hasAnswer"])

    def test_09_ghost_click_on_next_button_is_blocked(self):
        """补发落在「下一题」按钮上：题目不得被切走。"""
        self.simulate_background_resume()
        pos_before = self.page.evaluate("quizState.pos")
        res = self.dispatch("#nextBtn", [
            {"kind": "pointerdown", "ts": max(5.0, self._hidden_at - 1000.0)},
            {"kind": "click", "detail": 1},
        ])
        self.assertTrue(res["prevented"][0], "旧触摸按下应被取消")
        self.assertEqual(pos_before, self.page.evaluate("quizState.pos"),
                         "补发 click 不得切到下一题")

    def test_10_same_burst_click_on_next_after_option_is_blocked(self):
        """点选项后同一批次到达的「下一题」click（没有自己的起手）必须被拦截。"""
        res = self.page.evaluate(
            """() => {
                const opt = document.querySelector('.quiz-card .opt-btn:not([disabled])');
                const nb = document.getElementById('nextBtn');
                const t0 = new Event('touchstart', { bubbles: true, cancelable: true });
                Object.defineProperty(t0, 'touches', { value: [{ clientX: 0, clientY: 0 }] });
                opt.dispatchEvent(t0);
                opt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                opt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
                const answered = Object.prototype.hasOwnProperty.call(quizState.answers, quizState.pos);
                const posAfterOption = quizState.pos;
                const ghost = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
                nb.dispatchEvent(ghost);
                return {
                    answered: answered,
                    posAfterOption: posAfterOption,
                    posAfterGhost: quizState.pos
                };
            }"""
        )
        self.assertTrue(res["answered"], "选项应正常作答")
        self.assertEqual(res["posAfterOption"], res["posAfterGhost"],
                         "同一批次补发的下一题 click 必须被拦截，不得切题")

        # 稍后真实地点「下一题」（起手+人手间隔+click）→ 正常切题
        self.human_tap("#nextBtn")
        self.assertEqual(res["posAfterGhost"] + 1, self.page.evaluate("quizState.pos"),
                         "真实的下一题点击应正常切题")

    # ---------- 真人操作：必须照常生效 ----------

    def test_11_real_skip_tap_after_resume_still_works(self):
        """恢复后真人点按跳过按钮应正常跳过。"""
        self.simulate_background_resume()
        self.human_tap("#skipBtn")
        st = self.state()
        self.assertEqual("skip", st["answer"], "真实跳过点击应生效")
        self.assertIn("已跳过", st["feedback"])

    def test_12_touch_skip_after_resume_still_works(self):
        """恢复后真实触摸跳过按钮应正常跳过。"""
        self.simulate_background_resume()
        self.human_tap("#skipBtn", use_touch=True)
        st = self.state()
        self.assertEqual("skip", st["answer"], "真实触摸跳过应生效")
        self.assertIn("已跳过", st["feedback"])

    def test_13_long_press_skip_still_works(self):
        """长按跳过按钮后松手应正常跳过。"""
        self.dispatch("#skipBtn", ["pointerdown"])
        self.page.wait_for_timeout(1800)
        self.dispatch("#skipBtn", ["pointerup"])
        self.page.wait_for_timeout(30)
        self.dispatch("#skipBtn", ["click"])
        st = self.state()
        self.assertEqual("skip", st["answer"], "长按后松手的跳过应生效")

    def test_14_keyboard_space_skip_works(self):
        """键盘空格跳过（真实键盘输入）不受闸门影响。"""
        self.page.evaluate(
            """() => document.body.dispatchEvent(new KeyboardEvent('keydown', {
                key: ' ', bubbles: true, cancelable: true
            }))"""
        )
        st = self.state()
        self.assertEqual("skip", st["answer"], "空格跳过应生效")

    def test_15_normal_option_answer_still_works_after_resume(self):
        """恢复后真人点选项照常作答，不会连带切题。"""
        self.simulate_background_resume()
        pos_before = self.page.evaluate("quizState.pos")
        self.dispatch_on_first_option(["touchstart"])
        self.page.wait_for_timeout(HUMAN_TAP_GAP_MS)
        self.dispatch_on_first_option(["click"])
        st = self.state()
        self.assertTrue(st["hasAnswer"], "点击选项应正常作答")
        self.assertNotEqual("skip", st["answer"])
        self.assertEqual(pos_before, self.page.evaluate("quizState.pos"),
                         "作答不应自动跳到下一题")

    def test_16_fresh_skip_tap_events_are_not_canceled(self):
        """真实起手绝不允许被取消：按下事件不被 preventDefault。"""
        res = self.dispatch("#skipBtn", [{"kind": "pointerdown"}])
        self.assertFalse(res["prevented"][0], "真实按下不应被取消")
        self.page.wait_for_timeout(HUMAN_TAP_GAP_MS)
        self.dispatch("#skipBtn", [{"kind": "pointerup"}])
        self.page.wait_for_timeout(30)
        self.dispatch("#skipBtn", ["click"])
        self.assertEqual("skip", self.state()["answer"], "真实跳过应正常生效")

    def test_17_keyboard_click_detail_zero_on_next_is_allowed(self):
        """键盘激活（detail=0）不受闸门过滤：Enter 触发的下一题 click 正常切题。"""
        self.simulate_background_resume()
        self.page.evaluate("handleAnswer(0)")
        pos_before = self.page.evaluate("quizState.pos")
        res = self.page.evaluate(
            """() => {
                const nb = document.getElementById('nextBtn');
                // 键盘激活的真实顺序：先有按键，再派发 detail=0 的 click
                nb.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', bubbles: true, cancelable: true
                }));
                const ev = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 });
                nb.dispatchEvent(ev);
                return { prevented: !!ev.defaultPrevented };
            }"""
        )
        self.assertFalse(res["prevented"], "键盘激活的 click 不应被过滤")
        self.assertEqual(pos_before + 1, self.page.evaluate("quizState.pos"),
                         "键盘触发的切题应正常执行")

    def test_18_loaded_page_without_background_is_unaffected(self):
        """从未切过后台时，闸门不干预任何操作。"""
        self.assertFalse(self.page.evaluate("() => _ghostEverHidden"))
        pos_before = self.page.evaluate("quizState.pos")
        self.page.evaluate(
            """() => {
                const nb = document.getElementById('nextBtn');
                nb.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            }"""
        )
        self.page.wait_for_timeout(HUMAN_TAP_GAP_MS)
        self.page.evaluate(
            """() => {
                const nb = document.getElementById('nextBtn');
                nb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
            }"""
        )
        self.assertEqual(pos_before + 1, self.page.evaluate("quizState.pos"),
                         "未切过后台时点击下一题应正常切题")


if __name__ == "__main__":
    unittest.main(verbosity=2)

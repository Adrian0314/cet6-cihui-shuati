"""Regression coverage for the 4-week/25-day Ebbinghaus plan (4周25天打卡表).

Run from this directory:
    python .\\test_ebbing_plan_completion_regression.py

Covers the day-9 completion bug fix:
  1. The built-in plan table matches the book rule (+1/+3/+6/+12, unit 14's
     final review folded into day 25).
  2. Answering the day's Units through ANY quiz path (review queue, plain
     practice) credits the plan — previously only the review queue did, so a
     fully practiced day stayed "incomplete" and asked for the same questions
     again.
  3. A rebuilt review queue no longer re-pushes words already answered today.
  4. Legacy broken states (completed but unrecorded day, stale snapshot) heal
     on load instead of demanding a full redo.
"""

from pathlib import Path
import unittest

from playwright.sync_api import Browser, Page, Playwright, sync_playwright


QUIZ_HTML = Path(__file__).with_name("cet6_quiz.html")

PLAN_DAY = 9                      # 学 Unit 9，复习 Unit 3、6、8
DAY9_UNITS = [9, 3, 6, 8]
LEARNED_OLD_UNITS = [1, 2, 3, 4, 5, 6, 7, 8]   # 第1-8天已按计划学过的 Unit

SEED_JS = """
(seed) => {
    const now = new Date();
    const todayFloor = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const keyFor = (offsetDays) => {
        const d = new Date(todayFloor - offsetDays * 86400000);
        const p = (n) => n < 10 ? '0' + n : '' + n;
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    };
    const mark = (unit, ts) => {
        ALL_WORDS.forEach((w) => {
            if (Number(w.unit) === Number(unit)) {
                state.stats.wordAttempts[wordStateKey(w.id, 'core')] =
                    { attempts: 2, correct: 1, wrong: 1, learnedAt: ts, lastTime: ts };
            }
        });
    };
    state.stats.wordAttempts = {};
    (seed.learnedOldUnits || []).forEach((u) => mark(u, todayFloor - 5 * 86400000));
    (seed.answeredTodayUnits || []).forEach((u) => mark(u, Date.now() - 60000));
    (seed.answeredYesterdayUnits || []).forEach((u) => mark(u, todayFloor - 86400000 + 3600000));
    state.ebbingActive = true;
    state.ebbingStart = keyFor(8);
    state.ebbingPlan = {
        day: seed.day,
        dayKey: keyFor(seed.dayKeyOffset || 0),
        completedUnits: (seed.completedUnits || []).slice()
    };
    state.prefs.pool = 'core';
    state.suspendedQuiz = null;
    if (seed.withSnapshot) {
        const ids = [];
        ebbingPlanUnits(seed.day).forEach((u) => ebbingUnitWords(u).forEach((w) => ids.push(w.id)));
        state.suspendedQuiz = {
            mode: 'en2cn', isRetry: false, isSmart: false, isReview: true, isMemory: false,
            ids: ids, pos: 0, answers: {}, done: 0,
            reviewCorrect: 0, questionSnapshots: [], memoryResults: [],
            isEbbingPlan: true, ebbingPlanDayKey: keyFor(seed.dayKeyOffset || 0),
            ebbingPlanUnits: ebbingPlanUnits(seed.day), ebbingPlanRemaining: {}, ebbingPlanAnswered: {},
            poolType: 'core', currentId: null, memWrong: 0, memTotal: ids.length, pageStart: 0
        };
    }
    saveState();
    return {
        day: state.ebbingPlan.day,
        dayKey: state.ebbingPlan.dayKey,
        todayKey: keyFor(0)
    };
}
"""

SWITCH_TO_CORE_JS = """
() => {
    currentPool = 'core';
    state.prefs.pool = 'core';
    updatePoolUI();
    renderAll();
}
"""


class EbbingPlanCompletionRegressionTest(unittest.TestCase):
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

    def tearDown(self) -> None:
        self.context.close()

    # ---------- helpers ----------

    def seed(self, **seed) -> dict:
        return self.page.evaluate(SEED_JS, seed)

    def switch_to_core(self) -> None:
        self.page.evaluate(SWITCH_TO_CORE_JS)

    def plan_state(self) -> dict:
        return self.page.evaluate(
            """() => {
                // 与应用渲染计划栏时一致：先做跨天结算与作答补记，再读取状态
                if (state.ebbingActive) syncEbbingPlan();
                return {
                    day: state.ebbingPlan ? state.ebbingPlan.day : null,
                    dayKey: state.ebbingPlan ? state.ebbingPlan.dayKey : null,
                    completedUnits: state.ebbingPlan ? state.ebbingPlan.completedUnits.slice() : null,
                    complete: state.ebbingPlan ? isEbbingPlanComplete(state.ebbingPlan) : false,
                    due: dueUnitsByEbbing(),
                    dueIds: dueUnitWordIds(),
                    planBar: document.getElementById('ebbingPlan').textContent,
                    planBarVisible: document.getElementById('ebbingPlan').style.display !== 'none',
                    reviewBarShown: document.getElementById('reviewBar').classList.contains('show'),
                    reviewInfo: document.getElementById('reviewInfo').textContent,
                    savedBarShown: document.getElementById('savedBar').classList.contains('show'),
                    snapshotIds: state.suspendedQuiz && state.suspendedQuiz.ids ? state.suspendedQuiz.ids.length : 0
                };
            }"""
        )

    def answer_current_queue(self, max_answers: int = 4000) -> dict:
        """Drive the real answer handlers until the queue finishes or empties."""
        return self.page.evaluate(
            """(maxAnswers) => {
                let answered = 0;
                while (quizActive && quizState && quizState.current && answered < maxAnswers) {
                    if (isAnswered(quizState.pos)) {
                        // 恢复/跳转后可能停在一道已答的题上，先推进
                        advanceQuestion();
                        continue;
                    }
                    handleAnswer(quizState.current.correctIndex);
                    answered++;
                    advanceQuestion();
                }
                return { active: quizActive, answered: answered, pos: quizState ? quizState.pos : -1 };
            }""",
            max_answers,
        )

    # ---------- tests ----------

    def test_01_plan_table_matches_book_rule(self) -> None:
        """每个 Unit 的复习日必须落在 U+1 / U+3 / U+6 / U+12；第25天为收尾日。"""
        result = self.page.evaluate(
            """() => {
                const problems = [];
                const reviewsOf = {};
                EBBING_25_DAY_PLAN.forEach((units, idx) => {
                    const day = idx + 1;
                    const newUnit = day <= EBING_UNITS ? day : null;
                    units.forEach((u) => {
                        if (u === newUnit) return;
                        (reviewsOf[u] = reviewsOf[u] || []).push(day);
                    });
                    if (day > EBING_UNITS && units.length === 0) problems.push('day ' + day + ' empty');
                });
                for (let u = 1; u <= EBING_UNITS; u++) {
                    const expected = [u + 1, u + 3, u + 6, u + 12];
                    const actual = (reviewsOf[u] || []).slice().sort((a, b) => a - b);
                    if (u === EBING_UNITS) {
                        // Unit 14 的 +12 落在第26天，超出25天表，并入第25天
                        expected[3] = 25;
                    }
                    if (actual.length !== expected.length || actual.some((d, i) => d !== expected[i])) {
                        problems.push('Unit ' + u + ' reviews ' + JSON.stringify(actual) + ' expected ' + JSON.stringify(expected));
                    }
                }
                return { problems: problems, days: EBBING_25_DAY_PLAN.length };
            }"""
        )
        self.assertEqual(25, result["days"])
        self.assertEqual([], result["problems"])

    def test_02_review_queue_full_completion_marks_day_complete(self) -> None:
        """走「开始复习」整队列做完 → 当天目标已完成，不再要求重做。"""
        self.seed(day=PLAN_DAY, learnedOldUnits=LEARNED_OLD_UNITS)
        self.switch_to_core()

        st = self.plan_state()
        self.assertEqual([9, 3, 6, 8], st["due"])
        self.assertTrue(st["reviewBarShown"], "复习提醒横幅应显示")
        self.assertIn("Unit 9、3、6、8", st["reviewInfo"])

        self.page.evaluate("startReview()")
        queue_len = self.page.evaluate("quizState.ids.length")
        self.assertEqual(767, queue_len)  # 175 + 164 + 214 + 214

        self.answer_current_queue()

        st = self.plan_state()
        self.assertEqual(sorted([9, 3, 6, 8]), sorted(st["completedUnits"]))
        self.assertTrue(st["complete"], "当天计划应判定为完成")
        self.assertEqual([], st["due"])
        self.assertEqual([], st["dueIds"])
        self.assertFalse(st["reviewBarShown"], "完成后不应再显示复习横幅")
        self.assertIn("当天目标已完成", st["planBar"])

    def test_03_plain_practice_credits_plan_units(self) -> None:
        """核心bug：只通过普通做题路径答完当天全部 Unit 也必须计入打卡。"""
        self.seed(day=PLAN_DAY, learnedOldUnits=LEARNED_OLD_UNITS)
        self.switch_to_core()

        # 逐个 Unit 以普通练习方式答完（recordStat 是所有答题路径的统一入口）
        for unit in DAY9_UNITS:
            self.page.evaluate(
                """(unit) => {
                    ebbingUnitWords(unit).forEach((w) => {
                        recordStat(w, 'en2cn', true, false, false);
                    });
                    syncEbbingPlan();
                    renderAll();
                }""",
                unit,
            )
            st = self.plan_state()
            self.assertIn(unit, st["completedUnits"], f"Unit {unit} 答完后应计入打卡")

        st = self.plan_state()
        self.assertTrue(st["complete"], "全部 Unit 通过普通路径答完后，当天计划应完成")
        self.assertIn("当天目标已完成", st["planBar"])
        self.assertEqual([], st["due"])
        self.assertFalse(st["reviewBarShown"], "不应再要求重做当天已练的题")

    def test_04_rebuilt_review_queue_skips_words_answered_today(self) -> None:
        """中断后重建复习队列：当天已答过的词不再整段重推。"""
        self.seed(day=PLAN_DAY, learnedOldUnits=LEARNED_OLD_UNITS)
        self.switch_to_core()

        self.page.evaluate("startReview()")
        # 只答完队列前半（Unit 9 + Unit 3 = 175 + 164 题）
        self.answer_current_queue(max_answers=339)
        progress = self.page.evaluate(
            """() => ({
                completed: state.ebbingPlan.completedUnits.slice(),
                answeredCurrent: isAnswered(quizState.pos)
            })"""
        )
        self.assertEqual(sorted([9, 3]), sorted(progress["completed"]))

        # 模拟用户放弃当前队列后再次点「开始复习」（旧版会把 9/3 的题整段重推）
        self.page.evaluate("discardSaved(); startReview();")
        rebuilt = self.page.evaluate(
            """() => ({
                len: quizState.ids.length,
                units: Array.from(new Set(quizState.ids.map((id) => getWord(id, 'core').unit)))
            })"""
        )
        self.assertEqual([6, 8], sorted(rebuilt["units"]), "重建队列只应包含今天还没答过的 Unit")
        self.assertEqual(428, rebuilt["len"])  # 214 + 214

        self.answer_current_queue()
        st = self.plan_state()
        self.assertTrue(st["complete"])
        self.assertIn("当天目标已完成", st["planBar"])

    def test_05_resume_after_reload_finishes_day(self) -> None:
        """做题中途刷新页面 → 「继续做题」恢复同一队列 → 做完计为完成。"""
        self.seed(day=PLAN_DAY, learnedOldUnits=LEARNED_OLD_UNITS)
        self.switch_to_core()
        self.page.evaluate("startReview()")
        self.answer_current_queue(max_answers=339)
        self.page.reload(wait_until="load")

        st = self.plan_state()
        self.assertTrue(st["savedBarShown"], "刷新后应提示可继续做题")
        self.page.evaluate("resumeQuiz()")
        self.answer_current_queue()

        st = self.plan_state()
        self.assertTrue(st["complete"], "恢复后做完剩余题目，当天计划应完成")
        self.assertEqual([], st["due"])

    def test_06_legacy_stuck_state_heals_on_load(self) -> None:
        """旧版遗留的卡死状态：当天任务实际已全部答完但打卡未记上 →
        打开页面即自动补记为完成，不再要求重做三百多道题。"""
        self.seed(
            day=PLAN_DAY,
            learnedOldUnits=LEARNED_OLD_UNITS,
            answeredTodayUnits=DAY9_UNITS,
            completedUnits=[],
            withSnapshot=True,
        )
        self.page.reload(wait_until="load")

        st = self.plan_state()
        self.assertTrue(st["complete"], "当天任务实际已答完，应补记为完成")
        self.assertEqual(sorted([9, 3, 6, 8]), sorted(st["completedUnits"]))
        self.assertEqual([], st["due"])
        self.assertEqual(0, st["snapshotIds"], "已完成任务的旧快照应自动清除")
        self.assertFalse(st["savedBarShown"], "不应再提示继续做题")
        self.assertFalse(st["reviewBarShown"], "不应再提示开始复习")
        self.assertIn("当天目标已完成", st["planBar"])

    def test_07_rollover_advances_when_previous_day_was_done(self) -> None:
        """跨天结算：前一天任务实际全部答完（即使旧版没记上）→ 正常进入第10天。"""
        self.seed(
            day=PLAN_DAY,
            dayKeyOffset=1,
            learnedOldUnits=LEARNED_OLD_UNITS,
            answeredYesterdayUnits=DAY9_UNITS,
            completedUnits=[],
        )
        self.page.reload(wait_until="load")

        st = self.plan_state()
        self.assertEqual(10, st["day"], "前一天已完成，应推进到第10天")
        self.assertEqual([], st["completedUnits"])
        # 第10天计划：学 Unit 10，复习 Unit 4、7、9（第9天学的 Unit 9 也要按表复习）
        self.assertEqual([10, 4, 7, 9], st["due"])
        self.assertIn("第 10 天", st["planBar"])

    def test_08_rollover_restarts_missed_day(self) -> None:
        """跨天结算：前一天确实没做完 → 留在第9天补做未完成的复习。"""
        self.seed(
            day=PLAN_DAY,
            dayKeyOffset=1,
            learnedOldUnits=LEARNED_OLD_UNITS,
            answeredYesterdayUnits=[9, 3, 6],   # Unit 8 的复习没做
            completedUnits=[],
        )
        self.page.reload(wait_until="load")

        st = self.plan_state()
        self.assertEqual(9, st["day"], "前一天未完成，应停留在第9天")
        self.assertEqual([9], st["completedUnits"], "新 Unit 已学过，补记完成")
        self.assertEqual([3, 6, 8], st["due"], "9 已学过不再重推；3、6、8 需要今天补复习")
        self.assertNotIn("当天目标已完成", st["planBar"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

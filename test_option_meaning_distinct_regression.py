"""Regression coverage for near-duplicate Chinese meanings among choice options.

英文→中文选择题的干扰项不得与正确答案或其他选项的中文释义过于接近：
同根词（possible/possibly、inventor/invention、wooden/wood 等）曾经同时
出现在同一道题的选项里，用户无法凭释义作答。本测试直接复用页面的释义
判定与出题逻辑：
1. meaningsTooClose 对同根词对必须双向命中，结果与参数顺序无关（旧版
   分段判定是方向相关的，先传短释义才命中，导致同根干扰项漏进同一题）；
2. 释义可明确区分的词对不得被误判为“过近”；
3. 全量扫描曾经出现违规的单词，在其所属单元池内反复出题，选项之间
   不得再出现相同或过近的中文释义。
"""

import unittest
from pathlib import Path

from playwright.sync_api import Browser, Playwright, sync_playwright


QUIZ_HTML = Path(__file__).with_name("cet6_quiz.html")

# 修复前全量扫描出现“选项中文基本一样”的单词（91 处违规的来源）。
PREVIOUSLY_CONFLICTING_WORDS = [
    "Sunday", "accountancy", "affirmative", "burst", "competitive",
    "constituency", "cooperative", "digestive", "donor", "hindrance",
    "imaginative", "institutional", "inventor", "investor", "lecture",
    "mathematical", "mortgage", "multiply", "nutrient", "oceanic",
    "option", "patch", "patron", "possible", "practice", "prayer",
    "secondary", "secretary", "selective", "translator", "venture",
    "woollen",
]

# 修复前同题出现过的同根词对：现在必须双向判定为“过近”。
SAME_ROOT_PAIRS = [
    ("possible", "possibly"),
    ("inventor", "invention"),
    ("wooden", "wood"),
    ("oceanic", "ocean"),
    ("investor", "investment"),
    ("lecture", "lecturer"),
    ("patron", "patronage"),
    ("donor", "donation"),
    ("competitive", "competition"),
    ("affirmative", "affirm"),
]

# 释义可明确区分的词对：不得被误判为“过近”而失去干扰价值。
DISTINCT_PAIRS = [
    ("possible", "possess"),
    ("possible", "postpone"),
    ("possible", "aggressive"),
]


class OptionMeaningDistinctRegressionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.playwright: Playwright = sync_playwright().start()
        cls.browser: Browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.browser.close()
        cls.playwright.stop()

    def _open_quiz_page(self):
        context = self.browser.new_context()
        page = context.new_page()
        page.goto(QUIZ_HTML.as_uri(), wait_until="load")
        page.wait_for_function("() => Array.isArray(window.ALL_WORDS) && ALL_WORDS.length > 0")
        page.wait_for_function("() => Array.isArray(window.FULL_WORDS) && FULL_WORDS.length > 0")
        page.wait_for_function("() => typeof meaningsTooClose === 'function' && typeof generateOneQuestion === 'function'")
        return context, page

    def test_same_root_meanings_are_too_close_in_both_argument_orders(self) -> None:
        context, page = self._open_quiz_page()
        try:
            result = page.evaluate(
                """(args) => {
                    const findWord = (name) =>
                        ALL_WORDS.find((w) => w && w.word === name) ||
                        (FULL_WORDS || []).find((w) => w && w.word === name);
                    const check = ([a, b]) => {
                        const wa = findWord(a);
                        const wb = findWord(b);
                        if (!wa || !wb) return { pair: [a, b], missing: true };
                        return {
                            pair: [a, b],
                            forward: meaningsTooClose(wa, wb),
                            backward: meaningsTooClose(wb, wa)
                        };
                    };
                    return {
                        sameRoot: args.sameRoot.map(check),
                        distinct: args.distinct.map(check)
                    };
                }""",
                {"sameRoot": SAME_ROOT_PAIRS, "distinct": DISTINCT_PAIRS},
            )
        finally:
            context.close()

        for entry in result["sameRoot"]:
            self.assertNotIn("missing", entry, f"词库缺少词条：{entry}")
            self.assertTrue(
                entry["forward"] and entry["backward"],
                f"同根词对 {entry['pair']} 应双向判定为过近：{entry}",
            )
        for entry in result["distinct"]:
            self.assertNotIn("missing", entry, f"词库缺少词条：{entry}")
            self.assertFalse(
                entry["forward"] or entry["backward"],
                f"可区分词对 {entry['pair']} 不应判定为过近：{entry}",
            )

    def test_meanings_too_close_is_symmetric_on_sampled_word_pairs(self) -> None:
        context, page = self._open_quiz_page()
        try:
            asymmetric = page.evaluate(
                """() => {
                    const words = ALL_WORDS.concat(FULL_WORDS || []);
                    const total = words.length;
                    const bad = [];
                    for (let n = 0; n < 400; n++) {
                        const i = (n * 9973 + 13) % total;
                        const j = (n * 7919 + 5) % total;
                        if (i === j) continue;
                        const a = words[i];
                        const b = words[j];
                        const forward = meaningsTooClose(a, b);
                        const backward = meaningsTooClose(b, a);
                        if (forward !== backward) {
                            bad.push({ pair: [a.word, b.word], forward, backward });
                        }
                    }
                    return bad;
                }"""
            )
        finally:
            context.close()

        self.assertEqual([], asymmetric, f"释义过近判定与参数顺序相关：{asymmetric[:5]}")

    def test_previously_conflicting_words_generate_distinct_options(self) -> None:
        context, page = self._open_quiz_page()
        failures = []
        try:
            for word_name in PREVIOUSLY_CONFLICTING_WORDS:
                result = page.evaluate(
                    """(args) => {
                        const findIn = (bank) => bank.find((w) => w && w.word === args.word);
                        let word = findIn(ALL_WORDS);
                        let poolName = word ? 'core' : null;
                        if (!word) {
                            word = (FULL_WORDS || []).find((w) => w && w.word === args.word);
                            poolName = word ? 'full' : null;
                        }
                        if (!word) return { missing: true };
                        currentPool = poolName;
                        // 复现原始违规条件：限制在该词所属单元的词池内选干扰项
                        selectedUnits = word.unit ? [word.unit] : [];
                        quizState.mode = 'en2cn';
                        for (let round = 0; round < args.rounds; round++) {
                            const question = generateOneQuestion(word);
                            if (!question || question.options.length !== 4) {
                                return { badCount: true, round };
                            }
                            const options = question.options;
                            const texts = options.map((o) => getChineseOptionText(o.meaning) || o.word);
                            for (let i = 0; i < options.length; i++) {
                                for (let j = i + 1; j < options.length; j++) {
                                    if (texts[i] === texts[j] || meaningsTooClose(options[i], options[j])) {
                                        return { violation: [texts[i], texts[j]], round };
                                    }
                                }
                            }
                        }
                        return { ok: true };
                    }""",
                    {"word": word_name, "rounds": 3},
                )
                if result.get("missing"):
                    failures.append(f"{word_name}: 词库缺少词条")
                elif result.get("badCount"):
                    failures.append(f"{word_name}: 选项数量不是 4（round {result['round']}）")
                elif result.get("violation"):
                    failures.append(
                        f"{word_name}: 选项释义过近 {result['violation']}（round {result['round']}）"
                    )
        finally:
            context.close()

        self.assertEqual([], failures, "仍有单词出题时出现相同/过近的中文选项")


if __name__ == "__main__":
    unittest.main()

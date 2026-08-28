"""Regression coverage for malformed Chinese choice definitions."""

import re
import unittest
from pathlib import Path

from playwright.sync_api import Browser, Playwright, sync_playwright


QUIZ_HTML = Path(__file__).with_name("cet6_quiz.html")
ORPHAN_POS_PATTERN = re.compile(
    r"\s+(?:n|v|adj|adv|prep|pron|conj|num|art|aux|vi|vt)\.$",
    re.IGNORECASE,
)


class ChoiceDefinitionRegressionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.playwright: Playwright = sync_playwright().start()
        cls.browser: Browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.browser.close()
        cls.playwright.stop()

    def test_condition_choice_text_has_no_orphan_part_of_speech_suffix(self) -> None:
        context = self.browser.new_context()
        page = context.new_page()
        page.goto(QUIZ_HTML.as_uri(), wait_until="load")

        option_text = page.evaluate(
            """() => {
                const condition = ALL_WORDS.find((word) => word.word === 'condition');
                const distractors = ALL_WORDS.filter((word) => word.word !== 'condition').slice(0, 3);
                currentPool = 'core';
                currentMode = 'en2cn';
                currentQuizType = 'choice';
                quizActive = true;
                const question = {
                    word: condition,
                    options: [condition, ...distractors],
                    correctIndex: 0
                };
                quizState = {
                    mode: 'en2cn',
                    isRetry: false,
                    isSmart: false,
                    isMemory: false,
                    isReview: false,
                    ids: [condition.id],
                    pos: 0,
                    questions: [question],
                    answers: {},
                    done: 0,
                    current: question
                };
                renderQuizCard();
                return document.querySelector('.opt-btn').textContent;
            }"""
        )

        self.assertFalse(
            ORPHAN_POS_PATTERN.search(option_text),
            "condition must not render an orphan part-of-speech marker in choices",
        )
        context.close()

    def test_tempo_choice_text_includes_its_chinese_definition(self) -> None:
        context = self.browser.new_context()
        page = context.new_page()
        page.goto(QUIZ_HTML.as_uri(), wait_until="load")

        option_text = page.evaluate(
            """() => {
                const tempo = ALL_WORDS.find((word) => word.word === 'tempo');
                const distractors = ALL_WORDS.filter((word) => word.word !== 'tempo').slice(0, 3);
                currentPool = 'core';
                currentMode = 'en2cn';
                currentQuizType = 'choice';
                quizActive = true;
                const question = {
                    word: tempo,
                    options: [tempo, ...distractors],
                    correctIndex: 0
                };
                quizState = {
                    mode: 'en2cn',
                    isRetry: false,
                    isSmart: false,
                    isMemory: false,
                    isReview: false,
                    ids: [tempo.id],
                    pos: 0,
                    questions: [question],
                    answers: {},
                    done: 0,
                    current: question
                };
                renderQuizCard();
                return document.querySelector('#opt-0').textContent;
            }"""
        )

        self.assertIn("速度", option_text, "tempo must render a Chinese definition in choices")
        context.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)

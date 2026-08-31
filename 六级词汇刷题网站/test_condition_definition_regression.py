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

    def test_animal_choice_text_includes_its_chinese_definition(self) -> None:
        context = self.browser.new_context()
        page = context.new_page()
        page.goto(QUIZ_HTML.as_uri(), wait_until="load")

        option_text = page.evaluate(
            """() => {
                const animal = ALL_WORDS.find((word) => word.word === 'animal');
                const distractors = ALL_WORDS.filter((word) => word.word !== 'animal').slice(0, 3);
                currentPool = 'core';
                currentMode = 'en2cn';
                currentQuizType = 'choice';
                quizActive = true;
                const question = {
                    word: animal,
                    options: [animal, ...distractors],
                    correctIndex: 0
                };
                quizState = {
                    mode: 'en2cn',
                    isRetry: false,
                    isSmart: false,
                    isMemory: false,
                    isReview: false,
                    ids: [animal.id],
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

        self.assertIn("动物", option_text, "animal must render a Chinese definition in choices")
        context.close()

    def test_reported_vocab_entries_are_repaired_in_embedded_data(self) -> None:
        """The four screenshot-reported entries must be correct at source/runtime."""
        context = self.browser.new_context()
        page = context.new_page()
        page.goto(QUIZ_HTML.as_uri(), wait_until="load")
        entries = page.evaluate(
            """() => ['animal', 'their', 'hear', 'manoeuvre'].map((word) => {
                const entry = ALL_WORDS.find((item) => item.word === word);
                return { word, meaning: entry && entry.meaning, pronunciation: entry && entry.pronunciation };
            })"""
        )
        expected = {
            'animal': ('动物', None),
            'their': ('det.他/她/它们', None),
            'hear': ('v.听见', None),
            'manoeuvre': ('n.机动动作;策略,手段 v.操纵,控制', '/məˈnuːvə(r)/'),
        }
        for entry in entries:
            meaning, pronunciation = expected[entry['word']]
            self.assertIn(meaning, entry['meaning'])
            if pronunciation:
                self.assertEqual(entry['pronunciation'], pronunciation)
        context.close()

    def test_chinese_slash_alternatives_are_preserved(self) -> None:
        context = self.browser.new_context()
        page = context.new_page()
        page.goto(QUIZ_HTML.as_uri(), wait_until="load")
        option_text = page.evaluate(
            """() => {
                const their = ALL_WORDS.find((word) => word.word === 'their');
                const distractors = ALL_WORDS.filter((word) => word.word !== 'their').slice(0, 3);
                currentPool = 'core';
                currentMode = 'en2cn';
                currentQuizType = 'choice';
                quizActive = true;
                const question = { word: their, options: [their, ...distractors], correctIndex: 0 };
                quizState = {
                    mode: 'en2cn', isRetry: false, isSmart: false, isMemory: false,
                    isReview: false, ids: [their.id], pos: 0, questions: [question],
                    answers: {}, done: 0, current: question
                };
                renderQuizCard();
                return document.querySelector('#opt-0').textContent;
            }"""
        )
        self.assertIn('他/她/它们', option_text)
        context.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)

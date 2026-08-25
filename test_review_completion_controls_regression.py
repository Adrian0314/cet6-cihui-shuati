"""Regression coverage for controls on the review-completion screen.

Run from this directory:
    python .\\test_review_completion_controls_regression.py
"""

from pathlib import Path
import unittest

from playwright.sync_api import Browser, Page, Playwright, sync_playwright


QUIZ_HTML = Path(__file__).with_name("cet6_quiz.html")


class ReviewCompletionControlsRegressionTest(unittest.TestCase):
    playwright: Playwright
    browser: Browser
    page: Page

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
        self.page.evaluate(
            """() => {
                currentPool = 'full';
                quizActive = true;
                quizState = {
                    mode: 'en2cn',
                    isReview: true,
                    isMemory: false,
                    isRetry: false,
                    isSmart: false,
                    ids: [1],
                    pos: 0,
                    questions: [],
                    answers: {},
                    done: 1,
                    reviewCorrect: 1,
                    current: null,
                    poolType: 'full'
                };
                const card = document.getElementById('quizCard');
                card.classList.add('fullscreen');
                document.body.style.overflow = 'hidden';
                finishQuiz();
            }"""
        )

    def tearDown(self) -> None:
        self.context.close()

    def test_review_completion_keeps_exit_and_return_controls(self) -> None:
        card = self.page.locator("#quizCard")

        self.assertTrue(
            card.locator("#toggleFsBtn").is_visible(),
            "Review completion should retain an exit-fullscreen control",
        )
        self.assertTrue(
            card.locator("#returnToStartBtn").is_visible(),
            "Review completion should provide a return-to-start control",
        )

        card.locator("#toggleFsBtn").click()
        self.assertFalse(
            card.evaluate("element => element.classList.contains('fullscreen')"),
            "The completion screen should exit fullscreen when requested",
        )

        card.locator("#returnToStartBtn").click()
        self.assertTrue(
            self.page.locator("#startBtn").is_visible(),
            "Returning from completion should reveal the main quiz start control",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)

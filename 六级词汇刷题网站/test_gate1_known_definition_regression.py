"""Focused Playwright regression test for Gate 1's “✅ 认识” response.

Run from this directory:
    python .\\test_gate1_known_definition_regression.py

This test intentionally exercises the static cet6_quiz.html file directly and does
not require a web server or modify quiz state outside its isolated browser context.
"""

from pathlib import Path
import unittest

from playwright.sync_api import Browser, Page, Playwright, sync_playwright


QUIZ_HTML = Path(__file__).with_name("cet6_quiz.html")


class Gate1KnownDefinitionRegressionTest(unittest.TestCase):
    """Protect the intended non-advancing Gate 1 'known word' response."""

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
        # Suppress only the first-run tutorial, which otherwise intercepts the
        # real Gate 1 click under test. The quiz itself remains unmodified.
        self.page.add_init_script(
            "localStorage.setItem('cet6_onboarded', '1');"
        )
        self.page.goto(QUIZ_HTML.as_uri(), wait_until="load")

        # Explicitly configure the exact interaction under regression, rather
        # than relying on persisted/default UI settings.
        self.page.locator("#modeSelect").select_option("en2cn")
        self.page.locator("#typeSelect").select_option("choice")
        self.page.locator("#gateSelect").select_option("1")
        self.page.locator("#startBtn").click()
        self.page.locator("#gateKnowBtn").wait_for(state="visible")

    def tearDown(self) -> None:
        self.context.close()

    def test_recognize_keeps_word_and_shows_definition_without_expanding_details(self) -> None:
        card = self.page.locator("#quizCard")
        word_before = card.locator(".q-word").inner_text().strip()
        definition = self.page.evaluate(
            "getChineseFull(quizState.current.word.meaning)"
        ).strip()

        self.assertTrue(word_before, "Gate 1 should render a current English word")
        self.assertTrue(definition, "The current Gate 1 word should have a Chinese definition")

        self.page.get_by_role("button", name="✅ 认识", exact=True).click()
        # handleGate1 updates the card synchronously; this gives browser layout a
        # stable point before each assertion without waiting for animation timing.
        self.page.wait_for_timeout(50)

        word_after = card.locator(".q-word").inner_text().strip()
        card_text = card.inner_text()

        # Keep separate subtests so a red run documents every violated Gate 1
        # contract instead of stopping at the first symptom.
        with self.subTest("current word remains visible after recognizing it"):
            self.assertEqual(
                word_after,
                word_before,
                f"Expected to stay on {word_before!r}, but moved to {word_after!r}",
            )

        with self.subTest("Chinese definition is revealed"):
            self.assertIn(
                definition,
                card_text,
                f"Expected the definition {definition!r} after recognizing {word_before!r}",
            )

        with self.subTest("continue control is shown"):
            next_button = card.locator("#nextBtn")
            self.assertTrue(next_button.is_visible(), "Expected #nextBtn to be visible")
            self.assertEqual(next_button.inner_text().strip(), "继续 →")

        with self.subTest("group map and expanded word detail stay absent"):
            self.assertEqual(
                card.locator(".gmap-wrap").count(),
                0,
                "A Gate 1 known-word response must not show a group map",
            )
            self.assertEqual(
                card.locator(".word-detail.open").count(),
                0,
                "A Gate 1 known-word response must not show expanded word details",
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)

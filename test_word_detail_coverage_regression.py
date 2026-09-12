"""单词浏览器「单词详解」覆盖与格式回归测试。

Run from this directory:
    python -X utf8 test_word_detail_coverage_regression.py

锁定三件事：
  1. full-words.js（单词浏览器数据源）可正常解析，词条数不变；
  2. 全部词条（含派生词）都配齐了 巧记(memo) + 例句(example)，不允许任何缺口；
  3. 详解字段符合规范（巧记有类别标记，例句为「英文 + 句末标点 + 空格 + 中文」），
     并且单词浏览器的「查询」按钮真的能把详解渲染出来。
"""
import json
import re
import unittest
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import Browser, Playwright, sync_playwright

ROOT = Path(__file__).parent
QUIZ_HTML = ROOT / "cet6_quiz.html"
FULL_JS = ROOT / "full-words.js"

EXPECTED_FULL_WORDS = 3324
# 2026-09-12 起全部词条（含书中 * 标注的派生词）均已配齐巧记与例句
EXPECTED_WITH_DETAIL = 3324
MEMO_TAGS = ("构词", "联想", "谐音", "对照", "提示", "拟声", "拆解")
# 旧词条沿用的无类别标记写法（如「success（成功）+ -ive → …」）行数，只封顶不回改
LEGACY_UNTAGGED_MEMOS = 271


def load_all_words() -> list:
    html = QUIZ_HTML.read_text(encoding="utf-8", errors="replace")
    m = re.search(r'<script type="application/json" id="data-all-words">(.*?)</script>', html, re.S)
    return json.loads(m.group(1))


def load_full_words() -> list:
    raw = FULL_JS.read_text(encoding="utf-8", errors="replace")
    m = re.search(r'window\.__FULL_WORDS_DATA__\s*=\s*(\[.*\]);?\s*$', raw, re.S)
    return json.loads(m.group(1))


def derived_words(all_words: list) -> set:
    """出现在任何词条 derivative 字段里的英文单词 = 书中派生词。"""
    out = set()
    for w in all_words:
        d = w.get("derivative")
        if isinstance(d, str) and d.strip():
            for x in re.findall(r"[A-Za-z][A-Za-z'\-]{1,}", d):
                out.add(x.lower())
    return out


def has(v) -> bool:
    return isinstance(v, str) and v.strip() != ""


class WordDetailCoverageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.all_words = load_all_words()
        cls.full_words = load_full_words()
        cls.derived = derived_words(cls.all_words)
        cls.playwright: Playwright = sync_playwright().start()
        cls.browser: Browser = cls.playwright.chromium.launch(headless=True)
        cls.context = cls.browser.new_context()
        cls.page = cls.context.new_page()
        cls.page.add_init_script("localStorage.setItem('cet6_onboarded', '1');")
        cls.page.goto(QUIZ_HTML.as_uri(), wait_until="load")
        cls.page.wait_for_timeout(1200)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.context.close()
        cls.browser.close()
        cls.playwright.stop()

    def test_01_dict_parses_and_keeps_size(self) -> None:
        self.assertEqual(EXPECTED_FULL_WORDS, len(self.full_words))
        self.assertTrue(all("word" in w and "meaning" in w for w in self.full_words))

    def test_02_every_word_has_full_detail(self) -> None:
        """全部词条（含派生词）必须巧记 + 例句齐全，不允许任何缺口。"""
        missing = []
        for w in self.full_words:
            if not (has(w.get("memo")) and has(w.get("example"))):
                missing.append((w["unit"], w["lesson"], w["word"]))
        self.assertEqual([], missing, "以下词仍缺详解：%s" % missing[:20])

        with_detail = sum(1 for w in self.full_words if has(w.get("memo")) and has(w.get("example")))
        self.assertEqual(EXPECTED_WITH_DETAIL, with_detail)

    def test_03_no_remaining_detail_gaps(self) -> None:
        """不允许存在无详解的缺口（派生词也已全部单独撰写）。"""
        gaps = [w["word"] for w in self.full_words if not has(w.get("memo")) and not has(w.get("example"))]
        self.assertEqual([], gaps, "以下词条没有详解：%s" % gaps[:20])

    def test_04_memo_follows_the_field_spec(self) -> None:
        """巧记最多两行、每行不超过 130 字；带类别标记的行必须用规范标记。

        旧词条里有 271 行沿用了「success（成功）+ -ive → …」「记 (对照) …」这类没有类别
        标记的老写法，不回改，只做数量封顶：新增内容必须带标记，否则这个数字会变大。
        """
        legacy_untagged = 0
        over_long = []
        too_many_lines = []
        for w in self.full_words:
            memo = w.get("memo")
            if not has(memo):
                continue
            lines = [ln for ln in memo.split("\n") if ln.strip()]
            if len(lines) > 2:
                too_many_lines.append(w["word"])
            for ln in lines:
                if len(ln) > 130:
                    over_long.append(w["word"])
                if not ln.strip().lstrip("[【(").strip().startswith(MEMO_TAGS):
                    legacy_untagged += 1
        self.assertEqual([], too_many_lines[:20], "巧记超过两行")
        self.assertEqual([], over_long[:20], "巧记单行超过 130 字")
        self.assertEqual(LEGACY_UNTAGGED_MEMOS, legacy_untagged,
                         "没有类别标记的巧记行数发生了变化：新增内容必须带「构词/联想/谐音/对照」标记")

    def test_05_example_follows_the_field_spec(self) -> None:
        """例句必须是「英文 + 空格 + 中文译文」，不重复句号、英文不被中文句号截断。"""
        bad = []
        for w in self.full_words:
            ex = w.get("example")
            if not has(ex):
                continue
            word = w["word"]
            if not re.search(r"[\u4e00-\u9fff]", ex):
                bad.append((word, "缺中文译文"))
            if re.search(r"[.!?]。", ex):
                bad.append((word, "重复句号"))
            if re.search(r"[A-Za-z]\u3002", ex):
                # 英文单词后面直接跟中文句号 = 英文句子被截断（渲染时会粘成一行）
                bad.append((word, "英文例句被截断"))
            if "\n" in ex:
                bad.append((word, "例句含换行"))
        self.assertEqual([], bad[:20], "例句不符合规范")

    def test_06_browse_query_renders_detail(self) -> None:
        """单词浏览器「查询」要真的渲染出巧记与例句。"""
        samples = ["magnify", "ambition", "metaphor", "ecosystem"]
        for word in samples:
            result = self.page.evaluate(
                """(word) => {
                    const w = FULL_WORDS.find(x => x.word === word);
                    if (!w) return null;
                    const box = document.createElement('div');
                    box.innerHTML = getWordDetailHTML(w, 'full');
                    const text = box.textContent.replace(/\\s+/g, ' ');
                    return {hasMemo: !!w.memo, hasExample: !!w.example, text: text};
                }""",
                word,
            )
            self.assertIsNotNone(result, word)
            self.assertTrue(result["hasMemo"], word)
            self.assertTrue(result["hasExample"], word)
            self.assertIn("巧记", result["text"], word)
            self.assertIn("例句", result["text"], word)

    def test_07_no_word_lacks_detail_in_the_browser(self) -> None:
        """2026-09-12 起全库配齐：浏览器数据源里不应再有任何无详解的词。"""
        word = self.page.evaluate(
            """() => {
                const w = FULL_WORDS.find(x => !x.memo && !x.example);
                return w ? w.word : null;
            }"""
        )
        self.assertIsNone(word, "全库已配齐详解，不应存在无详解的词：%s" % word)


if __name__ == "__main__":
    unittest.main(verbosity=2)

"""The page template in a real browser (headless Chromium through Playwright).

Setup once per machine: `uv run playwright install chromium-headless-shell`; without that browser the tests skip.
Pages are built in a temporary folder, link template/report.css and report.js by file URL, and open from disk.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from agent_pages import TEMPLATE_DIR

try:
    from playwright.sync_api import Error as PlaywrightError, sync_playwright
except ImportError:  # the dev dependencies are not installed
    sync_playwright = None

HEAD = (f'<link rel="stylesheet" href="{(TEMPLATE_DIR / "report.css").as_uri()}">'
        f'<script src="{(TEMPLATE_DIR / "report.js").as_uri()}"></script>')
FILLER = "<p>" + "Text after the table. " * 200 + "</p>"


def page_html(body: str, doc_id: str) -> str:
    return (f'<!DOCTYPE html><html lang="en" data-doc-id="{doc_id}"><head><meta charset="utf-8">'
            f'<title>T</title>{HEAD}</head><body><main><h1>T</h1>{body}</main></body></html>')


def table(rows: int = 60, cols: int = 3) -> str:
    """A table with a first row of th (report.js moves it into a sticky thead); many columns make it wider than the
    text column, so it scrolls inside its own frame."""
    head = "".join(f"<th>Column {c}</th>" for c in range(cols))
    body = "".join("<tr>" + "".join(f"<td>Cell {r}.{c}</td>" for c in range(cols)) + "</tr>" for r in range(rows))
    return f"<table><tr>{head}</tr>{body}</table>"


def sections(content: str) -> str:
    return f"<h2>First</h2><p>Intro.</p>{content}<h2>Second</h2>{FILLER}"


class Browser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sync_playwright is None:
            raise unittest.SkipTest("playwright is not installed (uv sync installs the dev dependencies)")
        cls._pw = sync_playwright().start()
        try:
            cls.browser = cls._pw.chromium.launch()
        except PlaywrightError as e:
            cls._pw.stop()
            raise unittest.SkipTest(f"no Playwright Chromium; run `uv run playwright install chromium-headless-shell` ({e})")

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls._pw.stop()

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.ctx = self.browser.new_context(viewport={"width": 1200, "height": 800})
        self.page = self.ctx.new_page()

    def tearDown(self):
        self.ctx.close()
        self._tmp.cleanup()

    def write(self, body: str, doc_id: str, name: str = "page.html") -> Path:
        p = self.dir / name
        p.write_text(page_html(body, doc_id))
        return p

    def open(self, path: Path, query: str = "") -> None:
        self.page.goto(path.as_uri() + query)
        self.page.wait_for_selector(".bn-bar")


class Layout(Browser):
    def test_page_without_sections_uses_the_full_text_column(self):
        """No h2, so no outline: the text takes the column, not the outline's 14.5rem one."""
        self.open(self.write("<p>" + "Words. " * 300 + "</p>", "layout-no-toc"))
        s = self.page.evaluate("""() => ({ toc: document.getElementById('bn-toc').hidden,
                                           main: document.querySelector('.bn-main').getBoundingClientRect().width })""")
        self.assertTrue(s["toc"])
        self.assertGreater(s["main"], 700)

    def test_page_with_sections_keeps_its_outline(self):
        self.open(self.write(sections("<p>Body.</p>"), "layout-toc"))
        s = self.page.evaluate("""() => ({ toc: document.getElementById('bn-toc').getBoundingClientRect().width,
                                           main: document.querySelector('.bn-main').getBoundingClientRect().width })""")
        self.assertGreater(s["toc"], 150)
        self.assertGreater(s["main"], 700)


class StickyTableHeader(Browser):
    """A table's header row sticks (under the page bar, or at the top of a wide table's own frame) and hides the rows
    scrolling under it, also when the change diff marks it as new, with the changes shown or hidden, light or dark."""

    def revised(self, content: str, doc_id: str) -> Path:
        """A page read once without the table, then revised with it, so the diff marks every table row as new."""
        p = self.write(sections(""), doc_id)
        self.open(p)
        p.write_text(page_html(sections(content), doc_id))
        return p

    def header_state(self) -> dict:
        """Scroll 400 px into the table (the page, or the frame of a wide table) and describe its first header cell."""
        return self.page.evaluate("""() => {
          const t = document.querySelector('main table'), th = t.querySelector('thead th');
          const w = t.closest('.bn-table'), wide = w.classList.contains('is-wide'), se = document.scrollingElement;
          let top;
          if (wide) {
            window.scrollTo({ top: w.getBoundingClientRect().top + se.scrollTop - 80, behavior: 'instant' });
            w.scrollTop = 400;
            top = w.getBoundingClientRect().top + w.clientTop;
          } else {
            window.scrollTo({ top: t.getBoundingClientRect().top + se.scrollTop + 400, behavior: 'instant' });
            top = document.querySelector('.bn-bar').getBoundingClientRect().bottom;
          }
          const r = th.getBoundingClientRect(), bg = getComputedStyle(th).backgroundColor;
          const m = /rgba?\\(([^)]+)\\)/.exec(bg), parts = m ? m[1].split(',').map(Number) : [];
          return { wide, newRow: th.parentNode.classList.contains('bn-chg-new'), stuck: Math.abs(r.top - top) < 1.5,
                   bg, alpha: parts.length === 4 ? parts[3] : 1,
                   onTop: document.elementFromPoint(r.left + 5, r.top + r.height / 2) === th };
        }""")

    def check(self, s: dict, wide: bool, new: bool) -> None:
        self.assertEqual(s["wide"], wide)
        self.assertEqual(s["newRow"], new, "the diff marks the header row as new on a revised page")
        self.assertTrue(s["stuck"], "the header sticks")
        self.assertTrue(s["onTop"], "the header is painted above the rows")
        self.assertEqual(s["alpha"], 1, f"the header background is opaque, got {s['bg']}")

    def test_revised_page_header_stays_opaque(self):
        for wide, cols in ((False, 3), (True, 14)):
            p = self.revised(table(cols=cols), f"sticky-revised-{cols}")
            for theme in ("light", "dark"):
                for shown in (True, False):
                    with self.subTest(wide=wide, theme=theme, changes_shown=shown):
                        self.open(p, f"?theme={theme}")
                        if not shown:
                            self.page.keyboard.press("d")
                            self.assertTrue(self.page.evaluate("document.body.classList.contains('bn-diff-off')"))
                        self.check(self.header_state(), wide=wide, new=True)

    def test_unchanged_page_header_is_opaque(self):
        for wide, cols in ((False, 3), (True, 14)):
            with self.subTest(wide=wide):
                self.open(self.write(sections(table(cols=cols)), f"sticky-plain-{cols}", f"plain-{cols}.html"))
                self.check(self.header_state(), wide=wide, new=False)


if __name__ == "__main__":
    unittest.main()

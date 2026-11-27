"""`agent-pages open` and `drain` prefer the server's copy of a page, so comments sync between devices.

    uv run python -m unittest discover -s tests
"""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from agent_pages import config, report

BASE = "https://server.example:15443"


class ServedUrl(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name).resolve()
        docs = self.home / "docs"
        (docs / "area").mkdir(parents=True)
        self.page = docs / "area" / "my page.html"
        self.page.write_text("<html><head><title>T</title></head></html>")
        self.sha = hashlib.sha256(self.page.read_bytes()).hexdigest()
        self.cfg = config.Config(path=self.home / "config.toml", exists=False, roots={"documents": docs}, base_url=BASE)
        self.asked: list[str] = []

    def tearDown(self):
        self._tmp.cleanup()

    def fetch(self, *answers):
        """A status fetcher answering in turn: a dict, None (404) or an exception (server unreachable)."""
        it = iter(answers)

        def f(cfg, path):
            self.asked.append(path)
            a = next(it, answers[-1])
            if isinstance(a, Exception):
                raise a
            return a
        return f

    def served(self, *answers, wait=15):
        return report.served_url(self.cfg, self.page, fetch=self.fetch(*answers), wait=wait, sleep=lambda s: None)

    def test_current_copy_opens_from_the_server(self):
        url, notes = self.served({"sha256": self.sha, "shared": []})
        self.assertEqual(url, BASE + "/documents/area/my%20page.html")
        self.assertEqual(notes, [])
        self.assertEqual(self.asked, ["/documents/area/my%20page.html"])

    def test_waits_until_the_server_has_the_current_version(self):
        url, _ = self.served(None, {"sha256": "old", "shared": []}, {"sha256": self.sha, "shared": []})
        self.assertIsNotNone(url)
        self.assertEqual(len(self.asked), 3)

    def test_stale_copy_falls_back_to_the_file(self):
        url, notes = self.served({"sha256": "old", "shared": []}, wait=3)
        self.assertIsNone(url)
        self.assertIn("not serve the current version", notes[0])

    def test_unreachable_server_falls_back_at_once(self):
        url, notes = self.served(OSError("refused"))
        self.assertIsNone(url)
        self.assertEqual(len(self.asked), 1)
        self.assertIn("unreachable", notes[0])

    def test_outside_the_roots_and_other_files(self):
        other = self.home / "elsewhere.html"
        other.write_text("x")
        self.assertIsNone(report.served_url(self.cfg, other, fetch=self.fetch(None))[0])
        pdf = self.page.with_suffix(".pdf")
        pdf.write_bytes(b"%PDF")
        self.assertIsNone(report.served_url(self.cfg, pdf, fetch=self.fetch(None))[0])
        self.assertEqual(self.asked, [])

    def test_shared_id_warns(self):
        url, notes = self.served({"sha256": self.sha, "shared": ["/documents/b.html"]})
        self.assertIsNotNone(url)
        self.assertIn("/documents/b.html", notes[0])

    def test_drain_opens_only_server_links(self):
        self.assertEqual(report.request_url(self.cfg, {"url": BASE + "/documents/x.html"}), BASE + "/documents/x.html")
        for bad in ("https://evil.example/x.html", BASE + ".evil.example/x", "file:///etc/passwd", "", None, 3):
            self.assertIsNone(report.request_url(self.cfg, {"url": bad}), bad)
        self.assertIsNone(report.request_url(self.cfg, {}))

    def test_remote_open_queues_the_server_link(self):
        queue = self.home / "queue"
        self.cfg.remote_open = config.RemoteOpen(queue=queue, synced=[(self.home / "docs", Path("/Users/me/Documents"))])
        args = mock.Mock(path=str(self.page))
        with mock.patch.object(report, "IS_MAC", False), \
                mock.patch.object(report, "fetch_status", self.fetch({"sha256": self.sha, "shared": []})), \
                mock.patch("sys.stdout"):
            report.cmd_open(self.cfg, args)
        req = json.loads(next(queue.glob("*.json")).read_text())
        self.assertEqual(req["url"], BASE + "/documents/area/my%20page.html")
        self.assertEqual(req["mac_path"], "/Users/me/Documents/area/my page.html")


class TemplateScript(unittest.TestCase):
    """A page that links report.css without report.js renders the styles but has no bar, search, comments or Send."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def page(self, head: str, name: str = "p.html") -> Path:
        p = self.dir / name
        p.write_text(f"<!DOCTYPE html><html><head>{head}</head><body><main></main></body></html>")
        return p

    def test_stylesheet_without_script_warns(self):
        p = self.page('<link rel="stylesheet" href="file:///x/template/report.css">')
        notes = report.template_notes(p)
        self.assertEqual(len(notes), 1)
        self.assertIn("report.js", notes[0])
        self.assertIn("Send to agent", notes[0])

    def test_stylesheet_and_script_pass(self):
        p = self.page('<link rel="stylesheet" href="/_template/report.css">\n<script src="/_template/report.js"></script>')
        self.assertEqual(report.template_notes(p), [])

    def test_other_pages_and_files_pass(self):
        self.assertEqual(report.template_notes(self.page('<link rel="stylesheet" href="site.css">')), [])
        pdf = self.dir / "x.pdf"
        pdf.write_bytes(b"%PDF report.css")
        self.assertEqual(report.template_notes(pdf), [])

    def test_url_warns(self):
        docs = self.dir / "docs"
        docs.mkdir()
        p = docs / "p.html"
        p.write_text('<html><head><link rel="stylesheet" href="/_template/report.css"></head></html>')
        cfg = config.Config(path=self.dir / "config.toml", exists=False, roots={"documents": docs}, base_url=BASE)
        with mock.patch("sys.stdout"), mock.patch("sys.stderr") as err:
            report.cmd_url(cfg, mock.Mock(path=str(p)))
        self.assertIn("report.js", "".join(c.args[0] for c in err.write.call_args_list))


if __name__ == "__main__":
    unittest.main()

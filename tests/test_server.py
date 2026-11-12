"""Routes of `agent-pages serve` against temporary roots, lessons folder and home.

    uv run python -m unittest discover -s tests
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

from agent_pages import config
from agent_pages.server import app, jobs, reports

SLUG = "2026-01-02_test-lesson"
PAGE = """<!doctype html><html><head><title>Budget review</title>
<link rel="stylesheet" href="file:///Users/someone/code/agent-pages/template/report.css">
<script src="file:///home/someone/code/agent-pages/template/report.js"></script>
<link rel="icon" href="file:///Users/someone/old-template/favicon.png">
</head><body>
<img src="figures/chart.png">
<a href="file:///home/someone/docs/area/other.html">other</a>
<a href="file:///Users/someone/elsewhere/notes.txt">outside</a>
<link rel="stylesheet" href="../../old-template/report.css">
</body></html>
"""


MARKER = '<meta name="agent-pages-kind" content="lesson">'
LESSON_PAGE = f"""<!DOCTYPE html>
<html lang="en" data-doc-id="2026-03-04_how-it-works">
<head>
<meta charset="utf-8">
{MARKER}
<title>How it works</title>
</head><body><main><h2>Idea</h2><h2>Parts</h2></main></body></html>
"""
PLAIN_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Plain report</title>
</head><body><main><p>Answer.</p></main></body></html>
"""
INPLACE_URL = "/documents/area/2026-03-04_how-it-works.html"


class PageKind(unittest.TestCase):
    def test_marker_read(self):
        self.assertEqual(reports.page_kind(LESSON_PAGE), "lesson")
        self.assertEqual(reports.page_kind(PLAIN_PAGE), "report")
        self.assertEqual(reports.page_kind("<head><meta content='lesson' name='agent-pages-kind'></head>"), "lesson")
        self.assertEqual(reports.page_kind('<head><meta name="agent-pages-kind" content="report"></head>'), "report")
        self.assertEqual(reports.page_kind("<head>" + " " * 30_000 + MARKER), "report")  # past the first 20 kB

    def test_set_kind(self):
        marked = reports.set_kind(PLAIN_PAGE, "lesson")
        self.assertIn('<meta charset="utf-8">\n' + MARKER + "\n<title>", marked)
        self.assertEqual(reports.set_kind(marked, "lesson").count(MARKER), 1)
        self.assertEqual(reports.set_kind(marked, "report"), PLAIN_PAGE)
        no_charset = "<html><head>\n<title>T</title></head></html>"
        self.assertEqual(reports.set_kind(no_charset, "lesson"), "<html><head>\n" + MARKER + "\n<title>T</title></head></html>")
        with self.assertRaises(ValueError):
            reports.set_kind("<p>no head</p>", "lesson")

    def test_inplace_slug(self):
        slug = reports.inplace_slug(INPLACE_URL)
        self.assertRegex(slug, r"^page-[0-9a-f]{12}$")
        self.assertEqual(slug, reports.inplace_slug(INPLACE_URL))
        self.assertNotEqual(slug, reports.inplace_slug("/documents/area/other.html"))


class ServerRoutes(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        home = Path(self._tmp.name).resolve()
        self._env = mock.patch.dict(os.environ, {"HOME": str(home)})
        self._env.start()
        self._quiet = mock.patch.object(app.Handler, "log_message", lambda *a: None)
        self._quiet.start()
        self.home = home
        docs = home / "docs"
        (docs / "area" / "reports" / "figures").mkdir(parents=True)
        (docs / "area" / "reports" / "page.html").write_text(PAGE)
        (docs / "area" / "reports" / "figures" / "chart.png").write_bytes(b"\x89PNG fake")
        (docs / "area" / "reports" / "secret.png").write_bytes(b"not referenced")
        (docs / "area" / "reports" / "notes.py").write_text("print('no')")
        (docs / "area" / "other.html").write_text("<title>Other</title>")
        (docs / "area" / "2026-03-04_how-it-works.html").write_text(LESSON_PAGE)
        (docs / "area" / "plain.html").write_text(PLAIN_PAGE)
        (docs / ".hidden").mkdir()
        (docs / ".hidden" / "x.html").write_text("<title>Hidden</title>")
        # an old copy of the template, now an alias of the repo template
        (docs / "old-template").mkdir()
        (docs / "old-template" / "report.html").write_text("<title>Old skeleton</title>")
        # the repo itself, under the fake home as on the real machines
        (home / "code").mkdir()
        (home / "code" / "agent-pages").symlink_to(app.REPO)
        code = home / "code-sync"
        (code / "org" / "repo" / "sync").mkdir(parents=True)
        (code / "org" / "repo" / "sync" / "plan.html").write_text("<title>Plan</title>")
        lessons = docs / "lessons"
        (lessons / SLUG).mkdir(parents=True)
        (lessons / SLUG / "index.html").write_text("<title>A lesson</title><main><h2>One</h2></main>")
        (lessons / SLUG / "lesson.json").write_text(json.dumps({"title": "A lesson"}))
        self.cfg = config.Config(path=home / "config.toml", exists=False, roots={"documents": docs, "code": code},
                                 lessons_dir=lessons, template_aliases=[home / "old-template", docs / "old-template"])
        self.srv, self.index = app.build(self.cfg, "127.0.0.1", 0)
        self.base = "http://127.0.0.1:%d" % self.srv.server_address[1]
        self.thread = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self._quiet.stop()
        self._env.stop()
        self._tmp.cleanup()

    def get(self, path: str, data: bytes | None = None, headers: dict | None = None) -> tuple[int, bytes, str]:
        req = urllib.request.Request(self.base + path, data=data, headers=headers or {})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read(), r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers.get("Content-Type", "")

    def test_report_page_links_rewritten(self):
        status, body, ctype = self.get("/documents/area/reports/page.html")
        self.assertEqual(status, 200)
        self.assertTrue(ctype.startswith("text/html"))
        text = body.decode()
        self.assertIn('href="/_template/report.css"', text)  # repo template, Mac home
        self.assertIn('src="/_template/report.js"', text)  # repo template, Linux home
        self.assertIn('href="/_template/favicon.png"', text)  # old template folder (alias)
        self.assertIn('href="/documents/area/other.html"', text)  # a page under a root
        self.assertIn("file:///Users/someone/elsewhere/notes.txt", text)  # outside: left alone

    def test_only_indexed_pages_and_their_files(self):
        self.assertEqual(self.get("/documents/area/reports/figures/chart.png")[0], 200)
        self.assertEqual(self.get("/documents/area/reports/secret.png")[0], 404)
        self.assertEqual(self.get("/documents/area/reports/notes.py")[0], 404)
        self.assertEqual(self.get("/documents/.hidden/x.html")[0], 404)
        self.assertEqual(self.get("/documents/area/../area/other.html")[0], 404)
        self.assertEqual(self.get("/nosuchroot/x.html")[0], 404)
        self.assertEqual(self.get("/code/org/repo/sync/plan.html")[0], 200)

    def test_template_routes(self):
        status, body, ctype = self.get("/_template/report.css")
        self.assertEqual(status, 200)
        self.assertTrue(ctype.startswith("text/css"))
        self.assertEqual(self.get("/lessons/_assets/report.css")[1], body)
        self.assertEqual(self.get("/_template/report.html")[0], 404)  # skeleton pages are not assets
        self.assertEqual(self.get("/_template/bundle.py")[0], 404)
        self.assertEqual(self.get("/favicon.png")[0], 200)
        self.assertEqual(self.get("/apple-touch-icon.png")[0], 200)
        # a relative link into the old template folder under a root gets the repo template
        self.assertEqual(self.get("/documents/old-template/report.css")[1], body)

    def test_page_index(self):
        status, body, _ = self.get("/api/pages")
        self.assertEqual(status, 200)
        pages = {p["url"]: p for p in json.loads(body)["pages"]}
        self.assertIn("/documents/area/reports/page.html", pages)
        page = pages["/documents/area/reports/page.html"]
        self.assertEqual((page["title"], page["root"], page["area"], page["path"]),
                         ("Budget review", "documents", "area", "~/docs/area/reports/page.html"))
        self.assertEqual(pages["/code/org/repo/sync/plan.html"]["area"], "org/repo")
        self.assertFalse(any("/lessons/" in u for u in pages))  # lessons are listed by /api/lessons
        self.assertFalse(any("old-template" in u for u in pages))
        self.assertFalse(any(".hidden" in u for u in pages))
        mtimes = [p["mtime"] for p in json.loads(body)["pages"]]
        self.assertEqual(mtimes, sorted(mtimes, reverse=True))
        self.assertEqual(json.loads(self.get("/index.json")[1]), json.loads(body)["pages"])

    def test_lessons(self):
        lessons = json.loads(self.get("/api/lessons")[1])["lessons"]
        self.assertEqual([m["slug"] for m in lessons if not m.get("inplace")], [SLUG])
        self.assertEqual(self.get(f"/lessons/{SLUG}/")[0], 200)
        self.assertEqual(self.get("/lessons/_data/state.json")[0], 404)
        self.assertEqual(json.loads(self.get("/api/projects")[1]), {"projects": []})  # no vault configured
        payload = json.dumps({"data": {"answers": {"q1": "yes"}}}).encode()
        status, _, _ = self.get(f"/api/lessons/{SLUG}/review", payload, {"Content-Type": "application/json"})
        self.assertEqual(status, 200)
        review = json.loads(self.get(f"/api/lessons/{SLUG}/review")[1])
        self.assertEqual(review["data"], {"answers": {"q1": "yes"}})
        self.assertEqual(self.get("/api/lessons/2026-01-02_nope/review")[0], 404)

    def post(self, path: str, body: dict, headers: dict | None = None) -> tuple[int, dict]:
        status, data, _ = self.get(path, json.dumps(body).encode(), {"Content-Type": "application/json", **(headers or {})})
        return status, json.loads(data or b"{}")

    def test_marker_scan(self):
        pages = {p["url"]: p for p in json.loads(self.get("/api/pages")[1])["pages"]}
        self.assertNotIn(INPLACE_URL, pages)  # a lesson, not a report
        self.assertEqual(pages["/documents/area/plain.html"]["kind"], "report")
        self.assertTrue(all(p["kind"] == "report" for p in pages.values()))
        self.assertEqual(self.get(INPLACE_URL)[0], 200)  # still served at its own URL
        # the lessons-folder URL of an in-place lesson (older app builds, links) redirects to the page
        slug = reports.inplace_slug(INPLACE_URL)
        self.assertEqual(self.get(f"/lessons/{slug}/")[1], self.get(INPLACE_URL)[1])
        self.assertEqual(self.get("/lessons/page-000000000000/")[0], 404)

    def test_inplace_lesson_listed_and_edited(self):
        slug = reports.inplace_slug(INPLACE_URL)
        lessons = {m["slug"]: m for m in json.loads(self.get("/api/lessons")[1])["lessons"]}
        self.assertEqual(set(lessons), {SLUG, slug})
        m = lessons[slug]
        self.assertEqual((m["title"], m["created"], m["status"], m["url"], m["inplace"], m["doc_id"]),
                         ("How it works", "2026-03-04", "learning", INPLACE_URL, True, "2026-03-04_how-it-works"))
        self.assertEqual(m["path"], "~/docs/area/2026-03-04_how-it-works.html")
        self.assertEqual(m["counts"]["sections"], 2)
        before = (self.home / "docs" / "area" / "2026-03-04_how-it-works.html").read_text()
        req = urllib.request.Request(f"{self.base}/api/lessons/{slug}", method="PATCH",
                                     data=json.dumps({"status": "understood", "title": "Own title", "tags": ["x"]}).encode())
        with urllib.request.urlopen(req) as r:
            self.assertEqual(json.loads(r.read())["status"], "understood")
        self.assertEqual((self.home / "docs" / "area" / "2026-03-04_how-it-works.html").read_text(), before)
        stored = json.loads((self.cfg.lessons_dir / "_data" / "pages.json").read_text())
        self.assertEqual(stored[INPLACE_URL], {"status": "understood", "title": "Own title", "tags": ["x"]})
        m = {x["slug"]: x for x in json.loads(self.get("/api/lessons")[1])["lessons"]}[slug]
        self.assertEqual((m["title"], m["status"], m["tags"]), ("Own title", "understood", ["x"]))
        self.assertEqual(self.post(f"/api/lessons/{slug}/opened", {})[0], 200)
        self.assertEqual(self.post(f"/api/lessons/{slug}/review", {"data": {"notes": "n"}})[0], 200)
        self.assertEqual(json.loads(self.get(f"/api/lessons/{slug}/review")[1])["data"], {"notes": "n"})
        self.assertEqual(self.get("/api/lessons/page-000000000000/review")[0], 404)

    def test_inplace_revision_targets_the_page(self):
        slug = reports.inplace_slug(INPLACE_URL)
        job = jobs.create_revision(slug, "## Notes\nmore on parts")
        self.assertEqual((job["kind"], job["slug"], job["title"]), ("revise", slug, "How it works"))
        line = jobs._revise_line(job)
        self.assertIn(str(self.home / "docs" / "area" / "2026-03-04_how-it-works.html"), line)
        self.assertNotIn("lesson.json", jobs._revise_prompt(job))
        self.assertGreater(jobs._page_mtime(slug), 0)

    def test_toggle_kind(self):
        page = self.home / "docs" / "area" / "plain.html"
        mtime = page.stat().st_mtime_ns
        status, r = self.post("/api/pages/kind", {"url": "/documents/area/plain.html", "kind": "lesson"})
        self.assertEqual(status, 200)
        self.assertEqual(r["slug"], reports.inplace_slug("/documents/area/plain.html"))
        self.assertIn('<meta charset="utf-8">\n' + MARKER + "\n<title>", page.read_text())
        self.assertEqual(page.stat().st_mtime_ns, mtime)
        self.assertIn(r["slug"], [m["slug"] for m in json.loads(self.get("/api/lessons")[1])["lessons"]])
        self.assertNotIn("/documents/area/plain.html", [p["url"] for p in json.loads(self.get("/api/pages")[1])["pages"]])
        status, r = self.post("/api/pages/kind", {"url": "/documents/area/plain.html", "kind": "report"})
        self.assertEqual((status, r["kind"]), (200, "report"))
        self.assertEqual(page.read_text(), PLAIN_PAGE)
        self.assertIn("/documents/area/plain.html", [p["url"] for p in json.loads(self.get("/api/pages")[1])["pages"]])

    def test_toggle_kind_refused(self):
        for url in ("/documents/../outside.html", "/nosuchroot/x.html", "/documents/area/reports/notes.py",
                    "/documents/.hidden/x.html", f"/documents/lessons/{SLUG}/index.html",
                    "/documents/old-template/report.html", "/documents/area/missing.html", "documents/area/plain.html"):
            status, r = self.post("/api/pages/kind", {"url": url, "kind": "lesson"})
            self.assertEqual(status, 400, url)
        self.assertEqual(self.post("/api/pages/kind", {"url": "/documents/area/plain.html", "kind": "draft"})[0], 400)
        self.assertEqual(self.post("/api/pages/kind", {"url": "/documents/area/plain.html", "kind": "lesson"},
                                   {"Origin": "https://evil.example"})[0], 403)
        self.assertNotIn(MARKER, (self.home / "docs" / "lessons" / SLUG / "index.html").read_text())
        self.assertNotIn(MARKER, (self.home / "docs" / "area" / "plain.html").read_text())

    def test_cross_origin_mutation_refused(self):
        payload = json.dumps({"data": {}}).encode()
        status, _, _ = self.get(f"/api/lessons/{SLUG}/review", payload, {"Origin": "https://evil.example"})
        self.assertEqual(status, 403)

    def test_app_theme(self):
        # default app theme plain: report.css's tokens, prefixed, with the Inter faces
        status, body, ctype = self.get("/api/theme.css")
        self.assertEqual(status, 200)
        self.assertTrue(ctype.startswith("text/css"))
        css = body.decode()
        self.assertIn("--pg-bg: #F4F1E8", css)
        self.assertIn(":root[data-theme=\"dark\"]", css)
        self.assertIn('font-family: "Report Inter"', css)
        self.assertNotIn("--bg:", css)  # nothing collides with the app's own tokens
        self.assertNotIn(".bn-bar", css)  # tokens only, not the page styles
        # tum: its own tokens after report.css's, Helvetica, no Inter faces
        self.assertIn("--pg-primary: #0065BD", app.app_theme_css(config.theme_css("tum"), "tum"))
        self.assertNotIn("@font-face", app.app_theme_css(config.theme_css("tum"), "tum"))

    def test_app_and_health(self):
        self.assertIn(self.get("/")[0], (200, 503))  # 503 until apps/ui is built
        self.assertEqual(json.loads(self.get("/healthz")[1]), {"ok": True})


if __name__ == "__main__":
    unittest.main()

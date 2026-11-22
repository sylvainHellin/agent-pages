"""Routes of `agent-pages serve` against temporary roots, lessons folder and home.

    uv run python -m unittest discover -s tests
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock
from urllib.parse import quote

from agent_pages import config
from agent_pages.server import app, jobs, library, reports

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
REVIEW_PAGE = """<!DOCTYPE html>
<html lang="en" data-doc-id="{id}">
<head>
<meta charset="utf-8">
<title>Reviewed</title>
<script src="file:///home/someone/code/agent-pages/template/report.js"></script>
</head><body><main><p>Text.</p></main></body></html>
"""


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

    def pages(self) -> list[dict]:
        """The unmarked pages under the roots, as /index.json lists them."""
        status, body, _ = self.get("/index.json")
        self.assertEqual(status, 200)
        return json.loads(body)

    def test_page_index(self):
        pages = {p["url"]: p for p in self.pages()}
        self.assertIn("/documents/area/reports/page.html", pages)
        page = pages["/documents/area/reports/page.html"]
        self.assertEqual((page["title"], page["root"], page["area"], page["path"]),
                         ("Budget review", "documents", "area", "~/docs/area/reports/page.html"))
        self.assertEqual(pages["/code/org/repo/sync/plan.html"]["area"], "org/repo")
        self.assertFalse(any("/lessons/" in u for u in pages))  # tutor lessons are listed by /api/items only
        self.assertFalse(any("old-template" in u for u in pages))
        self.assertFalse(any(".hidden" in u for u in pages))
        mtimes = [p["mtime"] for p in self.pages()]
        self.assertEqual(mtimes, sorted(mtimes, reverse=True))

    def test_lessons(self):
        tutor = [i["slug"] for i in json.loads(self.get("/api/items")[1])["items"] if i["origin"] == "tutor"]
        self.assertEqual(tutor, [SLUG])
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

    def test_lessons_private_files(self):
        lessons = self.cfg.lessons_dir
        (lessons / "_data").mkdir(exist_ok=True)
        (lessons / "_data" / "state.json").write_text("{}")
        (lessons / SLUG / ".env").write_text("TOKEN=secret")
        (lessons / SLUG / "figures").mkdir()
        (lessons / SLUG / "figures" / "chart.png").write_bytes(b"\x89PNG fake")
        (lessons / SLUG / "state-link.json").symlink_to(lessons / "_data" / "state.json")
        # what a lesson page and the app load keep working
        self.assertEqual(self.get(f"/lessons/{SLUG}/")[0], 200)
        self.assertEqual(self.get(f"/lessons/{SLUG}/index.html")[0], 200)
        self.assertEqual(self.get(f"/lessons/{SLUG}/figures/chart.png")[:2], (200, b"\x89PNG fake"))
        self.assertEqual(self.get("/lessons/_assets/report.css")[0], 200)
        self.assertEqual(self.get("/lessons/_assets/review-sync.js")[0], 200)
        # dot files, dot and dot-dot segments, and anything that resolves into _data stay private
        for path in (f"/lessons/{SLUG}/.env", "/lessons/./_data/state.json",
                     f"/lessons/{SLUG}/../_data/state.json", f"/lessons/{SLUG}/state-link.json",
                     "/lessons/_assets/../../.git/HEAD", "/lessons/%2e/_data/state.json"):
            with self.subTest(path=path):
                self.assertEqual(self.get(path)[0], 404)

    def test_marker_scan(self):
        pages = {p["url"]: p for p in self.pages()}
        self.assertNotIn(INPLACE_URL, pages)  # marked: listed by /api/items with the lesson tag
        self.assertEqual(pages["/documents/area/plain.html"]["kind"], "report")
        self.assertTrue(all(p["kind"] == "report" for p in pages.values()))
        self.assertEqual(self.get(INPLACE_URL)[0], 200)  # still served at its own URL
        # the lessons-folder URL of an in-place lesson (older app builds, links) redirects to the page
        slug = reports.inplace_slug(INPLACE_URL)
        self.assertEqual(self.get(f"/lessons/{slug}/")[1], self.get(INPLACE_URL)[1])
        self.assertEqual(self.get("/lessons/page-000000000000/")[0], 404)

    def test_inplace_lesson_listed_and_edited(self):
        slug = reports.inplace_slug(INPLACE_URL)
        m = self.items()[INPLACE_URL]
        self.assertEqual((m["title"], m["created"], m["status"], m["slug"], m["doc_id"]),
                         ("How it works", "2026-03-04", "open", slug, "2026-03-04_how-it-works"))
        self.assertEqual(m["path"], "~/docs/area/2026-03-04_how-it-works.html")
        self.assertEqual(m["counts"]["sections"], 2)
        before = (self.home / "docs" / "area" / "2026-03-04_how-it-works.html").read_text()
        status, r = self.patch(m["id"], {"status": "done", "title": "Own title", "tags": ["x", "lesson"]})
        self.assertEqual((status, r["status"]), (200, "done"))
        self.assertEqual((self.home / "docs" / "area" / "2026-03-04_how-it-works.html").read_text(), before)
        stored = self.stored()["2026-03-04_how-it-works"]
        self.assertEqual((stored["status"], stored["title"], stored["tags"]), ("done", "Own title", ["x"]))
        m = self.items()[INPLACE_URL]
        self.assertEqual((m["title"], m["status"], m["tags"]), ("Own title", "done", ["x", "lesson"]))
        self.assertEqual(library.read_meta(slug)["title"], "Own title")
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

    # ---- review state of every served page (template/review-sync.js) ----
    def boot(self, url: str) -> dict | None:
        """The TutorSync.page() call the server put into a page's head, or None."""
        text = self.get(url)[1].decode()
        m = re.search(r"<script>TutorSync\.page\((.*?)\);</script>", text, re.S)
        if m is None:
            self.assertNotIn("review-sync.js", text)
            return None
        self.assertLess(text.index("/_template/review-sync.js"), text.index(m.group(0)))
        if "report.js" in text:
            self.assertLess(text.index(m.group(0)), text.index("report.js"))  # before report.js reads storage
        return json.loads(m.group(1).replace("<\\/", "</"))

    def write_page(self, rel: str, text: str) -> None:
        (self.home / "docs" / rel).write_text(text)
        self.index.scan()

    def test_review_boot_in_served_pages(self):
        b = self.boot("/documents/area/reports/page.html")  # no data-doc-id: keyed by its URL
        self.assertRegex(b["path"], r"^reviews/r[0-9a-f]{16}$")
        self.assertEqual((b["api"], b["state"], b.get("shared"), b.get("lesson")), ("/api/", {"updated": 0, "data": {}}, [], False))
        self.assertIsNone(self.boot("/documents/area/plain.html"))  # no report.js, no review layer
        self.write_page("area/ided.html", REVIEW_PAGE.format(id="ided"))
        self.assertNotEqual(self.boot("/documents/area/ided.html")["path"], b["path"])

    def test_page_review_round_trip(self):
        self.write_page("area/ided.html", REVIEW_PAGE.format(id="ided"))
        path = self.boot("/documents/area/ided.html")["path"]
        status, r = self.post(f"/api/{path}", {"data": {"notes": "ends </script> here", "junk": 1}})
        self.assertEqual(status, 200)
        self.assertGreater(r["updated"], 0)
        self.assertEqual(json.loads(self.get(f"/api/{path}")[1])["data"], {"notes": "ends </script> here"})
        b = self.boot("/documents/area/ided.html")
        self.assertEqual(b["state"]["data"], {"notes": "ends </script> here"})
        # the same page moved to another folder keeps its id, so its comments follow it
        (self.home / "docs" / "area" / "ided.html").rename(self.home / "docs" / "area" / "reports" / "ided.html")
        self.index.scan()
        self.assertEqual(self.boot("/documents/area/reports/ided.html")["state"]["data"], {"notes": "ends </script> here"})
        self.assertEqual(self.get("/api/reviews/r0000000000000000")[0], 404)
        self.assertEqual(self.post(f"/api/{path}", {"data": {}}, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.post(f"/api/{path}", {"data": []})[0], 400)

    def test_shared_doc_id_not_synced(self):
        self.write_page("area/twin-a.html", REVIEW_PAGE.format(id="twin"))
        self.write_page("area/reports/twin-b.html", REVIEW_PAGE.format(id="twin"))
        b = self.boot("/documents/area/twin-a.html")
        self.assertEqual((b["shared"], b["state"]), (["/documents/area/reports/twin-b.html"], None))
        self.assertEqual(self.post(f"/api/{b['path']}", {"data": {"notes": "n"}})[0], 409)
        self.assertEqual(self.get(f"/api/{b['path']}")[0], 409)

    def test_review_boot_in_lessons(self):
        self.write_page("area/2026-03-04_how-it-works.html", LESSON_PAGE.replace("</head>", '<script src="report.js"></script></head>'))
        slug = reports.inplace_slug(INPLACE_URL)
        self.post(f"/api/lessons/{slug}/review", {"data": {"notes": "n"}})
        b = self.boot(INPLACE_URL)
        self.assertEqual((b["path"], b["lesson"], b["state"]["data"]), (f"lessons/{slug}/review", True, {"notes": "n"}))
        (self.cfg.lessons_dir / SLUG / "index.html").write_text(
            '<html data-doc-id="%s"><head><script src="../_assets/report.js"></script><title>A lesson</title></head><main></main></html>' % SLUG)
        for url in (f"/lessons/{SLUG}/", f"/lessons/{SLUG}/index.html", f"/documents/lessons/{SLUG}/index.html"):
            b = self.boot(url)
            self.assertEqual((b["path"], b["lesson"]), (f"lessons/{SLUG}/review", True), url)

    def test_page_status(self):
        self.write_page("area/twin-a.html", REVIEW_PAGE.format(id="twin"))
        self.write_page("area/reports/twin-b.html", REVIEW_PAGE.format(id="twin"))
        page = self.home / "docs" / "area" / "reports" / "page.html"
        status, body, _ = self.get("/api/pages/status?url=" + quote("/documents/area/reports/page.html"))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"sha256": hashlib.sha256(page.read_bytes()).hexdigest(), "shared": []})
        self.assertEqual(json.loads(self.get("/api/pages/status?url=/documents/area/twin-a.html")[1])["shared"],
                         ["/documents/area/reports/twin-b.html"])
        self.assertEqual(self.get(f"/api/pages/status?url=/lessons/{SLUG}/")[0], 200)
        self.assertEqual(self.get("/api/pages/status?url=/documents/area/missing.html")[0], 404)
        self.assertEqual(self.get("/api/pages/status?url=/documents/area/reports/secret.png")[0], 404)

    def test_repo_sync_folder_served(self):
        """A repo's .sync folder under a root (a git repo in ~/Documents) is served and listed like the code root's
        mirrored sync folders; every other hidden folder, and a hidden folder inside .sync, stays private."""
        repo = self.home / "docs" / "area" / "repo"
        (repo / ".sync" / "figures").mkdir(parents=True)
        (repo / ".sync" / "check.html").write_text('<title>Sync check</title><img src="figures/f.png">')
        (repo / ".sync" / "figures" / "f.png").write_bytes(b"\x89PNG fake")
        for d in (".git", ".agents", ".stversions", ".sync/.cache", ".sync/node_modules"):
            (repo / d).mkdir(parents=True)
            (repo / d / "x.html").write_text('<title>Private</title><img src="f.png">')
            (repo / d / "f.png").write_bytes(b"\x89PNG fake")
        self.index.scan()
        self.assertEqual(self.get("/documents/area/repo/.sync/check.html")[0], 200)
        self.assertEqual(self.get("/documents/area/repo/.sync/figures/f.png")[0], 200)
        for d in (".git", ".agents", ".stversions", ".sync/.cache", ".sync/node_modules"):
            self.assertEqual(self.get(f"/documents/area/repo/{d}/x.html")[0], 404, d)
            self.assertEqual(self.get(f"/documents/area/repo/{d}/f.png")[0], 404, d)
            self.assertEqual(self.get("/api/pages/status?url=" + quote(f"/documents/area/repo/{d}/x.html"))[0], 404, d)
        self.assertEqual(self.get("/api/pages/status?url=" + quote("/documents/area/repo/.sync/check.html"))[0], 200)
        pages = {p["url"]: p for p in self.pages()}
        self.assertEqual(pages["/documents/area/repo/.sync/check.html"]["area"], "area/repo")
        self.assertFalse(any("Private" == p["title"] for p in pages.values()))
        self.assertFalse(reports.hidden(("area", "repo", ".sync", "check.html")))
        for parts in ((".git", "x.html"), (".agents", "x.html"), (".sync", ".cache", "x.html"), (".sync", "dist", "x.html"),
                      (".syncthing", "x.html"), ("x", ".sync.bak", "y.html")):
            self.assertTrue(reports.hidden(parts), parts)

    # ---- symlinks: what is served is decided by the file a link resolves to ----
    def refused(self, url: str) -> None:
        self.assertEqual(self.get(url)[0], 404, url)
        self.assertEqual(self.get("/api/pages/status?url=" + quote(url))[0], 404, url)

    def listed_titles(self) -> list[str]:
        return [p["title"] for p in self.pages()]

    def test_file_symlink_into_hidden_folder_refused(self):
        docs = self.home / "docs"
        (docs / ".git").mkdir()
        (docs / ".git" / "config").write_text("[remote] token = secret")
        (docs / ".hidden" / "f.png").write_bytes(b"\x89PNG hidden")
        (docs / "area" / "cfg.html").symlink_to("../.git/config")
        (docs / "area" / "link.html").symlink_to("../.hidden/x.html")
        (docs / "area" / "leak.png").symlink_to("../.hidden/f.png")
        (docs / "area" / "uses-leak.html").write_text('<title>Uses leak</title><img src="leak.png">')
        self.index.scan()
        self.refused("/documents/area/cfg.html")
        self.refused("/documents/area/link.html")
        self.assertEqual(self.get("/documents/area/leak.png")[0], 404)
        self.assertEqual(self.get("/documents/area/uses-leak.html")[0], 200)  # the page itself is fine
        self.assertNotIn("Hidden", self.listed_titles())
        self.assertFalse(any(".git" in p["url"] or ".hidden" in p["url"] for p in self.pages()))

    def test_directory_symlink_into_hidden_folder_refused(self):
        docs = self.home / "docs"
        (docs / ".hidden" / "f.png").write_bytes(b"\x89PNG hidden")
        (docs / "area" / "g").symlink_to("../.hidden", target_is_directory=True)
        (docs / "area" / "via-dir.html").write_text('<title>Via dir</title><img src="g/f.png"><a href="g/x.html">x</a>')
        self.index.scan()
        self.assertEqual(self.get("/documents/area/g/f.png")[0], 404)
        self.refused("/documents/area/g/x.html")
        self.assertNotIn("Hidden", self.listed_titles())

    def test_symlink_out_of_every_root_refused(self):
        outside = self.home / "outside"
        outside.mkdir()
        (outside / "secret.html").write_text("<title>Outside</title>")
        (outside / "secret.png").write_bytes(b"\x89PNG outside")
        docs = self.home / "docs"
        (docs / "area" / "out.html").symlink_to(outside / "secret.html")
        (docs / "area" / "out.png").symlink_to(outside / "secret.png")
        (docs / "area" / "ext").symlink_to(outside, target_is_directory=True)
        (docs / "area" / "uses-out.html").write_text('<title>Uses out</title><img src="out.png"><img src="ext/secret.png">')
        self.index.scan()
        self.refused("/documents/area/out.html")
        self.refused("/documents/area/ext/secret.html")
        self.assertEqual(self.get("/documents/area/out.png")[0], 404)
        self.assertEqual(self.get("/documents/area/ext/secret.png")[0], 404)
        self.assertNotIn("Outside", self.listed_titles())

    def test_symlink_to_servable_page_served(self):
        """A link whose target is itself servable keeps working, and the target is listed once, so its comments sync."""
        docs = self.home / "docs"
        self.write_page("area/reports/ided.html", REVIEW_PAGE.format(id="linked"))
        (docs / "area" / "alias.html").symlink_to("reports/ided.html")
        (docs / "area" / "rep").symlink_to("reports", target_is_directory=True)
        self.index.scan()
        for url in ("/documents/area/alias.html", "/documents/area/rep/ided.html", "/documents/area/reports/ided.html"):
            status, body, _ = self.get(url)
            self.assertEqual(status, 200, url)
            self.assertIn("<title>Reviewed</title>", body.decode())
            self.assertEqual(self.get("/api/pages/status?url=" + quote(url))[0], 200, url)
        self.assertEqual(self.get("/documents/area/rep/figures/chart.png")[0], 200)
        urls = [p["url"] for p in self.pages()]
        self.assertEqual(urls.count("/documents/area/reports/ided.html"), 1)
        path = self.boot("/documents/area/alias.html")["path"]
        self.assertEqual(self.get(f"/api/{path}")[0], 200)  # not 409: the link is not a second page with the id

    # ---- one list: every page with one status and general tags (GET/PATCH /api/items) ----
    def items(self) -> dict[str, dict]:
        status, body, _ = self.get("/api/items")
        self.assertEqual(status, 200)
        return {i["url"]: i for i in json.loads(body)["items"]}

    def patch(self, rid: str, body: dict, headers: dict | None = None) -> tuple[int, dict]:
        req = urllib.request.Request(f"{self.base}/api/items/{rid}", method="PATCH", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def stored(self) -> dict:
        return json.loads((self.cfg.lessons_dir / "_data" / "items.json").read_text())

    def test_items_list_reports_and_tutor_lessons(self):
        items = self.items()
        tutor = items[f"/lessons/{SLUG}/"]
        self.assertEqual((tutor["origin"], tutor["slug"], tutor["title"], tutor["status"], tutor["tags"], tutor["key"]),
                         ("tutor", SLUG, "A lesson", "open", ["lesson"], f"tutor:{SLUG}"))
        self.assertEqual(tutor["id"], reports.review_id(f"tutor:{SLUG}"))
        marked = items[INPLACE_URL]
        self.assertEqual((marked["origin"], marked["tags"], marked["key"], marked["slug"], marked["status"]),
                         ("report", ["lesson"], "2026-03-04_how-it-works", reports.inplace_slug(INPLACE_URL), "open"))
        plain = items["/documents/area/plain.html"]
        self.assertEqual((plain["origin"], plain["tags"], plain["status"], plain["slug"], plain["root"], plain["area"]),
                         ("report", [], "open", None, "documents", "area"))
        for field in ("id", "key", "url", "title", "path", "mtime", "root", "area", "status", "tags", "projects",
                      "topic", "summary", "sessions", "origin", "created", "changed"):
            self.assertIn(field, plain, field)
        self.assertIn("/code/org/repo/sync/plan.html", items)
        changed = [i["changed"] for i in json.loads(self.get("/api/items")[1])["items"]]
        self.assertEqual(changed, sorted(changed, reverse=True))  # newest change first

    def test_old_list_routes_removed(self):
        self.assertEqual(self.get("/api/lessons")[0], 404)
        self.assertEqual(self.get("/api/pages")[0], 404)
        body = json.dumps({"url": "/documents/area/plain.html", "kind": "lesson"}).encode()
        self.assertEqual(self.get("/api/pages/kind", body, {"Content-Type": "application/json"})[0], 404)
        self.assertEqual(self.get(f"/api/lessons/{SLUG}/opened", b"{}", {"Content-Type": "application/json"})[0], 404)
        self.assertNotIn("lesson", reports.page_kind((self.home / "docs" / "area" / "plain.html").read_text()))

    def test_older_stores_read_as_a_fallback_and_never_written(self):
        data = self.cfg.lessons_dir / "_data"
        data.mkdir(parents=True, exist_ok=True)
        old = {INPLACE_URL: {"status": "understood", "tags": ["Lesson", "Deep  Dive"], "title": "Own"},
               "/documents/area/plain.html": {"status": "archived", "tags": ["old"]}}
        raw = json.dumps(old, indent=2).encode()
        (data / "pages.json").write_bytes(raw)
        lesson_raw = json.dumps({"title": "A lesson", "status": "learning", "tags": ["sql"], "projects": []})
        (self.cfg.lessons_dir / SLUG / "lesson.json").write_text(lesson_raw)
        items = self.items()
        self.assertEqual((items[INPLACE_URL]["status"], items[INPLACE_URL]["title"]), ("done", "Own"))  # URL -> the page
        self.assertEqual(sorted(items[INPLACE_URL]["tags"]), ["deep dive", "lesson"])  # lesson is the file's marker
        self.assertEqual((items["/documents/area/plain.html"]["status"], items["/documents/area/plain.html"]["tags"]),
                         ("archived", ["old"]))
        self.assertEqual((items[f"/lessons/{SLUG}/"]["status"], items[f"/lessons/{SLUG}/"]["tags"]), ("open", ["sql", "lesson"]))
        self.assertFalse((data / "items.json").exists())  # reading writes nothing
        # a PATCH stores only what it sets; the other fields still come from the older store
        status, r = self.patch(items["/documents/area/plain.html"]["id"], {"tags": ["new"]})
        self.assertEqual((status, r["status"], r["tags"]), (200, "archived", ["new"]))
        self.assertEqual(set(self.stored()), {"/documents/area/plain.html"})
        self.assertEqual((data / "pages.json").read_bytes(), raw)
        self.assertEqual((self.cfg.lessons_dir / SLUG / "lesson.json").read_text(), lesson_raw)

    def test_start_writes_no_items_json(self):
        data = self.cfg.lessons_dir / "_data"
        data.mkdir(parents=True, exist_ok=True)
        (data / "pages.json").write_text(json.dumps({"/documents/area/plain.html": {"status": "done"}}))
        srv, _ = app.build(self.cfg, "127.0.0.1", 0)
        srv.server_close()
        self.items()
        self.assertFalse((data / "items.json").exists())

    def tutor_item(self) -> dict:
        return self.items()[f"/lessons/{SLUG}/"]

    def write_lesson_json(self, meta: dict, ahead: float = 5) -> None:
        """lesson.json as the tutor skill writes it, its mtime `ahead` seconds from now."""
        path = self.cfg.lessons_dir / SLUG / "lesson.json"
        path.write_text(json.dumps(meta))
        t = time.time() + ahead
        os.utime(path, (t, t))

    def test_tutor_edit_of_lesson_json_after_start_wins(self):
        self.write_lesson_json({"title": "A lesson", "status": "learning", "tags": ["sql"]}, ahead=-100)
        self.assertEqual(self.tutor_item()["status"], "open")
        self.write_lesson_json({"title": "Renamed", "status": "understood", "tags": ["sql"], "summary": "S"})
        item = self.tutor_item()
        self.assertEqual((item["status"], item["title"], item["summary"]), ("done", "Renamed", "S"))

    def test_lesson_json_newer_than_a_patch_wins_for_the_fields_it_changed(self):
        self.write_lesson_json({"title": "A lesson", "status": "learning", "tags": ["sql"]}, ahead=-100)
        status, r = self.patch(self.tutor_item()["id"], {"status": "archived", "tags": ["mine"]})
        self.assertEqual((status, r["status"], r["tags"]), (200, "archived", ["mine", "lesson"]))
        self.write_lesson_json({"title": "A lesson", "status": "understood", "tags": ["sql"]})  # the tutor: understood
        item = self.tutor_item()
        self.assertEqual((item["status"], item["tags"]), ("done", ["mine", "lesson"]))  # its unchanged tags do not undo the PATCH
        status, r = self.patch(item["id"], {"status": "open"})
        self.assertEqual((status, r["status"]), (200, "open"))  # a later PATCH wins again

    def backdate_store(self, key: str, ago: float) -> None:
        """Move the stored entry's `updated` stamp `ago` seconds into the past, as if that change were older."""
        path = self.cfg.lessons_dir / "_data" / "items.json"
        items = json.loads(path.read_text())
        items[key]["updated"] = time.time() - ago
        path.write_text(json.dumps(items))

    def test_a_later_patch_or_send_keeps_what_lesson_json_won(self):
        key = f"tutor:{SLUG}"
        self.write_lesson_json({"title": "A lesson", "status": "learning", "tags": ["sql"]}, ahead=-1000)
        self.assertEqual(self.patch(self.tutor_item()["id"], {"status": "archived", "tags": ["mine"]})[0], 200)
        self.backdate_store(key, 500)
        self.write_lesson_json({"title": "A lesson", "status": "done", "tags": ["sql"]}, ahead=-400)  # the tutor: done
        item = self.tutor_item()
        self.assertEqual((item["status"], item["tags"]), ("done", ["mine", "lesson"]))
        status, r = self.patch(item["id"], {"tags": ["mine", "two"]})  # Sylvain edits only the tags
        self.assertEqual((status, r["status"], r["tags"]), (200, "done", ["mine", "two", "lesson"]))
        self.assertEqual(self.tutor_item()["status"], "done")
        self.backdate_store(key, 300)
        self.write_lesson_json({"title": "A lesson", "status": "done", "tags": ["sql", "joins"]}, ahead=-200)
        self.assertEqual(self.tutor_item()["tags"], ["sql", "joins", "lesson"])  # the tutor's new tags win
        library.mark_sent(key)
        item = self.tutor_item()
        self.assertEqual((item["status"], item["tags"]), ("sent", ["sql", "joins", "lesson"]))  # the send keeps them
        self.backdate_store(key, 100)
        self.write_lesson_json({"title": "A lesson", "status": "done", "tags": ["sql", "joins"]}, ahead=-50)
        self.assertEqual(self.tutor_item()["status"], "sent")  # lesson.json rewritten unchanged undoes nothing

    def test_copy_of_a_tutor_lesson_under_a_root_is_its_own_page(self):
        lesson = self.cfg.lessons_dir / SLUG / "index.html"
        lesson.write_text(LESSON_PAGE.replace("2026-03-04_how-it-works", SLUG))  # data-doc-id = the slug, as lessons.py stamps it
        copy = self.home / "docs" / "area" / "copy.html"
        self.write_page("area/copy.html", lesson.read_text())
        before = copy.read_text()
        items = self.items()
        tutor, twin = items[f"/lessons/{SLUG}/"], items["/documents/area/copy.html"]
        self.assertNotEqual(tutor["id"], twin["id"])
        self.assertEqual(twin["shared"], [])
        status, r = self.patch(tutor["id"], {"status": "done", "tags": ["x"]})
        self.assertEqual((status, r["origin"], r["status"]), (200, "tutor", "done"))
        self.assertEqual(copy.read_text(), before)  # the copy keeps its marker
        items = self.items()
        self.assertEqual((items["/documents/area/copy.html"]["status"], items["/documents/area/copy.html"]["tags"]),
                         ("open", ["lesson"]))
        # the tutor lesson's review sync is keyed by its slug, untouched by the copy
        self.assertEqual(self.post(f"/api/lessons/{SLUG}/review", {"data": {"notes": "n"}})[0], 200)
        self.assertEqual(json.loads(self.get(f"/api/lessons/{SLUG}/review")[1])["data"], {"notes": "n"})

    def test_status_and_tags_survive_a_move(self):
        self.write_page("area/ided.html", REVIEW_PAGE.format(id="moving"))
        item = self.items()["/documents/area/ided.html"]
        status, r = self.patch(item["id"], {"status": "done", "tags": ["Budget", " Q4  plan ", "budget", ""]})
        self.assertEqual(status, 200, r)
        self.assertEqual((r["status"], r["tags"]), ("done", ["budget", "q4 plan"]))
        (self.home / "docs" / "area" / "ided.html").rename(self.home / "docs" / "area" / "reports" / "ided.html")
        self.index.scan()
        moved = self.items()["/documents/area/reports/ided.html"]
        self.assertEqual((moved["id"], moved["status"], moved["tags"]), (item["id"], "done", ["budget", "q4 plan"]))
        self.assertEqual(self.stored()["moving"]["status"], "done")

    def test_sent_goes_back_to_open_when_the_page_changes(self):
        self.write_page("area/ided.html", REVIEW_PAGE.format(id="sent-one"))
        self.write_page("area/other-ided.html", REVIEW_PAGE.format(id="sent-two"))
        page = self.home / "docs" / "area" / "ided.html"
        library.mark_sent("sent-one", at=page.stat().st_mtime - 100)  # the agent rewrote the page after the send
        library.mark_sent("sent-two")
        items = self.items()
        self.assertEqual(items["/documents/area/ided.html"]["status"], "open")
        self.assertEqual(items["/documents/area/other-ided.html"]["status"], "sent")
        self.assertEqual(self.stored()["sent-one"]["status"], "sent")  # worked out on reading, not written
        self.assertEqual(self.stored()["sent-two"]["status"], "sent")
        rid = items["/documents/area/ided.html"]["id"]
        self.assertEqual(self.patch(rid, {"tags": ["x"]})[1]["status"], "open")

    def test_lesson_tag_toggles_the_marker(self):
        page = self.home / "docs" / "area" / "plain.html"
        mtime = page.stat().st_mtime_ns
        item = self.items()["/documents/area/plain.html"]
        status, r = self.patch(item["id"], {"tags": ["Lesson", "x"]})
        self.assertEqual(status, 200, r)
        self.assertIn('<meta charset="utf-8">\n' + MARKER + "\n<title>", page.read_text())
        self.assertEqual(page.stat().st_mtime_ns, mtime)  # the page keeps its date
        self.assertEqual((sorted(r["tags"]), r["slug"]), (["lesson", "x"], reports.inplace_slug("/documents/area/plain.html")))
        self.assertEqual(self.stored()["/documents/area/plain.html"]["tags"], ["x"])  # lesson lives in the file
        status, r = self.patch(item["id"], {"tags": ["x"]})
        self.assertEqual((status, r["tags"], r["slug"]), (200, ["x"], None))
        self.assertEqual(page.read_text(), PLAIN_PAGE)
        self.write_page("area/nohead.html", "<title>No head</title><p>text</p>")
        rid = self.items()["/documents/area/nohead.html"]["id"]
        self.assertEqual(self.patch(rid, {"tags": ["lesson"]})[0], 400)
        self.assertEqual((self.home / "docs" / "area" / "nohead.html").read_text(), "<title>No head</title><p>text</p>")

    def test_tutor_lesson_keeps_lesson_tag_and_lesson_json(self):
        before = (self.cfg.lessons_dir / SLUG / "lesson.json").read_text()
        rid = self.items()[f"/lessons/{SLUG}/"]["id"]
        status, r = self.patch(rid, {"status": "archived", "tags": ["sql"], "topic": "Databases"})
        self.assertEqual(status, 200, r)
        self.assertEqual((r["status"], r["tags"], r["topic"]), ("archived", ["sql", "lesson"], "Databases"))
        self.assertEqual((self.cfg.lessons_dir / SLUG / "lesson.json").read_text(), before)
        self.assertEqual(self.items()[f"/lessons/{SLUG}/"]["status"], "archived")

    def test_patch_refused(self):
        rid = self.items()["/documents/area/plain.html"]["id"]
        for body in ({"status": "learning"}, {"status": "sent"}, {"status": "later"}, {"kind": "lesson"},
                     {"tags": "x"}, {"projects": ["no-such-project"]}, {"topic": 3}):
            with self.subTest(body=body):
                self.assertEqual(self.patch(rid, body)[0], 400)
        self.assertEqual(self.patch("r0000000000000000", {"status": "done"})[0], 404)
        self.assertEqual(self.patch(rid, {"status": "done"}, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.items()["/documents/area/plain.html"]["status"], "open")

    def patch_many(self, body: dict, headers: dict | None = None) -> tuple[int, dict]:
        req = urllib.request.Request(f"{self.base}/api/items", method="PATCH", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def test_patch_many(self):
        self.write_page("area/twin-a.html", REVIEW_PAGE.format(id="twin"))
        self.write_page("area/reports/twin-b.html", REVIEW_PAGE.format(id="twin"))
        items = self.items()
        ids = [items[u]["id"] for u in ("/documents/area/plain.html", INPLACE_URL, f"/lessons/{SLUG}/")]
        writes = mock.patch.object(library, "_write_json", wraps=library._write_json)
        with writes as w:
            status, r = self.patch_many({"ids": ids, "status": "done"})
        self.assertEqual(status, 200, r)
        self.assertEqual(w.call_count, 1)  # one write for the whole selection
        self.assertEqual([i["status"] for i in r["items"]], ["done"] * 3)
        self.assertEqual({i["id"] for i in r["items"]}, set(ids))
        items = self.items()
        self.assertEqual([items[u]["status"] for u in ("/documents/area/plain.html", INPLACE_URL, f"/lessons/{SLUG}/")],
                         ["done"] * 3)
        before = self.stored()
        twin = items["/documents/area/twin-a.html"]["id"]
        for body, code in (({"ids": ids, "status": "sent"}, 400), ({"ids": ids, "status": "later"}, 400),
                           ({"ids": [], "status": "open"}, 400), ({"ids": "x", "status": "open"}, 400),
                           ({"ids": ids, "status": "open", "tags": []}, 400), ({"ids": ids}, 400),
                           ({"ids": [*ids, "r0000000000000000"], "status": "open"}, 404),
                           ({"ids": [*ids, twin], "status": "open"}, 409)):
            with self.subTest(body=body):
                self.assertEqual(self.patch_many(body)[0], code)
                self.assertEqual(self.stored(), before)  # all or nothing
        self.assertEqual(self.patch_many({"ids": ids, "status": "open"}, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.stored(), before)

    def test_app_and_health(self):
        self.assertIn(self.get("/")[0], (200, 503))  # 503 until apps/ui is built
        self.assertEqual(json.loads(self.get("/healthz")[1]), {"ok": True})

    def head_etag(self, path: str) -> str:
        req = urllib.request.Request(self.base + path)
        with urllib.request.urlopen(req) as r:
            r.read()
            return r.headers.get("ETag", "")

    def test_revalidation_answers_304(self):
        # A reopened page on a slow line costs one round trip instead of the whole page and template again.
        for path in ("/_template/report.css", "/documents/area/reports/page.html",
                     "/documents/area/reports/figures/chart.png", "/"):
            with self.subTest(path=path):
                etag = self.head_etag(path)
                self.assertTrue(etag, "no ETag")
                status, body, _ = self.get(path, headers={"If-None-Match": etag})
                self.assertEqual(status, 304)
                self.assertEqual(body, b"")
                self.assertEqual(self.get(path, headers={"If-None-Match": '"other"'})[0], 200)

    def test_changed_page_gets_new_etag(self):
        path = "/documents/area/plain.html"
        before = self.head_etag(path)
        (self.home / "docs" / "area" / "plain.html").write_text(PLAIN_PAGE.replace("Answer.", "Revised answer."))
        self.assertNotEqual(self.head_etag(path), before)
        self.assertEqual(self.get(path, headers={"If-None-Match": before})[0], 200)


if __name__ == "__main__":
    unittest.main()

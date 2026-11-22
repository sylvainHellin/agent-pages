"""agent-pages serve: one HTTP server (stdlib ThreadingHTTPServer) for the report pages, the lessons and the library app.

  GET  /                         the library app (apps/ui/dist, built with pnpm in apps/ui): lessons and report pages
  GET  /<root>/<path>            a report page under a configured root, file:// links rewritten; only indexed
                                 pages and the files they reference are served (reports.py). A page with the
                                 review layer (report.js) gets review-sync.js and its stored review state in
                                 its head, so comments follow the reader between devices (review_boot)
  GET  /_template/<path>         the repo template (report.css, report.js, themes, fonts, favicons); folders the
                                 config lists in template_aliases, and /lessons/_assets/, map to it too
  GET  /favicon.ico, /favicon.png, /apple-touch-icon.png   the template's icons
  GET  /api/items[?project=x]    every page in one list, newest change first: the pages under the roots and the tutor
                                 lessons, each with id (its review id), key, url, title, path, mtime, root, area, status
                                 (open, sent, done, archived), tags ("lesson" for marked pages and tutor lessons),
                                 projects, topic, summary, sessions, origin ("report" or "tutor"), slug (lessons)
  PATCH /api/items/<id>          {status?, tags?, projects?, topic?, summary?, title?}: stored in _data/items.json; the
                                 lesson tag of a page under a root adds or removes the lesson marker in its file
  PATCH /api/items               {"ids": [...], "status": open|done|archived}: one status for several pages, all or
                                 none (404 for an unknown id, 409 for a shared data-doc-id), in one write
  GET  /index.json               the indexed pages without the lesson marker, newest first, for scripts
  GET  /api/pages/status?url=u   {"sha256" of the page file, "shared": other pages with its data-doc-id}: what
                                 `agent-pages open` waits for before it opens the server's copy
  GET/POST /api/reviews/<id>     answers, comments, notes of a report page (409 when its data-doc-id is shared)
  GET  /lessons/<slug>/...       a lesson page and its figures; /lessons/_assets/... shared CSS/JS
  GET  /api/projects             open projects and areas of the vault
  GET  /api/theme.css            the app theme's tokens, renamed --pg-*, for the app's own colours and fonts (theme.py)
  GET  /app/                     the same app for the phone Web Clip (same build, so old home-screen icons keep working)
  GET  /api/inbox                collected links + recent jobs
  POST /api/inbox                {"text": "<one or more links>", "note": "..."}  (also from an iOS Shortcut)
  DELETE /api/inbox/<id>
  POST /api/jobs                 {"items": [ids], "focus": "...", "project": "<id>", "search": true}: a lesson from links and/or a topic
  GET  /api/jobs/<id>/log        tail of the agent's output
  POST /api/jobs/<id>/cancel
  POST /api/jobs/<id>/report     {"slug", "status": "done|failed", "note"}: from tutor-job-done (agent)
  POST /api/lessons/<slug>/feedback  {"markdown": review export}: a revise job for the lesson's agent
  GET/POST /api/lessons/<slug>/review  answers, comments, notes of a lesson, shared by the web library and the phone

Every URL the UI uses is relative, so the app works at the server root and behind a path prefix.
The settings come from the agent-pages config (host, port, roots, lessons_dir, vault, template_aliases).
The agent job runner is off (jobs.TUIOS) until it drives hc instead of tuios.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import re
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

from .. import REPO, TEMPLATE_DIR
from ..config import Config, ConfigError
from . import jobs, library
from .theme import app_theme_css
from .reports import ASSET_EXT, PAGE_EXT, Index, Site, hidden, page_kind

UI = REPO / "apps" / "ui" / "dist"  # one Vite build (base './') served at / and at /app/
ROOT_ICONS = {"/favicon.ico", "/favicon.png", "/apple-touch-icon.png"}  # from the template, for every page
RESERVED = {"api", "app", "assets", "lessons", "_template", "healthz", "index.json", "index.html"}
IMMUTABLE = "public, max-age=31536000, immutable"  # Vite's content-hashed files under assets/
REVIEW_JS = "/_template/review-sync.js"
HEAD_RE = re.compile(r"<head(?:\s[^>]*)?>", re.I)
CHARSET_RE = re.compile(r"<meta\b[^>]*\bcharset\b[^>]*>", re.I)


def inject_boot(text: str, boot: dict) -> str:
    """The page with review-sync.js and its TutorSync.page() call at the top of its head (after <meta charset>),
    so they run before report.js reads localStorage."""
    arg = (json.dumps(boot, ensure_ascii=False).replace("</", "<\\/").replace("<!--", "<\\!--")
           .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))
    snippet = f'\n<script src="{REVIEW_JS}"></script>\n<script>TutorSync.page({arg});</script>'
    head = HEAD_RE.search(text)
    if head is None:
        return snippet.lstrip() + "\n" + text
    charset = CHARSET_RE.search(text, head.end(), head.end() + 2000)
    at = (charset or head).end()
    return text[:at] + snippet + text[at:]
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("video/mp4", ".mp4")
mimetypes.add_type("video/webm", ".webm")
mimetypes.add_type("image/webp", ".webp")


class Handler(BaseHTTPRequestHandler):
    server_version = "agent-pages/1"
    site: Site
    index: Index
    theme: Path | None = None  # the app theme's stylesheet
    theme_name: str = ""

    def log_message(self, fmt, *args):  # quieter journal: only errors and mutations
        if self.command != "GET" or (args and str(args[1])[:1] in "45"):
            super().log_message(fmt, *args)

    # ---- helpers ----
    def _json(self, obj, status=HTTPStatus.OK):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _file(self, path: Path, base: Path, cache: str = "no-cache"):
        try:
            path = path.resolve()
            path.relative_to(base.resolve())
        except (OSError, ValueError):
            return self.send_error(HTTPStatus.NOT_FOUND)
        if path.is_dir():
            if not self.path.split("?", 1)[0].endswith("/"):
                self.send_response(HTTPStatus.MOVED_PERMANENTLY)
                self.send_header("Location", self.path.split("?", 1)[0].rsplit("/", 1)[-1] + "/")
                self.end_headers()
                return
            path = path / "index.html"
        if not path.is_file():
            return self.send_error(HTTPStatus.NOT_FOUND)
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith(("javascript", "json", "svg+xml")):
            ctype += "; charset=utf-8"
        st = path.stat()
        size = st.st_size
        etag = f'"{size:x}-{st.st_mtime_ns:x}"'
        if self._not_modified(etag, cache):
            return
        start, end = 0, size - 1
        rng = re.fullmatch(r"bytes=(\d*)-(\d*)", (self.headers.get("Range") or "").strip())
        if rng and size:  # iOS Safari only plays <video> from servers that answer byte ranges
            a, b = rng.groups()
            if a:
                start, end = int(a), min(int(b) if b else size - 1, size - 1)
            elif b:
                start = max(size - int(b), 0)
            if start > end or start >= size:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", cache)  # no-cache by default: lessons are revised in place
        self.end_headers()
        if self.command == "HEAD":
            return
        with path.open("rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(left, 1 << 20))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def _not_modified(self, etag: str, cache: str) -> bool:
        """Answer 304 when the client's copy is current: a revalidation then costs a round trip, not the file."""
        tags = [t.strip() for t in (self.headers.get("If-None-Match") or "").split(",")]
        if etag not in tags and f"W/{etag}" not in tags:
            return False
        self.send_response(HTTPStatus.NOT_MODIFIED)
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", cache)
        self.end_headers()
        return True

    def _send(self, body: bytes, ctype: str, cache: str = "no-cache"):
        etag = '"%s"' % hashlib.sha1(body).hexdigest()[:20]
        if self._not_modified(etag, cache):
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _template(self, rel: str):
        """An asset of the repo template (stylesheets, scripts, fonts, icons); pages and build scripts stay private."""
        parts = Path(rel).parts
        if not rel or ".." in parts or hidden(parts) or Path(rel).suffix.lower() not in ASSET_EXT:
            return self.send_error(HTTPStatus.NOT_FOUND)
        return self._file(TEMPLATE_DIR / rel, TEMPLATE_DIR)

    def _report(self, name: str, rest: str):
        """A page or asset under a root: only what the index allows; pages get their file:// links rewritten."""
        rel = Path(rest)
        if not rest or ".." in rel.parts or hidden(rel.parts):
            return self.send_error(HTTPStatus.NOT_FOUND)
        target = self.site.roots[name] / rel
        t = self.site.template_file(target)
        if t is not None:  # an old template folder under a root, linked by a relative path
            return self._template(t.relative_to(TEMPLATE_DIR).as_posix())
        try:
            real = target.resolve()
        except OSError:
            return self.send_error(HTTPStatus.NOT_FOUND)
        ext = real.suffix.lower()
        if ext not in PAGE_EXT | ASSET_EXT or not real.is_file() or not self.index.is_allowed(real):
            return self.send_error(HTTPStatus.NOT_FOUND)
        if ext in PAGE_EXT:
            return self._page(real, rewrite=True)
        return self._file(real, real.parent)

    def _page(self, real: Path, rewrite: bool):
        """An HTML page with its review boot (and, under a root, its file:// links rewritten)."""
        try:
            text = real.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return self.send_error(HTTPStatus.NOT_FOUND)
        if rewrite:
            text = self.site.rewrite(text)
        boot = self.review_boot(real, text)
        if boot is not None:
            text = inject_boot(text, boot)
        return self._send(text.encode("utf-8"), "text/html; charset=utf-8")

    def _lesson_slug(self, real: Path) -> str | None:
        """The slug of a tutor lesson's page (<lessons>/<slug>/index.html), else None."""
        try:
            rel = real.relative_to(library.LESSONS.resolve())
        except (OSError, ValueError):
            return None
        if len(rel.parts) == 2 and rel.name == "index.html" and library.page_file(rel.parts[0]) is not None:
            return rel.parts[0]
        return None

    def review_boot(self, real: Path, text: str) -> dict | None:
        """Where the page's review state lives and what it is now, for TutorSync.page(); None without report.js."""
        if "report.js" not in text:
            return None
        slug = self._lesson_slug(real)
        if slug is None and page_kind(text) == "lesson":
            slug = next((s for s, e in self.index.inplace_lessons().items() if e["file"] == real), None)
        if slug is not None:
            try:
                state = jobs.get_review(slug)
            except KeyError:
                return None
            return {"api": "/api/", "path": f"lessons/{quote(slug)}/review", "lesson": True, "shared": [], "state": state}
        r = self.index.review_of(real)
        if r is None:
            return None
        state = None if r["shared"] else jobs.get_page_review(r["id"])
        return {"api": "/api/", "path": f"reviews/{r['id']}", "lesson": False, "shared": r["shared"], "state": state}

    def _page_status(self, url: str):
        """The version of a page the server would serve, for `agent-pages open`."""
        if url.startswith("/lessons/"):  # /lessons/<slug>/ or /lessons/<slug>/index.html
            parts = url[len("/lessons/"):].strip("/").split("/")
            real = library.page_file(parts[0]) if parts[1:] in ([], ["index.html"]) else None
        else:
            found = self.index.page_file(url)
            real = found[0] if found else None
        if real is None:
            return self._json({"error": "no such page"}, HTTPStatus.NOT_FOUND)
        try:
            digest = hashlib.sha256(real.read_bytes()).hexdigest()
        except OSError:
            return self._json({"error": "no such page"}, HTTPStatus.NOT_FOUND)
        r = self.index.review_of(real.resolve())
        return self._json({"sha256": digest, "shared": r["shared"] if r else []})

    def _review(self, rid: str, data=None):
        """GET (data None) or POST a report's review record."""
        t = self.index.review_target(rid)
        if t is None:
            return self._json({"error": "no such page"}, HTTPStatus.NOT_FOUND)
        if len(t["urls"]) > 1:
            return self._json({"error": f"data-doc-id {t['key']!r} is used by several pages: {', '.join(t['urls'])}",
                               "urls": t["urls"]}, HTTPStatus.CONFLICT)
        if data is None:
            return self._json(jobs.get_page_review(rid))
        try:
            return self._json(jobs.put_page_review(rid, data, t["key"], t["urls"]))
        except jobs.JobError as e:
            return self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)

    def _ui(self, rel: str):
        """A file of the built app; rel '' is its index.html (always revalidated, it names the hashed assets)."""
        index = UI / "index.html"
        if not index.is_file():
            body = b"The library app is not built: run pnpm install, then pnpm build, in apps/ui\n"
            self.send_response(HTTPStatus.SERVICE_UNAVAILABLE)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        if rel in ("", "index.html"):
            return self._file(index, UI)
        return self._file(UI / rel, UI, IMMUTABLE if rel.startswith("assets/") else "no-cache")

    def _same_origin(self) -> bool:
        """Mutations only from a page this server (or the tailscale proxy in front of it) served."""
        origin = self.headers.get("Origin")
        if not origin:
            return True  # curl / scripts on the tailnet
        host = urlsplit(origin).netloc
        allowed = {self.headers.get("Host"), self.headers.get("X-Forwarded-Host")}
        return host in allowed

    def _body(self, limit: int = 64_000) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise library.MetaError("body too large")
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError as e:
            raise library.MetaError(f"bad JSON: {e}") from e

    # ---- routes ----
    def do_GET(self):
        url = urlsplit(self.path)
        p = unquote(url.path)
        if p == "/api/items":
            items = library.list_items()
            proj = parse_qs(url.query).get("project", [None])[0]
            if proj:
                items = [m for m in items if proj in m["projects"]]
            return self._json({"items": items})
        if p == "/api/projects":
            return self._json({"projects": library.registry_projects()})
        if p == "/api/theme.css":
            if self.theme is None:
                return self.send_error(HTTPStatus.NOT_FOUND)
            return self._send(app_theme_css(self.theme, self.theme_name).encode("utf-8"), "text/css; charset=utf-8")
        if p == "/index.json":  # report-web's page list, kept for scripts that read it
            return self._json(self.index.snapshot()["pages"])
        if p == "/api/pages/status":
            return self._page_status(parse_qs(url.query).get("url", [""])[0])
        if p.startswith("/api/reviews/"):
            return self._review(p[len("/api/reviews/"):].strip("/"))
        if p.startswith("/_template/"):
            return self._template(p[len("/_template/"):])
        if p in ROOT_ICONS:
            return self._template(p.lstrip("/"))
        if p.startswith("/lessons/"):  # no . or .. segment, no dot file or folder (hidden()) in the request
            segs = [s for s in p[len("/lessons/"):].split("/") if s]
            if ".." in segs or hidden(segs):
                return self.send_error(HTTPStatus.NOT_FOUND)
        if p.startswith("/lessons/_assets/"):
            return self._file(library.ASSETS / p[len("/lessons/_assets/"):], library.ASSETS)
        if p.startswith("/lessons/_data/") or p == "/lessons/_data":
            return self.send_error(HTTPStatus.NOT_FOUND)  # server state, read through the API only
        if p.startswith("/lessons/page-"):  # an in-place lesson: its page lives where it was written
            e = self.index.inplace_lessons().get(p[len("/lessons/"):].strip("/").split("/")[0])
            if e is None:
                return self.send_error(HTTPStatus.NOT_FOUND)
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", e["url"])
            return self.end_headers()
        if p.startswith("/lessons/"):
            target = library.LESSONS / p[len("/lessons/"):]
            if p.endswith("/"):
                target = target / "index.html"
            try:
                real = target.resolve()
                rel = real.relative_to(library.LESSONS.resolve()).parts
            except (OSError, ValueError):
                return self.send_error(HTTPStatus.NOT_FOUND)
            if hidden(rel) or "_data" in rel:  # judged on the file a symlink leads to, as servable() does
                return self.send_error(HTTPStatus.NOT_FOUND)
            if real.is_file() and self._lesson_slug(real) is not None:
                return self._page(real, rewrite=False)
            return self._file(library.LESSONS / p[len("/lessons/"):], library.LESSONS)
        if p == "/lessons":
            self.send_response(HTTPStatus.MOVED_PERMANENTLY)
            self.send_header("Location", "lessons/")
            return self.end_headers()
        if p in ("/", "/index.html"):
            return self._ui("")
        if p == "/app":
            self.send_response(HTTPStatus.MOVED_PERMANENTLY)
            self.send_header("Location", "app/")
            return self.end_headers()
        if p.startswith("/app/"):
            return self._ui(p[len("/app/"):])
        if p == "/api/inbox":
            return self._json({"items": jobs.inbox(), "jobs": jobs.list_jobs()})
        if p.startswith("/api/jobs/") and p.endswith("/log"):
            try:
                return self._json({"log": jobs.job_log(p.split("/")[3])})
            except KeyError:
                return self._json({"error": "no such job"}, HTTPStatus.NOT_FOUND)
        if p.startswith("/api/lessons/") and p.endswith("/review"):
            try:
                return self._json(jobs.get_review(p[len("/api/lessons/"):-len("/review")].strip("/")))
            except KeyError:
                return self._json({"error": "no such lesson"}, HTTPStatus.NOT_FOUND)
        if p == "/healthz":
            return self._json({"ok": True})
        name, _, rest = p.lstrip("/").partition("/")
        if name in self.site.roots and name not in RESERVED:
            if not rest and not p.endswith("/"):
                return self.send_error(HTTPStatus.NOT_FOUND)
            return self._report(name, rest)
        if not p.startswith("/api/") and (p.startswith("/assets/") or (UI / p.lstrip("/")).is_file()):
            return self._ui(p.lstrip("/"))  # assets/, icons, manifest, reader.css
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_HEAD(self):  # same routes as GET (the base class would serve the working directory)
        self.do_GET()

    def do_PATCH(self):
        p = unquote(urlsplit(self.path).path)
        if p != "/api/items" and not p.startswith("/api/items/"):
            return self.send_error(HTTPStatus.NOT_FOUND)
        if not self._same_origin():
            return self._json({"error": "cross-origin request refused"}, HTTPStatus.FORBIDDEN)
        rid = p[len("/api/items/"):].strip("/")
        try:
            if not rid:
                return self._json({"items": library.update_items(self._body())})
            return self._json(library.update_item(rid, self._body()))
        except KeyError as e:
            return self._json({"error": f"no such page: {e.args[0]}" if e.args else "no such page"}, HTTPStatus.NOT_FOUND)
        except library.SharedKey as e:
            return self._json({"error": str(e)}, HTTPStatus.CONFLICT)
        except library.MetaError as e:
            return self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        except OSError as e:
            return self._json({"error": f"could not write the page: {e.strerror or e}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self):
        p = unquote(urlsplit(self.path).path)
        if p.startswith("/api/lessons/") and p.endswith("/feedback"):
            # the lesson page's review export (answers, comments, notes) -> a revise job for the agent
            if not self._same_origin():
                return self._json({"error": "cross-origin request refused"}, HTTPStatus.FORBIDDEN)
            slug = p[len("/api/lessons/"):-len("/feedback")].strip("/")
            try:
                return self._json(jobs.create_revision(slug, str(self._body(600_000).get("markdown") or "")))
            except KeyError:
                return self._json({"error": f"no lesson {slug}"}, HTTPStatus.NOT_FOUND)
            except (jobs.JobError, library.MetaError) as e:
                return self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        if p.startswith("/api/reviews/"):
            if not self._same_origin():
                return self._json({"error": "cross-origin request refused"}, HTTPStatus.FORBIDDEN)
            try:
                data = self._body(2_000_000).get("data")
            except library.MetaError as e:
                return self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
            return self._review(p[len("/api/reviews/"):].strip("/"), data if data is not None else "")
        if p.startswith("/api/lessons/") and p.endswith("/review"):
            if not self._same_origin():
                return self._json({"error": "cross-origin request refused"}, HTTPStatus.FORBIDDEN)
            try:
                return self._json(jobs.put_review(p[len("/api/lessons/"):-len("/review")].strip("/"), self._body(2_000_000).get("data")))
            except KeyError:
                return self._json({"error": "no such lesson"}, HTTPStatus.NOT_FOUND)
            except (jobs.JobError, library.MetaError) as e:
                return self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        if p.startswith("/api/jobs/") and p.endswith("/report"):
            # tutor-job-done, run by the agent on this machine
            if self.headers.get("Origin"):
                return self._json({"error": "agents report without a browser"}, HTTPStatus.FORBIDDEN)
            try:
                b = self._body()
                return self._json(jobs.report(p.split("/")[3], str(b.get("slug") or ""),
                                              str(b.get("status") or "done"), str(b.get("note") or "")))
            except KeyError:
                return self._json({"error": "no such job"}, HTTPStatus.NOT_FOUND)
            except (jobs.JobError, library.MetaError) as e:
                return self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        if p in ("/api/inbox", "/api/jobs") or (p.startswith("/api/jobs/") and p.endswith("/cancel")):
            if not self._same_origin():
                return self._json({"error": "cross-origin request refused"}, HTTPStatus.FORBIDDEN)
            try:
                b = self._body()
                if p == "/api/inbox":
                    return self._json({"added": jobs.add_links(str(b.get("text") or b.get("url") or ""), str(b.get("note") or ""))})
                if p == "/api/jobs":
                    return self._json(jobs.create_job(b.get("items"), str(b.get("focus") or ""), str(b.get("project") or ""), b.get("search", True) is not False))
                return self._json(jobs.cancel_job(p.split("/")[3]))
            except KeyError:
                return self._json({"error": "no such job"}, HTTPStatus.NOT_FOUND)
            except (jobs.JobError, library.MetaError) as e:
                return self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        p = unquote(urlsplit(self.path).path)
        if not p.startswith("/api/inbox/"):
            return self.send_error(HTTPStatus.NOT_FOUND)
        if not self._same_origin():
            return self._json({"error": "cross-origin request refused"}, HTTPStatus.FORBIDDEN)
        try:
            jobs.remove_link(p[len("/api/inbox/"):].strip("/"))
            return self._json({"ok": True})
        except KeyError:
            return self._json({"error": "no such link"}, HTTPStatus.NOT_FOUND)


def build(cfg: Config, host: str | None = None, port: int | None = None) -> tuple[ThreadingHTTPServer, Index]:
    """The server for a config, its page index scanned once; serve_forever() runs it."""
    host = host or cfg.host
    port = cfg.port if port is None else port
    library.configure(cfg.lessons_dir, cfg.vault)
    jobs.configure(library.DATA, f"http://{host}:{port}")
    site = Site(cfg.roots, TEMPLATE_DIR, cfg.template_aliases, exclude=[cfg.lessons_dir])
    index = Index(site)
    index.scan()
    library.attach_pages(index)  # items.json is written by a PATCH only; pages.json and lesson.json are read as they are
    try:
        theme = cfg.theme_css(cfg.app_theme)
    except ConfigError as e:  # the app keeps its own look
        print(f"agent-pages serve: app theme: {e}", flush=True)
        theme = None
    handler = type("PagesHandler", (Handler,), {"site": site, "index": index, "theme": theme, "theme_name": cfg.app_theme})
    return ThreadingHTTPServer((host, port), handler), index


def serve(cfg: Config, args) -> None:
    srv, index = build(cfg, args.host, args.port)
    library.LESSONS.mkdir(parents=True, exist_ok=True)
    library.DATA.mkdir(parents=True, exist_ok=True)
    jobs.start()
    threading.Thread(target=index.loop, daemon=True, name="page-index").start()
    host, port = srv.server_address[:2]
    roots = ", ".join(f"{k}={v}" for k, v in cfg.roots.items()) or "none"
    print(f"agent-pages serve: http://{host}:{port}/  {len(index.pages)} report pages (roots: {roots})  "
          f"lessons: {library.LESSONS}  vault: {library.VAULT}", flush=True)
    srv.serve_forever()


def add_parser(sub) -> None:
    p = sub.add_parser("serve", help="run the server: report pages, lessons and the library app")
    p.add_argument("--host", help="listen address (default: the config's host)")
    p.add_argument("--port", type=int, help="port (default: the config's port)")
    p.set_defaults(fn=serve)

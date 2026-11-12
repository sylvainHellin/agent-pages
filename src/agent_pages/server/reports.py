"""Report pages: the index of every .html page under the configured roots, and the links between them.

Only indexed pages and the files they reference (stylesheets, scripts, images, fonts, linked PDFs) are
served from a root; the rest of the folder stays unreachable. Pages written on one machine link the
template and their neighbours by file:///Users/<name>/... or file:///home/<name>/... URLs; those are read
as paths under the local home, so a page written on either machine resolves on the other, and the server
rewrites them to its own URLs on the way out.

A page is a lesson when its head carries <meta name="agent-pages-kind" content="lesson"> (KIND_META), and a
report otherwise. The index lists reports in `pages` and keeps marked pages apart as in-place lessons, each
under the slug inplace_slug(url); the library (library.py) shows them next to the tutor's lessons.
set_kind() adds or removes the marker line in a page's text (POST /api/pages/kind).
"""

from __future__ import annotations

import hashlib
import html
import os
import re
import sys
import threading
import time
from pathlib import Path
from urllib.parse import quote, unquote

PAGE_EXT = {".html", ".htm"}
ASSET_EXT = {
    ".css", ".js", ".mjs", ".json", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".webm", ".pdf",
}
SKIP_DIRS = {"node_modules", "__pycache__", "site-packages", "venv", "_site", "dist"}
REPO_MIRRORS = {"sync", "agents"}  # a repo's .sync and .agents folders, mirrored under a root by Syncthing
REFRESH_S = 300  # background rescan interval
MISS_RESCAN_S = 10  # a 404 under a root triggers a rescan at most this often

REF_RE = re.compile(r"""(?:src|href|poster|data)\s*=\s*["']([^"'#?]+)""", re.I)
CSS_URL_RE = re.compile(r"""url\(\s*["']?([^"')#?]+)""", re.I)
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
KIND_META = '<meta name="agent-pages-kind" content="lesson">'
KIND_HEAD = 20_000  # the marker is read from the start of the file only
META_RE = re.compile(r"<meta\b[^>]*>", re.I)
ATTR_RE = re.compile(r"""([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""")
DOC_ID_RE = re.compile(r"""<html\b[^>]*?\bdata-doc-id\s*=\s*["']([^"']*)["']""", re.I)
INPLACE_PREFIX = "page-"
# A home folder in a file:// link: macOS /Users/<name>, Linux /home/<name>.
HOME_RE = re.compile(r"^/(?:Users|home)/[^/]+/")
# file:// URLs inside a page, up to the end of the attribute value (query and fragment excluded).
FILE_URL_RE = re.compile(r"""file://(/[^"'\s<>)?#]+)""")


def _attrs(tag: str) -> dict[str, str]:
    return {m.group(1).lower(): next(g for g in m.groups()[1:] if g is not None) for m in ATTR_RE.finditer(tag)}


def _is_kind_meta(tag: str) -> bool:
    return _attrs(tag).get("name", "").strip().lower() == "agent-pages-kind"


def page_kind(text: str) -> str:
    """'lesson' when the start of the page carries the marker with content lesson, else 'report'."""
    for m in META_RE.finditer(text[:KIND_HEAD]):
        a = _attrs(m.group(0))
        if a.get("name", "").strip().lower() == "agent-pages-kind":
            return "lesson" if a.get("content", "").strip().lower() == "lesson" else "report"
    return "report"


def set_kind(text: str, kind: str) -> str:
    """The page text with the marker line removed (report) or present once (lesson): right after
    <meta charset ...>, else right after <head>. ValueError when a lesson page has no head."""
    if kind not in ("lesson", "report"):
        raise ValueError("kind must be lesson or report")
    head = text[:KIND_HEAD]
    cut = [m for m in META_RE.finditer(head) if _is_kind_meta(m.group(0))]
    for m in reversed(cut):  # the tag and the line break after it, so no empty line is left
        end = m.end()
        if text[end:end + 2] == "\r\n":
            end += 2
        elif text[end:end + 1] == "\n":
            end += 1
        text = text[:m.start()] + text[end:]
    if kind == "report":
        return text
    head = text[:KIND_HEAD]
    charset = next((m for m in META_RE.finditer(head) if "charset" in _attrs(m.group(0))), None)
    anchor = charset or re.search(r"<head\b[^>]*>", head, re.I)
    if anchor is None:
        raise ValueError("the page has no <head>")
    nl = "\r\n" if "\r\n" in head else "\n"
    return text[:anchor.end()] + nl + KIND_META + text[anchor.end():]


def inplace_slug(url: str) -> str:
    """The lesson slug of a marked page: a fixed prefix and a short hash of its server URL. Tutor slugs
    start with a date, so the two never clash, and the slug is safe in #/l/<slug> and /api/lessons/<slug>."""
    return INPLACE_PREFIX + hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]


def hidden(parts) -> bool:
    return any(p.startswith(".") or p in SKIP_DIRS for p in parts)


def _under(path: Path, folder: Path) -> Path | None:
    """path relative to folder, or None; tries the path as given and resolved (symlinked roots)."""
    for p in (path, _resolve(path)):
        for f in (folder, _resolve(folder)):
            try:
                return p.relative_to(f)
            except ValueError:
                continue
    return None


def _resolve(p: Path) -> Path:
    try:
        return p.resolve()
    except OSError:
        return p


class Site:
    """What the server publishes: roots, the repo template and the folders that alias it."""

    def __init__(self, roots: dict[str, Path], template: Path, aliases: list[Path], home: Path | None = None,
                 exclude: list[Path] | None = None):
        self.roots = {name: Path(p) for name, p in roots.items()}
        self.template = Path(template)
        self.aliases = [Path(a) for a in aliases]
        self.home = Path(home or Path.home())
        self.exclude = [Path(e) for e in exclude or []]  # served but not listed (the lessons folder)

    def local_path(self, file_url_path: str) -> Path:
        """The local file for the path part of a file:// URL written on this or the other machine."""
        p = unquote(file_url_path)
        m = HOME_RE.match(p)
        if m:
            return self.home / p[m.end():]
        return Path(p)

    def template_file(self, path: Path) -> Path | None:
        """The repo template file that stands for a path in the template or in one of its aliases."""
        for folder in (self.template, *self.aliases):
            rel = _under(path, folder)
            if rel is not None and ".." not in rel.parts:
                return self.template / rel
        return None

    def url_for(self, path: Path) -> str | None:
        """Server URL path of a local file, or None when the server does not publish it."""
        t = self.template_file(path)
        if t is not None:
            return "/_template/" + quote(t.relative_to(self.template).as_posix())
        for name, root in self.roots.items():
            rel = _under(path, root)
            if rel is not None:
                return f"/{name}/" + quote(rel.as_posix())
        return None

    def rewrite(self, text: str) -> str:
        """Replace the file:// links of a page by server URLs where the server publishes the target."""
        def sub(m: re.Match) -> str:
            url = self.url_for(self.local_path(m.group(1)))
            return url if url is not None else m.group(0)
        return FILE_URL_RE.sub(sub, text)

    def target(self, ref: str, page_dir: Path) -> Path | None:
        """A src/href value of a page as a local path, or None for external and site-absolute links."""
        ref = ref.strip()
        if ref.lower().startswith("file://"):
            return self.local_path(ref[len("file://"):])
        ref = unquote(ref)
        if re.match(r"^[a-z][a-z0-9+.-]*:", ref, re.I) or ref.startswith("/"):
            return None
        return page_dir / ref

    def display(self, path: Path) -> str:
        try:
            return "~/" + path.relative_to(self.home).as_posix()
        except ValueError:
            return path.as_posix()

    def listed(self, path: Path) -> bool:
        return not any(_under(path, f) is not None for f in (*self.exclude, *self.aliases))


def area_of(root: str, rel: Path) -> str:
    """Group label for the app: the top folder under the root; for a repo's mirrored .sync or .agents
    folder (<org>/<repo>/sync/...), the folders before it, at most two."""
    parts = rel.parts[:-1]
    if not parts:
        return root
    for i, p in enumerate(parts[:3]):
        if p in REPO_MIRRORS and i:
            return "/".join(parts[:i])
    return parts[0]


class Index:
    def __init__(self, site: Site):
        self.site = site
        self.lock = threading.Lock()
        self.pages: list[dict] = []  # listed report pages, newest first
        self.lessons: dict[str, dict] = {}  # in-place lessons (marked pages) by slug, with their file
        self.allowed: set[Path] = set()  # resolved paths that may be served
        self.built = 0.0
        self.last_miss_scan = 0.0

    def scan(self) -> None:
        site = self.site
        pages, lessons, allowed = [], {}, set()
        for name, root in site.roots.items():
            if not root.is_dir():
                continue
            rroot = root.resolve()
            for dirpath, dirnames, filenames in os.walk(rroot):
                dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in SKIP_DIRS]
                for fn in filenames:
                    if Path(fn).suffix.lower() not in PAGE_EXT or fn.startswith((".", "~")) or ".sync-conflict-" in fn:
                        continue
                    p = Path(dirpath) / fn
                    try:
                        st = p.stat()
                        text = p.read_text(encoding="utf-8", errors="replace")
                    except OSError:
                        continue
                    real = p.resolve()
                    allowed.add(real)
                    for ref in REF_RE.findall(text):
                        self._allow_asset(site.target(ref, p.parent), allowed)
                    if not site.listed(real):
                        continue
                    m = TITLE_RE.search(text[:200_000])
                    title = html.unescape(re.sub(r"\s+", " ", m.group(1))).strip() if m else ""
                    try:
                        rel = real.relative_to(rroot)
                    except ValueError:
                        continue  # a file symlink out of the root: served if referenced, never listed
                    entry = {
                        "title": title or p.stem,
                        "url": f"/{name}/" + quote(rel.as_posix()),
                        "path": site.display(root / rel),
                        "mtime": st.st_mtime,
                        "root": name,
                        "area": area_of(name, rel),
                        "kind": page_kind(text),
                    }
                    if entry["kind"] == "lesson":
                        d = DOC_ID_RE.search(text[:KIND_HEAD])
                        slug = inplace_slug(entry["url"])
                        lessons[slug] = {**entry, "slug": slug, "file": real,
                                         "doc_id": html.unescape(d.group(1)) if d else None}
                    else:
                        pages.append(entry)
        pages.sort(key=lambda d: d["mtime"], reverse=True)
        with self.lock:
            self.pages, self.lessons, self.allowed, self.built = pages, lessons, allowed, time.time()

    def _allow_asset(self, target: Path | None, allowed: set, depth: int = 0) -> None:
        if target is None or target.suffix.lower() not in ASSET_EXT:
            return
        try:
            real = target.resolve()
            if real in allowed or not real.is_file():
                return
        except OSError:
            return
        if not any(_under(real, r) is not None for r in self.site.roots.values()):
            return  # the template and anything outside the roots has its own route or none
        allowed.add(real)
        if real.suffix.lower() == ".css" and depth < 3:
            try:
                css = real.read_text(encoding="utf-8", errors="replace")
            except OSError:
                return
            for ref in CSS_URL_RE.findall(css):
                self._allow_asset(self.site.target(ref, real.parent), allowed, depth + 1)

    def is_allowed(self, real: Path) -> bool:
        with self.lock:
            if real in self.allowed:
                return True
            stale = time.time() - self.last_miss_scan > MISS_RESCAN_S
            if stale:
                self.last_miss_scan = time.time()
        if stale:
            self.scan()
            with self.lock:
                return real in self.allowed
        return False

    def snapshot(self) -> dict:
        """The report pages (marked pages are lessons and listed by /api/lessons)."""
        with self.lock:
            return {"pages": list(self.pages), "built": self.built}

    def inplace_lessons(self) -> dict[str, dict]:
        with self.lock:
            return dict(self.lessons)

    def page_file(self, url: str) -> tuple[Path, str] | None:
        """The file behind a page's server URL and its root name, when the URL names a page that may be served
        under a root. None for anything else (no such root, '..', hidden folders, other file types)."""
        name, _, rest = unquote(url).lstrip("/").partition("/")
        root = self.site.roots.get(name)
        rel = Path(rest)
        if root is None or not rest or ".." in rel.parts or hidden(rel.parts) or rel.suffix.lower() not in PAGE_EXT:
            return None
        try:
            real = (root / rel).resolve()
        except OSError:
            return None
        if _under(real, root) is None or not real.is_file() or not self.is_allowed(real):
            return None
        return real, name

    def loop(self) -> None:
        while True:
            time.sleep(REFRESH_S)
            try:
                self.scan()
            except Exception as e:  # noqa: BLE001 - keep serving the last index
                print(f"agent-pages serve: rescan failed: {e}", file=sys.stderr, flush=True)

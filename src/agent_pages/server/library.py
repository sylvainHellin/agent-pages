"""The one list of pages: every page under the server's roots and every tutor lesson, each with one status and
general tags, plus the projects and areas of the Obsidian vault. No framework, stdlib + PyYAML.

Paths come from the config through configure():
  LESSONS  the lessons folder (lessons_dir)
  DATA     server state: review sync, inbox, jobs, items.json (<lessons>/_data)
  VAULT    the vault whose 01-projects/ and 02-areas/ notes are the projects (vault; None: no projects)

Where the pages come from:
  report pages  .html pages under the roots (reports.Index, handed over by attach_pages()); a page whose head carries
                the lesson marker has the tag "lesson", read from and written to the file, and is also an in-place
                lesson with slug page-<hash of the server URL> for its comment sync and revise jobs
  tutor lessons <lessons>/<YYYY-MM-DD_slug>/index.html with title, topic, summary and created in lesson.json; they
                always carry the tag "lesson"

What the reader sets lives in <lessons>/_data/items.json, keyed by the page's storage key (reports.review_key: its
data-doc-id, else its URL; a tutor lesson's slug): {status, tags, projects, topic, summary, title?, sent_at?, updated}.
A page that keeps its data-doc-id keeps its status and tags through a move. Statuses are open (the default), sent,
done and archived; a sent page whose file changed after sent_at is open again. items.json is built once from the
older stores (migrate_items): _data/pages.json, URL-keyed, and the statuses in lesson.json, which stay as they were.
"""

from __future__ import annotations

import html
import json
import re
import threading
import time
from pathlib import Path

import yaml

from .. import TEMPLATE_DIR
from . import reports

ASSETS = TEMPLATE_DIR  # shared page assets are code: the repo template, served at /lessons/_assets/
LESSONS = Path.home() / ".local/share/agent-pages/lessons"  # replaced by configure()
DATA = LESSONS / "_data"
VAULT: Path | None = None
PROJECT_DIRS = ("02-areas", "01-projects")
CLOSED = {"done", "archived", "completed", "cancelled", "dropped"}

SLUG_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]{0,80}$")
INPLACE_RE = re.compile(r"^page-[0-9a-f]{12}$")
DATE_PREFIX = re.compile(r"^(\d{4}-\d{2}-\d{2})")
PAGES_META = DATA / "pages.json"  # the older store of the marked pages, URL-keyed: read once by migrate_items()
ITEMS = DATA / "items.json"
STATUSES = ("open", "sent", "done", "archived")
SETTABLE = ("open", "done", "archived")  # sent is set by Send to agent (mark_sent), never by PATCH
OLD_STATUS = {"learning": "open", "understood": "done", "archived": "archived"}
EDITABLE = {"title", "topic", "summary", "projects", "tags", "status"}
LESSON_TAG = "lesson"

_lock = threading.RLock()
_pages = None  # the report page index (reports.Index)


def configure(lessons_dir: Path, vault: Path | None) -> None:
    """Point the library at the configured lessons folder and vault."""
    global LESSONS, DATA, VAULT, PAGES_META, ITEMS
    LESSONS = Path(lessons_dir)
    DATA = LESSONS / "_data"
    PAGES_META = DATA / "pages.json"
    ITEMS = DATA / "items.json"
    VAULT = Path(vault) if vault else None
    _reg_cache.update(key=None, projects=[])


def attach_pages(index) -> None:
    """The page index whose pages join the tutor lessons in the list (None: tutor lessons only)."""
    global _pages
    _pages = index


# ---------- registry ----------

def _clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[:n].rsplit(" ", 1)[0] + " …"


_reg_cache: dict = {"key": None, "projects": []}
_FRONT = re.compile(r"\A---\n(.*?)\n---\n?(.*)\Z", re.S)
_WIKI = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")


def _note_files() -> list[Path]:
    out = []
    if VAULT is None:
        return out
    for sub in PROJECT_DIRS:
        d = VAULT / sub
        if d.is_dir():
            out += sorted(d.glob("*.md"), key=lambda p: p.stem.lower())
    return out


def _first_line(body: str) -> str:
    """The note's first prose line after the title, wikilinks reduced to their label."""
    for line in body.splitlines():
        line = line.strip()
        if line and not line.startswith(("#", "!", "|", ">", "-", "```")):
            return _WIKI.sub(lambda m: m.group(2) or m.group(1), line)
    return ""


def registry_projects() -> list[dict]:
    """Open projects and areas from the vault (02-areas, then 01-projects), re-read when a note changes.
    The id is the note name, so a lesson links to [[<id>]] in Obsidian terms."""
    files = _note_files()
    key = tuple((p.name, p.stat().st_mtime) for p in files)
    if _reg_cache["key"] != key:
        out = []
        for f in files:
            m = _FRONT.match(f.read_text(errors="replace"))
            try:
                fm = (yaml.safe_load(m.group(1)) if m else None) or {}
            except yaml.YAMLError:
                fm = {}
            if not isinstance(fm, dict):
                fm = {}
            status = str(fm.get("status") or "").strip() or None
            if status and status.lower() in CLOSED:
                continue
            out.append({
                "id": f.stem,
                "status": status,
                "type": fm.get("type") or ("area" if f.parent.name == "02-areas" else "project"),
                "path": str(fm.get("repo") or "") or None,
                "note": str(f.relative_to(VAULT)),
                "notes": _clip(_first_line(m.group(2) if m else f.read_text(errors="replace")), 280),
            })
        _reg_cache.update(key=key, projects=out)
    return _reg_cache["projects"]


def project_ids() -> set[str]:
    return {p["id"] for p in registry_projects()}


# ---------- lessons (tutor and in-place), as the jobs and the review sync see them ----------

def _title_from_html(page: Path) -> str | None:
    try:
        m = re.search(r"<title>(.*?)</title>", page.read_text(errors="replace")[:4000], re.S)
    except OSError:
        return None
    return html.unescape(m.group(1).strip()) if m else None


def _count(page: Path) -> dict:
    try:
        text = page.read_text(errors="replace")
    except OSError:
        return {"sections": 0, "questions": 0, "figures": 0}
    main = text.split("<main", 1)[-1]
    return {
        "sections": len(re.findall(r"<h2[\s>]", main)),
        "questions": len(re.findall(r'data-type="(?:text|choice|multi)"', main)),
        "figures": len(re.findall(r"<figure[\s>]", main)),
    }


def _inplace(slug: str) -> dict | None:
    if not INPLACE_RE.match(slug) or _pages is None:
        return None
    return _pages.inplace_lessons().get(slug)


def page_file(slug: str) -> Path | None:
    """The HTML file of a lesson, tutor or in-place; None when there is no such lesson."""
    if INPLACE_RE.match(slug):
        e = _inplace(slug)
        return Path(e["file"]) if e and Path(e["file"]).is_file() else None
    page = LESSONS / slug / "index.html"
    return page if SLUG_RE.match(slug) and page.is_file() else None


def _lesson_json(slug: str) -> dict:
    try:
        meta = json.loads((LESSONS / slug / "lesson.json").read_text())
    except (OSError, ValueError):
        return {}
    return meta if isinstance(meta, dict) else {}


def read_meta(slug: str) -> dict | None:
    """A lesson's slug and title (what the jobs and the review sync need), None when there is no such lesson."""
    page = page_file(slug)
    if page is None:
        return None
    if INPLACE_RE.match(slug):
        e = _inplace(slug)
        stored = _items().get(reports.review_key(e.get("doc_id"), e["url"])) or {}
        return {"slug": slug, "title": stored.get("title") or e["title"], "url": e["url"]}
    stored = _items().get(slug) or {}
    return {"slug": slug, "title": stored.get("title") or _lesson_json(slug).get("title") or _title_from_html(page) or slug}


# ---------- the store: <lessons>/_data/items.json ----------

class MetaError(ValueError):
    pass


class SharedKey(MetaError):
    """Several pages carry the same data-doc-id, so one entry would stand for all of them."""


def norm_tags(tags) -> list[str]:
    """Tags as stored and shown: lower case, inner spaces collapsed, no empties, no repeats, in the given order."""
    out: list[str] = []
    for t in tags or []:
        t = " ".join(str(t).split()).lower()
        if t and t not in out:
            out.append(t)
    return out


def _status(value) -> str:
    """A stored or legacy status as one of STATUSES: learning -> open, understood -> done; anything else open."""
    v = str(value or "").strip().lower()
    return v if v in STATUSES else OLD_STATUS.get(v, "open")


def _read_items(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


def _items() -> dict:
    """The stored entries by key; built from the older stores the first time, once the page index is attached."""
    with _lock:
        data = _read_items(ITEMS)
        if data is None:
            data = migrate_items() if _pages is not None else None
        return data or {}


def _old_entry(old: dict, tutor: bool) -> dict:
    """An entry of pages.json or a lesson.json as an items.json entry."""
    entry = {"status": _status(old.get("status"))}
    tags = [t for t in norm_tags(old.get("tags") if isinstance(old.get("tags"), list) else []) if t != LESSON_TAG]
    if tags:
        entry["tags"] = tags
    projects = old.get("projects")
    if isinstance(projects, list) and projects:
        entry["projects"] = [str(p) for p in projects]
    if not tutor:  # a tutor lesson's title, topic and summary stay in its lesson.json
        for k in ("title", "topic", "summary"):
            if isinstance(old.get(k), str) and old[k].strip():
                entry[k] = old[k]
    entry["updated"] = 0
    return entry


def migrate_items(data_dir: Path | None = None, lessons_dir: Path | None = None, index=None) -> dict | None:
    """Build items.json from _data/pages.json (URL-keyed; each URL mapped to the key of the page now at that URL,
    else kept as the key) and the statuses, tags and projects of the tutor lessons' lesson.json. Neither old file
    is changed, so deleting items.json undoes it. None, and nothing written, when items.json exists already."""
    data_dir = Path(data_dir) if data_dir else DATA
    lessons_dir = Path(lessons_dir) if lessons_dir else LESSONS
    index = index if index is not None else _pages
    target = data_dir / "items.json"
    with _lock:
        if target.exists():
            return None
        keys = {e["url"]: e["key"] for e in (index.all_entries() if index is not None else [])}
        old = _read_items(data_dir / "pages.json") or {}
        items: dict[str, dict] = {}
        for url, entry in old.items():
            if isinstance(entry, dict):
                items[keys.get(url, url)] = _old_entry(entry, tutor=False)
        if lessons_dir.is_dir():
            for d in sorted(lessons_dir.iterdir()):
                if d.is_dir() and SLUG_RE.match(d.name) and (d / "index.html").is_file():
                    try:
                        meta = json.loads((d / "lesson.json").read_text())
                    except (OSError, ValueError):
                        meta = {}
                    items[d.name] = _old_entry(meta if isinstance(meta, dict) else {}, tutor=True)
        _write_json(target, items)
        return items


def mark_sent(key: str, at: float | None = None) -> dict:
    """Status sent from now (Send to agent); the page is open again once its file changes after `at`."""
    with _lock:
        items = _items()
        entry = items.setdefault(key, {})
        now = time.time()
        entry.update(status="sent", sent_at=now if at is None else at, updated=now)
        _write_json(ITEMS, items)
        return entry


# ---------- the one list ----------

def _created(name: str, mtime: float) -> str:
    m = DATE_PREFIX.match(name)
    return m.group(1) if m else time.strftime("%Y-%m-%d", time.localtime(mtime))


def _display(path: Path) -> str:
    if _pages is not None:
        return _pages.site.display(path)
    try:
        return "~/" + path.relative_to(Path.home()).as_posix()
    except ValueError:
        return path.as_posix()


def _item(base: dict, stored: dict, fallback: dict, lesson: bool, known: set[str]) -> dict:
    """One row of the list: the page's own fields, then what is stored for its key, then the fallback (lesson.json)."""
    pick = lambda k, d: stored[k] if k in stored else fallback.get(k, d)  # noqa: E731
    tags = [t for t in norm_tags(pick("tags", [])) if t != LESSON_TAG] + ([LESSON_TAG] if lesson else [])
    projects = [str(p) for p in pick("projects", []) or []]
    item = {
        **base,
        "id": reports.review_id(base["key"]),
        "title": stored.get("title") or fallback.get("title") or base["title"],
        "status": _status(pick("status", "open")),
        "tags": tags,
        "projects": projects,
        "unknown_projects": [p for p in projects if p not in known],
        "topic": str(pick("topic", "") or ""),
        "summary": str(pick("summary", "") or ""),
    }
    if stored.get("sent_at") and item["status"] == "sent":
        item["sent_at"] = stored["sent_at"]
    item["changed"] = max(item["mtime"], float(stored.get("updated") or 0))
    return item


def _tutor_bases() -> list[tuple[dict, dict]]:
    out = []
    if not LESSONS.is_dir():
        return out
    for d in sorted(LESSONS.iterdir(), reverse=True):
        page = d / "index.html"
        if not d.is_dir() or not SLUG_RE.match(d.name) or not page.is_file():
            continue
        meta = _lesson_json(d.name)
        mtime = page.stat().st_mtime
        base = {
            "key": d.name, "url": f"/lessons/{d.name}/", "title": _title_from_html(page) or d.name,
            "path": _display(page), "mtime": mtime, "root": "lessons", "area": "lessons", "origin": "tutor",
            "slug": d.name, "doc_id": d.name, "sessions": [], "created": str(meta.get("created") or d.name[:10]),
            "counts": _count(page), "shared": [],
        }
        out.append((base, meta))
    return out


def _page_bases() -> list[dict]:
    out = []
    for e in _pages.all_entries() if _pages is not None else []:
        base = {k: e[k] for k in ("key", "url", "title", "path", "mtime", "root", "area", "slug", "doc_id", "sessions")}
        base.update(origin="report", created=_created(Path(e["file"]).name, e["mtime"]),
                    shared=[u for u in _pages.urls_of(e["key"]) if u != e["url"]])
        if e["slug"]:
            base["counts"] = _count(Path(e["file"]))
        out.append(base)
    return out


def list_items() -> list[dict]:
    """Every page, newest change first. A sent page whose file is newer than its sent_at is open again (stored)."""
    known = project_ids()
    with _lock:
        items = _items()
        out, reopened = [], False
        for base in _page_bases():
            stored = items.get(base["key"]) or {}
            out.append(_item(base, stored, {}, base["slug"] is not None, known))
        for base, meta in _tutor_bases():
            out.append(_item(base, items.get(base["key"]) or {}, meta, True, known))
        for it in out:
            stored = items.get(it["key"])
            if stored and stored.get("status") == "sent" and it["mtime"] > float(stored.get("sent_at") or 0):
                stored.update(status="open", updated=time.time())
                stored.pop("sent_at", None)
                it.update(status="open", changed=max(it["changed"], stored["updated"]))
                it.pop("sent_at", None)
                reopened = True
        if reopened:
            _write_json(ITEMS, items)
    out.sort(key=lambda i: i["changed"], reverse=True)
    return out


def get_item(rid: str) -> dict | None:
    return next((i for i in list_items() if i["id"] == rid), None)


def _check(patch: dict) -> dict:
    if not isinstance(patch, dict):
        raise MetaError("the body must be a JSON object")
    bad = set(patch) - EDITABLE
    if bad:
        raise MetaError(f"not editable: {', '.join(sorted(bad))}")
    out = dict(patch)
    if "status" in out:
        if out["status"] == "sent":
            raise MetaError("sent is set by Send to agent, not by hand")
        if out["status"] not in SETTABLE:
            raise MetaError(f"status must be one of {', '.join(SETTABLE)}")
    if "projects" in out:
        projects = out["projects"]
        if not isinstance(projects, list) or not all(isinstance(p, str) for p in projects):
            raise MetaError("projects must be a list of project ids")
        unknown = [p for p in projects if p not in project_ids()]
        if unknown:
            raise MetaError(f"not an open project or area in the vault: {', '.join(unknown)}")
        out["projects"] = list(dict.fromkeys(projects))
    if "tags" in out:
        if not isinstance(out["tags"], list):
            raise MetaError("tags must be a list")
        out["tags"] = norm_tags(out["tags"])
    for k in ("title", "topic", "summary"):
        if k in out and not isinstance(out[k], str):
            raise MetaError(f"{k} must be text")
    return out


def update_item(rid: str, patch: dict) -> dict:
    """Merge the editable fields of `patch` into the page's entry in items.json. The lesson tag of a page under a root
    adds or removes the marker in its file (never for tutor lessons, which keep it). KeyError: no such page;
    MetaError: a bad field; SharedKey: the page's data-doc-id is used by other pages too."""
    item = get_item(rid)
    if item is None:
        raise KeyError(rid)
    patch = _check(patch)
    if item["shared"]:
        raise SharedKey(f"data-doc-id {item['key']!r} is used by several pages: {', '.join([item['url'], *item['shared']])}")
    if "tags" in patch:
        wants = LESSON_TAG in patch["tags"]
        patch["tags"] = [t for t in patch["tags"] if t != LESSON_TAG]
        if item["origin"] == "report" and wants != (item["slug"] is not None):
            _set_marker(item["url"], "lesson" if wants else "report")
    with _lock:
        items = _items()
        entry = items.setdefault(item["key"], {})
        entry.update(patch)
        if entry.get("status") != "sent":
            entry.pop("sent_at", None)
        entry["updated"] = time.time()
        _write_json(ITEMS, items)
    return get_item(rid)


def _set_marker(url: str, kind: str) -> None:
    found = _pages.page_file(url) if _pages is not None else None
    if found is None:
        raise MetaError("not a page under the server's folders")
    real, _ = found
    if not _pages.site.listed(real):
        raise MetaError("pages in the lessons folder or the template keep their lesson tag")
    try:
        changed = reports.write_kind(real, kind)
    except ValueError as e:
        raise MetaError(str(e)) from e
    if changed:
        _pages.scan()

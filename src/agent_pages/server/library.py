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
data-doc-id, else its URL; tutor:<slug> for a tutor lesson, so a copy of its page under a root, which carries the
slug as its data-doc-id, is a page of its own): {status, tags, projects, topic, summary, title?, sent_at?, updated,
lesson?}. A page that keeps its data-doc-id keeps its status and tags through a move. Statuses are open (the
default), sent, done and archived; a sent page whose file changed after sent_at is listed as open again.

items.json is written only by a PATCH and by mark_sent, with the fields they set. A field it lacks comes from the
older stores, read on every listing and never written: _data/pages.json (URL-keyed) for a page under a root, and
lesson.json for a tutor lesson, whose status open|done|archived (learning and understood still read as open and
done) the tutor skill sets. A lesson.json newer than the stored entry's `updated` wins for a field whose value it
changed since that PATCH (`lesson` keeps the values lesson.json had then), so the tutor's later edits show. A PATCH
or a send first takes every field lesson.json wins into the entry (and `lesson`), so a change to other fields never
hands a won field back to the older stored value.
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
PAGES_META = DATA / "pages.json"  # the older store of the marked pages, URL-keyed: a read-only fallback
ITEMS = DATA / "items.json"
STATUSES = ("open", "sent", "done", "archived")
SETTABLE = ("open", "done", "archived")  # sent is set by Send to agent (mark_sent), never by PATCH
OLD_STATUS = {"learning": "open", "understood": "done", "archived": "archived"}
EDITABLE = {"title", "topic", "summary", "projects", "tags", "status"}
LESSON_TAG = "lesson"
TUTOR = "tutor:"  # the items.json key of a tutor lesson is TUTOR + its slug


def tutor_key(slug: str) -> str:
    return TUTOR + slug

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
        entry = _report_entry(reports.review_key(e.get("doc_id"), e["url"]), e["url"], _items(), _old_pages())
        return {"slug": slug, "title": entry.get("title") or e["title"], "url": e["url"]}
    entry = _tutor_entry(slug, _items(), _lesson_json(slug), _lesson_mtime(slug))
    return {"slug": slug, "title": entry.get("title") or _title_from_html(page) or slug}


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
    """The stored entries by key ({} while nothing has been set)."""
    with _lock:
        return _read_items(ITEMS) or {}


def _old_pages() -> dict:
    """The older store of the pages under the roots, URL-keyed; read, never written."""
    return _read_items(PAGES_META) or {}


def _lesson_mtime(slug: str) -> float:
    try:
        return (LESSONS / slug / "lesson.json").stat().st_mtime
    except OSError:
        return 0.0


def _old_fields(old) -> dict:
    """The fields an entry of pages.json or a lesson.json gives, as items.json holds them."""
    if not isinstance(old, dict):
        return {}
    entry = {}
    if "status" in old:
        entry["status"] = _status(old["status"])
    if isinstance(old.get("tags"), list):
        entry["tags"] = [t for t in norm_tags(old["tags"]) if t != LESSON_TAG]
    if isinstance(old.get("projects"), list):
        entry["projects"] = [str(p) for p in old["projects"]]
    for k in ("title", "topic", "summary"):
        if isinstance(old.get(k), str) and old[k].strip():
            entry[k] = old[k]
    return entry


def _report_entry(key: str, url: str, items: dict, old: dict) -> dict:
    """A page's fields: what items.json stores for its key over its entry in pages.json (by its URL, else its key)."""
    return {**_old_fields(old.get(url) or old.get(key)), **(items.get(key) or {})}


def _lesson_wins(stored: dict, lesson: dict, mtime: float) -> dict:
    """The fields of lesson.json (as _old_fields gives them) that override the stored entry: lesson.json was written
    after the entry and changed the field's value since that field was stored."""
    if mtime <= float(stored.get("updated") or 0):
        return {}
    seen = stored.get("lesson") if isinstance(stored.get("lesson"), dict) else {}
    return {k: v for k, v in lesson.items() if k in stored and (k not in seen or seen[k] != v)}


def _tutor_entry(slug: str, items: dict, meta: dict, mtime: float) -> dict:
    """A tutor lesson's fields: lesson.json, under what items.json stores for it. A lesson.json written after the
    stored entry wins for each field whose value differs from the one it had when that field was stored."""
    stored = items.get(tutor_key(slug)) or {}
    lesson = _old_fields(meta)
    wins = _lesson_wins(stored, lesson, mtime)
    out = {**lesson, **stored, **wins}
    if "status" in wins:
        out.pop("sent_at", None)
    return out


def _store(items: dict, item: dict, patch: dict, now: float) -> dict:
    """Merge `patch` into the stored entry of a listed page. For a tutor lesson, first take into the entry every field
    lesson.json wins now (the new `updated` stamp would hand it back to the entry's older value), then remember what
    lesson.json says for each field stored."""
    entry = items.setdefault(item["key"], {})
    lesson = _old_fields(_lesson_json(item["slug"])) if item["origin"] == "tutor" else {}
    wins = _lesson_wins(entry, lesson, _lesson_mtime(item["slug"])) if lesson else {}
    if wins:
        entry.update(wins)
        if "status" in wins:
            entry.pop("sent_at", None)
        entry.setdefault("lesson", {}).update(wins)
    entry.update(patch)
    if entry.get("status") != "sent":
        entry.pop("sent_at", None)
    if item["origin"] == "tutor":
        seen = entry.setdefault("lesson", {})
        for k in patch:
            if k in lesson:
                seen[k] = lesson[k]
            else:
                seen.pop(k, None)
        if not seen:
            entry.pop("lesson")
    entry["updated"] = now
    return entry


def mark_sent(key: str, at: float | None = None) -> dict:
    """Status sent from now (Send to agent); the page is open again once its file changes after `at`."""
    item = next((i for i in list_items() if i["key"] == key), None)
    with _lock:
        items = _items()
        now = time.time()
        patch = {"status": "sent", "sent_at": now if at is None else at}
        entry = _store(items, item, patch, now) if item else items.setdefault(key, {})
        entry.update(patch, updated=now)
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


def _item(base: dict, entry: dict, lesson: bool, known: set[str]) -> dict:
    """One row of the list: the page's own fields under its entry (_report_entry, _tutor_entry). A sent page whose
    file is newer than its sent_at is listed as open."""
    tags = [t for t in norm_tags(entry.get("tags") or []) if t != LESSON_TAG] + ([LESSON_TAG] if lesson else [])
    projects = [str(p) for p in entry.get("projects") or []]
    item = {
        **base,
        "id": reports.review_id(base["key"]),
        "title": entry.get("title") or base["title"],
        "status": _status(entry.get("status")),
        "tags": tags,
        "projects": projects,
        "unknown_projects": [p for p in projects if p not in known],
        "topic": str(entry.get("topic") or ""),
        "summary": str(entry.get("summary") or ""),
    }
    if item["status"] == "sent":
        sent_at = float(entry.get("sent_at") or 0)
        if base["mtime"] > sent_at:
            item["status"] = "open"
        else:
            item["sent_at"] = sent_at
    item["changed"] = max(item["mtime"], float(entry.get("updated") or 0))
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
            "key": tutor_key(d.name), "url": f"/lessons/{d.name}/", "title": _title_from_html(page) or d.name,
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
    """Every page, newest change first; reads the stores and writes nothing."""
    known = project_ids()
    with _lock:
        items, old = _items(), _old_pages()
        out = [_item(b, _report_entry(b["key"], b["url"], items, old), b["slug"] is not None, known) for b in _page_bases()]
        for base, meta in _tutor_bases():
            entry = _tutor_entry(base["slug"], items, meta, _lesson_mtime(base["slug"]))
            out.append(_item(base, entry, True, known))
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
        raise _shared(item)
    if "tags" in patch:
        wants = LESSON_TAG in patch["tags"]
        patch["tags"] = [t for t in patch["tags"] if t != LESSON_TAG]
        if item["origin"] == "report" and wants != (item["slug"] is not None):
            _set_marker(item["url"], "lesson" if wants else "report")
    with _lock:
        items = _items()
        _store(items, item, patch, time.time())
        _write_json(ITEMS, items)
    return get_item(rid)


def _shared(item: dict) -> SharedKey:
    return SharedKey(f"data-doc-id {item['key']!r} is used by several pages: {', '.join([item['url'], *item['shared']])}")


def update_items(body) -> list[dict]:
    """One status for several pages ({"ids": [...], "status": ...}), all or none, in one write of items.json.
    KeyError: an id names no page; MetaError: a bad body or status; SharedKey: a page's data-doc-id is shared."""
    if not isinstance(body, dict) or set(body) != {"ids", "status"}:
        raise MetaError('the body must be {"ids": [...], "status": ...}')
    ids = body["ids"]
    if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
        raise MetaError("ids must be a list of page ids")
    patch = _check({"status": body["status"]})
    by_id = {i["id"]: i for i in list_items()}
    wanted = list(dict.fromkeys(ids))
    for rid in wanted:
        if rid not in by_id:
            raise KeyError(rid)
        if by_id[rid]["shared"]:
            raise _shared(by_id[rid])
    with _lock:
        items = _items()
        now = time.time()
        for rid in wanted:
            _store(items, by_id[rid], dict(patch), now)
        _write_json(ITEMS, items)
    fresh = {i["id"]: i for i in list_items()}
    return [fresh[rid] for rid in wanted if rid in fresh]


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

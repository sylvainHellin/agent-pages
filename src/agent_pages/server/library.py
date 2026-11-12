"""Lesson library: reads <lessons>/<slug>/lesson.json, the projects and areas of the Obsidian vault,
and the small per-user state (when each lesson was last opened). No framework, stdlib + PyYAML.

Paths come from the config through configure():
  LESSONS  the lessons folder (lessons_dir)
  DATA     server state: review sync, inbox, jobs (<lessons>/_data)
  VAULT    the vault whose 01-projects/ and 02-areas/ notes are the projects (vault; None: no projects)

Two kinds of lessons share one list:
  tutor lessons     <lessons>/<YYYY-MM-DD_slug>/index.html with their metadata in lesson.json
  in-place lessons  pages under the server's roots that carry the lesson marker (reports.py), wherever they
                    live; slug page-<hash of the server URL>, metadata in <lessons>/_data/pages.json keyed by
                    that URL, never in the page file. attach_pages() hands the page index to the library.
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

ASSETS = TEMPLATE_DIR  # shared page assets are code: the repo template, served at /lessons/_assets/
LESSONS = Path.home() / ".local/share/agent-pages/lessons"  # replaced by configure()
DATA = LESSONS / "_data"
STATE = DATA / "state.json"
VAULT: Path | None = None
PROJECT_DIRS = ("02-areas", "01-projects")
CLOSED = {"done", "archived", "completed", "cancelled", "dropped"}

SLUG_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]{0,80}$")
INPLACE_RE = re.compile(r"^page-[0-9a-f]{12}$")
DATE_PREFIX = re.compile(r"^(\d{4}-\d{2}-\d{2})")
PAGES_META = DATA / "pages.json"
STATUSES = ("learning", "understood", "archived")
EDITABLE = {"title", "topic", "summary", "projects", "tags", "status"}

_lock = threading.Lock()
_pages = None  # the report page index (reports.Index), for in-place lessons


def configure(lessons_dir: Path, vault: Path | None) -> None:
    """Point the library at the configured lessons folder and vault."""
    global LESSONS, DATA, STATE, VAULT, PAGES_META
    LESSONS = Path(lessons_dir)
    DATA = LESSONS / "_data"
    STATE = DATA / "state.json"
    PAGES_META = DATA / "pages.json"
    VAULT = Path(vault) if vault else None
    _reg_cache.update(key=None, projects=[])


def attach_pages(index) -> None:
    """The page index whose marked pages are the in-place lessons (None: tutor lessons only)."""
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


# ---------- state (opened times) ----------

def _read_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {"opened": {}}


def mark_opened(slug: str) -> None:
    with _lock:
        st = _read_state()
        st.setdefault("opened", {})[slug] = time.time()
        STATE.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATE.with_suffix(".tmp")
        tmp.write_text(json.dumps(st, indent=1))
        tmp.replace(STATE)


# ---------- lessons ----------

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


def _read_pages_meta() -> dict:
    try:
        data = json.loads(PAGES_META.read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def page_file(slug: str) -> Path | None:
    """The HTML file of a lesson, tutor or in-place; None when there is no such lesson."""
    if INPLACE_RE.match(slug):
        e = _inplace(slug)
        return Path(e["file"]) if e and Path(e["file"]).is_file() else None
    page = LESSONS / slug / "index.html"
    return page if SLUG_RE.match(slug) and page.is_file() else None


def _read_inplace(slug: str) -> dict | None:
    e = _inplace(slug)
    if e is None or not Path(e["file"]).is_file():
        return None
    page = Path(e["file"])
    stored = _read_pages_meta().get(e["url"])
    meta = {k: v for k, v in (stored if isinstance(stored, dict) else {}).items() if k in EDITABLE}
    if not meta.get("title"):
        meta["title"] = e["title"]
    m = DATE_PREFIX.match(page.name)
    meta.update(
        slug=slug, inplace=True, url=e["url"], path=e["path"], doc_id=e.get("doc_id"),
        created=m.group(1) if m else time.strftime("%Y-%m-%d", time.localtime(e["mtime"])),
        updated=page.stat().st_mtime, counts=_count(page),
    )
    meta.setdefault("projects", [])
    meta.setdefault("tags", [])
    meta.setdefault("status", "learning")
    return meta


def read_meta(slug: str) -> dict | None:
    if INPLACE_RE.match(slug):
        return _read_inplace(slug)
    d = LESSONS / slug
    page = d / "index.html"
    if not SLUG_RE.match(slug) or not page.is_file():
        return None
    try:
        meta = json.loads((d / "lesson.json").read_text())
    except (OSError, ValueError):
        meta = {}
    meta["slug"] = slug
    meta.setdefault("title", _title_from_html(page) or slug)
    meta.setdefault("created", slug[:10])
    meta.setdefault("projects", [])
    meta.setdefault("tags", [])
    meta.setdefault("status", "learning")
    meta["updated"] = max(page.stat().st_mtime, (d / "lesson.json").stat().st_mtime if (d / "lesson.json").exists() else 0)
    meta["counts"] = _count(page)
    return meta


def list_lessons() -> list[dict]:
    opened = _read_state().get("opened", {})
    known = project_ids()
    out = []
    if not LESSONS.is_dir():
        return out
    for d in sorted(LESSONS.iterdir(), reverse=True):
        if not d.is_dir() or d.name.startswith(("_", ".")):
            continue
        meta = read_meta(d.name)
        if meta is None:
            continue
        meta["opened"] = opened.get(d.name)
        meta["unknown_projects"] = [p for p in meta["projects"] if p not in known]
        out.append(meta)
    for slug in sorted(_pages.inplace_lessons() if _pages is not None else {}):
        meta = read_meta(slug)
        if meta is None:
            continue
        meta["opened"] = opened.get(slug)
        meta["unknown_projects"] = [p for p in meta["projects"] if p not in known]
        out.append(meta)
    return out


class MetaError(ValueError):
    pass


def update_meta(slug: str, patch: dict) -> dict:
    """Merge the editable fields of `patch` into lesson.json. Projects must exist in the registry."""
    if read_meta(slug) is None:
        raise KeyError(slug)
    bad = set(patch) - EDITABLE
    if bad:
        raise MetaError(f"not editable: {', '.join(sorted(bad))}")
    if "projects" in patch:
        projects = patch["projects"]
        if not isinstance(projects, list) or not all(isinstance(p, str) for p in projects):
            raise MetaError("projects must be a list of project ids")
        unknown = [p for p in projects if p not in project_ids()]
        if unknown:
            raise MetaError(f"not an open project or area in the vault: {', '.join(unknown)}")
        patch["projects"] = list(dict.fromkeys(projects))
    if "tags" in patch:
        if not isinstance(patch["tags"], list):
            raise MetaError("tags must be a list")
        patch["tags"] = [str(t).strip() for t in patch["tags"] if str(t).strip()]
    if "status" in patch and patch["status"] not in STATUSES:
        raise MetaError(f"status must be one of {', '.join(STATUSES)}")
    for k in ("title", "topic", "summary"):
        if k in patch and not isinstance(patch[k], str):
            raise MetaError(f"{k} must be text")
    with _lock:
        if INPLACE_RE.match(slug):  # an in-place lesson: its entry in _data/pages.json, never the page file
            url = _inplace(slug)["url"]
            path = PAGES_META
            meta = _read_pages_meta()
            entry = meta.get(url) if isinstance(meta.get(url), dict) else {}
            entry.update(patch)
            meta[url] = entry
        else:
            path = LESSONS / slug / "lesson.json"
            try:
                meta = json.loads(path.read_text())
            except (OSError, ValueError):
                meta = {}
            meta.update(patch)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
        tmp.replace(path)
    return read_meta(slug)

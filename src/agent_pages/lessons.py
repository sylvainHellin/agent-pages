"""agent-pages lesson new: create a lesson folder in the lessons folder and print its path and link.

The folder is <lessons_dir>/YYYY-MM-DD_<slug>/ with index.html (template/lesson.html, placeholders
filled), lesson.json (metadata the library reads) and figures/. Without --project the project is
guessed from the working directory when it lies inside the repo a vault note names in its `repo:`
field; --no-project turns the guess off. Project ids are the names of open vault project and area notes.
Lesson pages link the template through <lessons_dir>/_assets, a symlink to the repo's template/
that this command creates when it is missing; the server serves the same files at /lessons/_assets/.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import re
import sys
from pathlib import Path

from . import TEMPLATE_DIR
from .config import Config
from .page import link_assets, set_doc_id

SLUG_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]{0,80}$")


def _library(cfg: Config):
    """The server's lesson library module, pointed at the configured folders."""
    from .server import library

    library.configure(cfg.lessons_dir, cfg.vault)
    return library


def projects(cfg: Config) -> list[dict]:
    if not cfg.vault:
        return []
    return _library(cfg).registry_projects()


def guess_project(cfg: Config, cwd: Path) -> str | None:
    """The vault note whose `repo:` contains the cwd (the deepest repo wins)."""
    cwd = cwd.resolve()
    best, depth = None, -1
    for p in projects(cfg):
        if not p.get("path"):
            continue
        repo = Path(p["path"]).expanduser().resolve()
        if cwd == repo or repo in cwd.parents:
            if len(repo.parts) > depth:
                best, depth = p["id"], len(repo.parts)
    return best


def ensure_assets_link(lessons_dir: Path) -> None:
    link = lessons_dir / "_assets"
    if link.is_symlink() and not link.exists():
        print(f"agent-pages: warning: {link} is a broken symlink; point it at {TEMPLATE_DIR}", file=sys.stderr)
    elif not link.exists():
        link.symlink_to(TEMPLATE_DIR, target_is_directory=True)


def lesson_page(cfg: Config, slug: str, title: str, topic: str, date: str, sources: str) -> str:
    page = (TEMPLATE_DIR / "lesson.html").read_text(encoding="utf-8")
    page = set_doc_id(page, slug)
    esc = html.escape
    for k, v in {
        "LESSON_TITLE": esc(title),
        "TOPIC": esc(topic or title),
        "DATE": date,
        "SOURCES": esc(sources or "see Go further"),
    }.items():
        page = page.replace(k, v)
    return link_assets(page, "../_assets/", cfg.theme_css(cfg.lesson_theme), cfg.vim_default)


def cmd_lesson_new(cfg: Config, a) -> None:
    slug_part = re.sub(r"[^a-z0-9-]+", "-", a.slug.lower()).strip("-")
    slug = f"{a.date}_{slug_part}"
    if not SLUG_RE.match(slug):
        sys.exit(f"agent-pages: bad slug: {slug}")
    chosen = list(a.project)
    if chosen and not cfg.vault:
        sys.exit("agent-pages: --project needs a vault in the config (key `vault`)")
    if not chosen and not a.no_project:
        g = guess_project(cfg, Path.cwd())
        if g:
            chosen = [g]
    known = {p["id"] for p in projects(cfg)}
    unknown = [p for p in chosen if p not in known]
    if unknown:
        sys.exit(f"agent-pages: not an open project or area in the vault: {', '.join(unknown)}")

    cfg.lessons_dir.mkdir(parents=True, exist_ok=True)
    ensure_assets_link(cfg.lessons_dir)
    d = cfg.lessons_dir / slug
    if d.exists():
        sys.exit(f"agent-pages: exists already: {d}")
    page = lesson_page(cfg, slug, a.title, a.topic, a.date, a.sources)
    (d / "figures").mkdir(parents=True)
    (d / "index.html").write_text(page, encoding="utf-8")
    meta = {
        "title": a.title,
        "topic": a.topic,
        "summary": a.summary,
        "created": a.date,
        "projects": chosen,
        "tags": a.tag,
        "status": "learning",
    }
    (d / "lesson.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"folder:   {d}")
    print(f"page:     {d / 'index.html'}")
    print(f"projects: {', '.join(chosen) or '(none)'}")
    print(f"url:      {cfg.base_url}/#/l/{slug}")


def add_parser(sub) -> None:
    p = sub.add_parser("lesson", help="lesson pages in the lessons folder")
    lsub = p.add_subparsers(dest="lesson_cmd", required=True)
    n = lsub.add_parser("new", help="create a lesson folder", description=__doc__.split("\n\n")[0])
    n.add_argument("slug", help="short kebab-case name, e.g. kv-cache-transfer")
    n.add_argument("--title", required=True)
    n.add_argument("--topic", default="", help="eyebrow text above the title (default: the title)")
    n.add_argument("--summary", default="", help="one line shown in the library list")
    n.add_argument("--project", action="append", default=[], help="vault project id (repeatable)")
    n.add_argument("--no-project", action="store_true", help="do not guess the project from the cwd")
    n.add_argument("--tag", action="append", default=[])
    n.add_argument("--sources", default="", help="short source line for the page header")
    n.add_argument("--date", default=dt.date.today().isoformat())
    n.set_defaults(fn=cmd_lesson_new)

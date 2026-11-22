"""Make a page from a template skeleton: link the template assets and the theme, set title, doc id and sessions."""

from __future__ import annotations

import html
import json
import os
import re
from pathlib import Path

from . import TEMPLATE_DIR, THEMES_DIR

# The skeletons link the template assets relatively, so they render inside template/ as they are.
ASSET_REFS = {
    'href="favicon.png"': "favicon.png",
    'href="report.css"': "report.css",
    'src="report.js"': "report.js",
}
THEME_REF = 'href="themes/plain.css"'


def theme_href(css: Path, base: str) -> str:
    """A built-in theme sits under the template, so it is linked through the same base; any other is linked by file URL."""
    try:
        rel = css.resolve().relative_to(THEMES_DIR.resolve())
    except ValueError:
        return css.resolve().as_uri()
    return f"{base}themes/{rel.as_posix()}"


def link_assets(page: str, base: str, theme_css: Path, vim_default: bool) -> str:
    """Point the skeleton's asset links at base (a URL ending in /) and its theme link at the chosen theme."""
    for attr, name in ASSET_REFS.items():
        key = attr.split("=")[0]
        page = page.replace(attr, f'{key}="{base}{name}"', 1)
    page = page.replace(THEME_REF, f'href="{html.escape(theme_href(theme_css, base))}"', 1)
    if not vim_default:
        page = re.sub(r"<html\b", '<html data-vim-default="off"', page, count=1)
    return page


def set_title(page: str, title: str) -> str:
    title = html.escape(title, quote=False)
    # Replacements go through lambdas so a backslash in the title stays literal.
    page = re.sub(r"<title>.*?</title>", lambda _: f"<title>{title}</title>", page, count=1, flags=re.S)
    return re.sub(r"<h1>.*?</h1>", lambda _: f"<h1>{title}</h1>", page, count=1, flags=re.S)


def set_doc_id(page: str, slug: str) -> str:
    return re.sub(r'data-doc-id="[^"]*"', lambda _: f'data-doc-id="{html.escape(slug)}"', page, count=1)


# The agent sessions that wrote a page, oldest first (the newest last), so a later session can look up the
# conversation behind it and Send to agent reaches the newest one first.
# AGENT_PAGES_SESSION serves any agent harness and wins; else PI_SESSION_ID, unless that is a pi-subagents child.
SESSION_ENV = ("AGENT_PAGES_SESSION", "PI_SESSION_ID")
SESSION_META = re.compile(r'<meta\s+name="agent-pages-session"\s+content="([^"]*)"\s*/?>\n?', re.I)
# The prompt markers of a pi-subagents child (the same test as the agent-pages-inbox pi extension).
SUBAGENT_RE = re.compile(r"<active_agent name=|<sub_agent_context>|operating as a sub-agent")
HEAD_LINES = 12  # the session header and the system prompt sit in the first lines of a pi session file


def _session_head(path: Path) -> tuple[dict, bool] | None:
    """A pi session file's header and whether its system prompt is a subagent's; None when it cannot be read."""
    try:
        with path.open(encoding="utf-8", errors="replace") as f:
            header = json.loads(f.readline())
            sub = False
            for _, line in zip(range(HEAD_LINES), f):
                if '"role":"system"' in line[:300] or '"role": "system"' in line[:300]:
                    sub = bool(SUBAGENT_RE.search(line))
                    break
    except (OSError, ValueError):
        return None
    return (header, sub) if isinstance(header, dict) else None


def _pi_session() -> str | None:
    """PI_SESSION_ID, or for a pi-subagents child the first session up its parentSession chain that is no
    subagent (the one that dispatched it); None when that chain cannot be followed, never the child's own id."""
    sid = os.environ.get("PI_SESSION_ID", "").strip()
    file = os.environ.get("PI_SESSION_FILE", "").strip()
    if not sid or not file:
        return sid or None
    path, seen = Path(file), set()
    while path not in seen and len(seen) < 8:
        seen.add(path)
        head = _session_head(path)
        if head is None:
            return sid if len(seen) == 1 else None  # an unreadable own file: trust the variable
        header, sub = head
        if len(seen) == 1 and str(header.get("id") or "") != sid:
            return sid  # PI_SESSION_FILE names another session: it says nothing about this one
        if not sub:
            return str(header.get("id") or "").strip() or None
        parent = str(header.get("parentSession") or "")
        if not parent:
            return None
        path = Path(parent)
    return None


def current_session() -> str | None:
    value = os.environ.get("AGENT_PAGES_SESSION", "").strip()
    return value or _pi_session()


def page_sessions(page: str) -> list[str]:
    m = SESSION_META.search(page)
    return html.unescape(m.group(1)).split() if m else []


def add_session(page: str, session: str) -> str:
    """Append a session id to the page's session line, adding the line after the charset (and kind) meta; an id
    the line already lists moves to the end, so the last id is always the newest session that wrote the page."""
    session = "".join(session.split())
    ids = page_sessions(page)
    if not session or ids[-1:] == [session]:
        return page
    kept = [i for i in ids if i != session]
    line = f'<meta name="agent-pages-session" content="{html.escape(" ".join(kept + [session]))}">\n'
    if ids:
        return SESSION_META.sub(lambda _: line, page, count=1)
    anchor = re.search(r'<meta\s+name="agent-pages-kind"[^>]*>\n?', page, re.I) or re.search(r"<meta\s+charset[^>]*>\n?", page, re.I)
    if not anchor:
        return page
    end = anchor.end()
    if not anchor.group(0).endswith("\n"):
        line = "\n" + line.rstrip("\n")
    return page[:end] + line + page[end:]


def report_page(title: str | None, slug: str, theme_css: Path, vim_default: bool, session: str | None = None) -> str:
    """A new report page linking the repo template by file:// URL."""
    page = (TEMPLATE_DIR / "report.html").read_text(encoding="utf-8")
    page = set_doc_id(page, slug)
    if session:
        page = add_session(page, session)
    if title:
        page = set_title(page, title)
    return link_assets(page, TEMPLATE_DIR.as_uri() + "/", theme_css, vim_default)

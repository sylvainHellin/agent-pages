"""Make a page from a template skeleton: link the template assets and the theme, set title, doc id and sessions."""

from __future__ import annotations

import html
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


# The agent sessions that wrote a page, oldest first, so a later session can look up the conversation behind it.
# The first of these variables that is set names the current session; AGENT_PAGES_SESSION serves any agent harness.
SESSION_ENV = ("AGENT_PAGES_SESSION", "PI_SESSION_ID")
SESSION_META = re.compile(r'<meta\s+name="agent-pages-session"\s+content="([^"]*)"\s*/?>\n?', re.I)


def current_session() -> str | None:
    for name in SESSION_ENV:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def page_sessions(page: str) -> list[str]:
    m = SESSION_META.search(page)
    return html.unescape(m.group(1)).split() if m else []


def add_session(page: str, session: str) -> str:
    """Append a session id to the page's session line, adding the line after the charset (and kind) meta."""
    session = "".join(session.split())
    ids = page_sessions(page)
    if not session or session in ids:
        return page
    line = f'<meta name="agent-pages-session" content="{html.escape(" ".join(ids + [session]))}">\n'
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

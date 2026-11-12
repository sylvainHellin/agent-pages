"""Make a page from a template skeleton: link the template assets and the theme, set title and doc id."""

from __future__ import annotations

import html
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


def report_page(title: str | None, slug: str, theme_css: Path, vim_default: bool) -> str:
    """A new report page linking the repo template by file:// URL."""
    page = (TEMPLATE_DIR / "report.html").read_text(encoding="utf-8")
    page = set_doc_id(page, slug)
    if title:
        page = set_title(page, title)
    return link_assets(page, TEMPLATE_DIR.as_uri() + "/", theme_css, vim_default)

#!/usr/bin/env python3
"""Inline report.css, the theme, report.js, fonts and images into a report page, for sharing it outside this machine.

    uv run bundle.py page.html -o page.standalone.html
    uv run bundle.py page.html --pdf          # also print page.pdf with headless Chrome

The page links the shared files by absolute file:// path; the bundled copy carries them
inline, with the favicon, the stylesheet fonts and the page's local images as data URIs,
and opens anywhere. Standard library only; --pdf needs Chrome or Chromium.
"""

import argparse
import base64
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlparse

HERE = Path(__file__).resolve().parent
LINK = re.compile(r'<link\b[^>]*\bhref="([^"]*report\.css)"[^>]*>', re.I)
THEME = re.compile(r'<link\b[^>]*\bhref="([^"]*themes/([\w-]+\.css))"[^>]*>', re.I)
SCRIPT = re.compile(r'<script\b[^>]*\bsrc="([^"]*report\.js)"[^>]*>\s*</script>', re.I)
ICON = re.compile(r'(<link\b[^>]*\bhref=")([^"]*favicon\.png)("[^>]*>)', re.I)
CSS_URL = re.compile(r'url\(\s*(["\']?)([^"\')]+)\1\s*\)')
IMG = re.compile(r'(<(?:img|source)\b[^>]*\bsrc=")([^"]+)(")', re.I)
CHROMES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
)


def source(ref: str, page: Path, name: str) -> Path:
    """Resolve a linked asset: the referenced file if it exists, else the copy next to this script."""
    url = urlparse(ref)
    if url.scheme == "file":
        cand = Path(unquote(url.path))
    elif not url.scheme:
        cand = (page.parent / unquote(ref)).resolve()
    else:
        cand = None
    if cand is not None and cand.is_file():
        return cand
    return HERE / name


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or {".woff2": "font/woff2", ".woff": "font/woff"}.get(
        path.suffix.lower(), "application/octet-stream")
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def local(ref: str, base: Path) -> Path | None:
    """The file a relative or file:// reference points to, or None for remote, data: and missing targets."""
    url = urlparse(ref)
    if url.scheme == "file":
        cand = Path(unquote(url.path))
    elif not url.scheme and not ref.startswith(("#", "//")):
        cand = (base / unquote(url.path)).resolve()
    else:
        return None
    return cand if cand.is_file() else None


def inline_css_urls(css: str, base: Path) -> str:
    """Replace url(...) references to local files (the fonts) with data URIs."""
    def sub(m: re.Match) -> str:
        path = local(m.group(2), base)
        return f'url("{data_uri(path)}")' if path else m.group(0)
    return CSS_URL.sub(sub, css)


def inline_images(html: str, page: Path) -> str:
    """Replace src references to local images with data URIs; the warning names the ones not found."""
    missing = []
    def sub(m: re.Match) -> str:
        ref = m.group(2)
        if ref.startswith(("data:", "http:", "https:")):
            return m.group(0)
        path = local(ref, page.parent)
        if not path:
            missing.append(ref)
            return m.group(0)
        return m.group(1) + data_uri(path) + m.group(3)
    html = IMG.sub(sub, html)
    if missing:
        print("warning: images not found, left linked: " + ", ".join(missing), file=sys.stderr)
    return html


def chrome() -> str:
    for cand in (os.environ.get("CHROME"), *CHROMES):
        if cand and Path(cand).is_file():
            return cand
    for name in ("google-chrome", "chromium", "chromium-browser"):
        if found := shutil.which(name):
            return found
    sys.exit("--pdf needs Chrome or Chromium: set CHROME to its binary")


def print_pdf(html_file: Path, pdf: Path) -> None:
    with tempfile.TemporaryDirectory() as profile:
        r = subprocess.run([chrome(), "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                            f"--user-data-dir={profile}", f"--print-to-pdf={pdf}", html_file.resolve().as_uri()],
                           capture_output=True, text=True, timeout=120)
    if r.returncode or not pdf.is_file():
        sys.exit(f"Chrome failed to print {pdf}:\n{r.stderr[-800:]}")


def bundle(page: Path) -> str:
    html = page.read_text(encoding="utf-8")
    css_m, js_m = LINK.search(html), SCRIPT.search(html)
    if not css_m or not js_m:
        missing = [n for n, m in (("report.css link", css_m), ("report.js script", js_m)) if not m]
        sys.exit(f"{page}: no {' and no '.join(missing)} found")
    css_path = source(css_m.group(1), page, "report.css")
    css = inline_css_urls(css_path.read_text(encoding="utf-8"), css_path.parent)
    js = source(js_m.group(1), page, "report.js").read_text(encoding="utf-8")
    css = re.sub(r"</(style)", r"<\\/\1", css, flags=re.I)
    js = re.sub(r"</(script)", r"<\\/\1", js, flags=re.I)
    html = LINK.sub(lambda _: "<style>\n" + css + "</style>", html, count=1)
    theme_m = THEME.search(html)
    if theme_m:
        theme_path = source(theme_m.group(1), page, "themes/" + theme_m.group(2))
        theme = inline_css_urls(theme_path.read_text(encoding="utf-8"), theme_path.parent)
        theme = re.sub(r"</(style)", r"<\\/\1", theme, flags=re.I)
        html = THEME.sub(lambda _: "<style>\n" + theme + "</style>", html, count=1)
    icon_m = ICON.search(html)
    if icon_m:
        data = base64.b64encode(source(icon_m.group(2), page, "favicon.png").read_bytes()).decode()
        html = ICON.sub(lambda m: m.group(1) + "data:image/png;base64," + data + m.group(3), html, count=1)
    html = inline_images(html, page)
    return SCRIPT.sub(lambda _: "<script>\n" + js + "</script>", html, count=1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("page", type=Path, help="report page that links report.css and report.js")
    ap.add_argument("-o", "--output", type=Path, help="output file (default: <page>.standalone.html)")
    ap.add_argument("--pdf", nargs="?", type=Path, const=True, metavar="FILE",
                    help="also print the bundled page to PDF with headless Chrome (default: <page>.pdf)")
    args = ap.parse_args()
    out = args.output or args.page.with_name(args.page.stem + ".standalone.html")
    if out.resolve() == args.page.resolve():
        sys.exit("refusing to overwrite the source page")
    out.write_text(bundle(args.page), encoding="utf-8")
    print(f"{out} ({out.stat().st_size // 1024} KB)")
    if args.pdf:
        pdf = args.page.with_suffix(".pdf") if args.pdf is True else args.pdf
        print_pdf(out, pdf)
        print(f"{pdf} ({pdf.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

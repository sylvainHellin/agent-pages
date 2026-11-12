"""The app theme's tokens for the library app (GET /api/theme.css): app_theme of the config, else lesson_theme.

The stylesheet is report.css's token blocks (its default look, light and dark) followed by the theme file, with every
custom property renamed --pg-<name>: the page tokens --muted, --accent, --primary and --ring mean something else in the
app's shadcn tokens, so apps/ui/src/index.css maps --background, --primary, ... onto --pg-bg, --pg-primary, ...
The embedded Inter fonts of report.css come along only when the theme uses them (plain, basenord; not tum).
"""

from __future__ import annotations

import re
from pathlib import Path

from .. import TEMPLATE_DIR

TOKENS_END = "/* ============ Base"  # report.css: the token blocks come before this line
FONTS_START = "/* ============ Embedded fonts"
FONT_FACE = re.compile(r"@font-face\s*\{[^}]*\}")
PROP = re.compile(r"--([A-Za-z][\w-]*)")


def prefixed(css: str) -> str:
    """Every custom property and var() reference renamed --pg-<name>."""
    return PROP.sub(r"--pg-\1", css)


def app_theme_css(theme: Path, name: str = "") -> str:
    """The tokens of report.css and the theme, prefixed --pg-, plus the Inter faces when the theme's fonts use them."""
    base = (TEMPLATE_DIR / "report.css").read_text(encoding="utf-8")
    end = base.find(TOKENS_END)
    tokens = base[:end] if end > 0 else ""
    try:
        own = theme.read_text(encoding="utf-8")
    except OSError:
        own = ""
    fonts = ""
    if "Report Inter" in own or not re.search(r"--font\s*:", own):  # the theme keeps or names report.css's Inter
        start = base.find(FONTS_START)
        faces = FONT_FACE.findall(base[start:]) if start >= 0 else []
        fonts = "\n".join(f for f in faces if '"Report Inter' in f)
    head = f"/* agent-pages: tokens of the app theme {name or theme.stem}, prefixed --pg- for the library app */\n"
    return head + prefixed(tokens) + "\n" + prefixed(own) + "\n" + fonts + "\n"

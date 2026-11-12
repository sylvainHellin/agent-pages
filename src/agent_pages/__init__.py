"""agent-pages: HTML pages an agent writes for a person to read and comment on, reports and lessons."""

from pathlib import Path

__version__ = "0.1.0"

# The repo checkout this package runs from (`uv run --project <repo> agent-pages ...` installs it editable).
REPO = Path(__file__).resolve().parents[2]
TEMPLATE_DIR = REPO / "template"
THEMES_DIR = TEMPLATE_DIR / "themes"

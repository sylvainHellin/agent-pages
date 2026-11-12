#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = ["pillow"]
# ///
"""Render every icon of the project from one SVG (default: icon.svg next to this script).

    uv run template/icon/build.py [icon.svg]     # needs the resvg CLI (brew install resvg)

The SVG is a 64 x 64 tile whose first <rect> is the full-bleed background with rx="0".
Favicons get that rect rounded (rx 14) so they read as a tile in a tab bar; iOS and the web app
manifest get the square tile, since the system rounds it. Writes:
  template/favicon.ico, favicon.png, apple-touch-icon.png   report and lesson pages, server root
  apps/ui/public/favicon.svg, icon-180.png, icon-192.png, icon-512.png   the library app
"""

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
TEMPLATE, PUBLIC = HERE.parent, HERE.parents[1] / "apps/ui/public"
SRC = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else HERE / "icon.svg"

square = SRC.read_text()
if 'rx="0"' not in square:
    sys.exit(f'{SRC}: the background <rect> needs rx="0" so the favicons can round it')
rounded = square.replace('rx="0"', 'rx="14"', 1)


def render(svg: str, size: int, out: Path) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".svg") as f:
        f.write(svg)
        f.flush()
        subprocess.run(["resvg", "-w", str(size), "-h", str(size), f.name, str(out)], check=True)


render(rounded, 64, TEMPLATE / "favicon.png")
render(square, 180, TEMPLATE / "apple-touch-icon.png")
with tempfile.TemporaryDirectory() as tmp:
    big = Path(tmp) / "ico.png"
    render(rounded, 256, big)
    Image.open(big).save(TEMPLATE / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
(PUBLIC / "favicon.svg").write_text(rounded)
for size in (180, 192, 512):
    render(square, size, PUBLIC / f"icon-{size}.png")
print(f"icons written from {SRC}")

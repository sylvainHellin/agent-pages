"""agent-pages fig build <file.tex|file.py>: render a figure for a page with the configured backend.

texfig      a .tex file holding a tikzpicture, rendered by examples/build.sh of a tex-fig checkout
            (https://github.com/sylvainHellin/tex-fig; config key texfig_dir) to a PNG next to the source.
            Needs tectonic and pdftoppm (poppler) on the PATH.
matplotlib  a .py script run with `uv run --with matplotlib`, in its own folder; the script writes its
            own image files, and AGENT_PAGES_FIG_OUT names the output folder it should use.
none        figures are off; pages carry no rendered figures.
The backend follows the file type; figure_backend = "none" in the config turns both off.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from .config import Config

NONE_HELP = (
    "figures are off (figure_backend = \"none\" in {path}).\n"
    "Set figure_backend = \"matplotlib\" to run chart scripts with uv, or\n"
    "figure_backend = \"texfig\" with texfig_dir = \"<tex-fig checkout>\" for TikZ figures\n"
    "(https://github.com/sylvainHellin/tex-fig)."
)


def fail(msg: str, code: int = 2):
    print(f"agent-pages: {msg}", file=sys.stderr)
    sys.exit(code)


def build_texfig(cfg: Config, src: Path, out: Path, a) -> int:
    if not cfg.texfig_dir:
        fail(f".tex figures need tex-fig: set texfig_dir in {cfg.path} to a checkout of "
             "https://github.com/sylvainHellin/tex-fig")
    build = cfg.texfig_dir / "examples" / "build.sh"
    if not build.is_file():
        fail(f"{build} not found; is texfig_dir a tex-fig checkout?")
    missing = [t for t in ("tectonic", "pdftoppm") if not shutil.which(t)]
    if missing:
        fail(f"tex-fig's build.sh needs {' and '.join(missing)} on the PATH")
    env = dict(os.environ, OUT=str(out))
    if a.palette:
        env["PALETTE"] = a.palette
    if a.font:
        env["FONT"] = a.font
    if a.steps:
        env["STEPS"] = str(a.steps)
    cmd = ["bash", str(build), str(src)]
    if a.dpi:
        cmd.append(str(a.dpi))
    return subprocess.call(cmd, env=env)


def build_matplotlib(cfg: Config, src: Path, out: Path, a) -> int:
    uv = shutil.which("uv")
    if not uv:
        fail("the matplotlib backend runs scripts with uv, which is not on the PATH")
    env = dict(os.environ, AGENT_PAGES_FIG_OUT=str(out))
    return subprocess.call([uv, "run", "--no-project", "--quiet", "--with", "matplotlib", str(src)],
                           cwd=src.parent, env=env)


def cmd_fig_build(cfg: Config, a) -> None:
    src = Path(a.source).expanduser().absolute()
    if not src.is_file():
        fail(f"{src} is not a file", 1)
    if cfg.figure_backend == "none":
        fail(NONE_HELP.format(path=cfg.path))
    out = Path(a.out).expanduser().absolute() if a.out else src.parent
    out.mkdir(parents=True, exist_ok=True)
    if src.suffix == ".tex":
        sys.exit(build_texfig(cfg, src, out, a))
    if src.suffix == ".py":
        sys.exit(build_matplotlib(cfg, src, out, a))
    fail(f"{src.name}: agent-pages fig builds .tex (texfig) and .py (matplotlib) files", 1)


def add_parser(sub) -> None:
    p = sub.add_parser("fig", help="render figures for pages")
    fsub = p.add_subparsers(dest="fig_cmd", required=True)
    b = fsub.add_parser("build", help="render a .tex (texfig) or .py (matplotlib) figure",
                        description=__doc__, formatter_class=__import__("argparse").RawDescriptionHelpFormatter)
    b.add_argument("source", help="figure source: file.tex or file.py")
    b.add_argument("-o", "--out", help="output folder (default: the source's folder)")
    b.add_argument("--palette", help="texfig: palette (apple, tum, hines; default: tex-fig's)")
    b.add_argument("--font", help="texfig: font (times, helvet, ...; default: tex-fig's)")
    b.add_argument("--dpi", type=int, help="texfig: PNG resolution (default: tex-fig's, 300)")
    b.add_argument("--steps", type=int, help="texfig: one PNG per reveal step")
    b.set_defaults(fn=cmd_fig_build)

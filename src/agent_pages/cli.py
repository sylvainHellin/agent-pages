"""agent-pages: HTML pages an agent writes for a person to read and comment on, reports and lessons.

  agent-pages new <path> [--title T] [--id slug] [--theme T]   create a report page from the template
  agent-pages open <path>                                      open a page in the Mac browser, from either machine
  agent-pages url <path>                                       print the server link of a page
  agent-pages drain                                            Mac only: open the pages another machine queued
  agent-pages lesson new <slug> --title T [...]                create a lesson folder
  agent-pages fig build <file.tex|file.py>                     render a figure (texfig or matplotlib backend)
  agent-pages config                                           print the effective configuration
  agent-pages serve [--host H] [--port P]                      run the server: report pages, lessons, library app

Configuration: ~/.config/agent-pages/config.toml (AGENT_PAGES_CONFIG overrides the path); see config.example.toml.
"""

from __future__ import annotations

import argparse
import sys

from . import config, figures, lessons, report
from .server import app as server


def cmd_config(cfg: config.Config, _args) -> None:
    print(config.describe(cfg))


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="agent-pages", description=__doc__.split("\n\n")[0],
                                 epilog=__doc__.split("\n\n", 1)[1], formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("new", help="create a report page from the template")
    p.add_argument("path")
    p.add_argument("--title", help="sets <title> and the h1")
    p.add_argument("--id", help="data-doc-id slug (default: the file stem)")
    p.add_argument("--theme", help="theme for this page (default: the config's theme)")
    p.set_defaults(fn=report.cmd_new)
    p = sub.add_parser("open", help="open a page in the Mac browser, from either machine")
    p.add_argument("path")
    p.set_defaults(fn=report.cmd_open)
    p = sub.add_parser("url", help="print the server link of a page")
    p.add_argument("path")
    p.set_defaults(fn=report.cmd_url)
    p = sub.add_parser("drain", help="Mac only: open the requests queued by another machine")
    p.set_defaults(fn=report.cmd_drain)
    lessons.add_parser(sub)
    figures.add_parser(sub)
    p = sub.add_parser("config", help="print the effective configuration")
    p.set_defaults(fn=cmd_config)
    server.add_parser(sub)
    return ap


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    try:
        cfg = config.load()
        args.fn(cfg, args)
    except config.ConfigError as e:
        print(f"agent-pages: {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()

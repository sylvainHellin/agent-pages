"""Point existing pages at the repo template instead of an old template folder.

    uv run --project <repo> python scripts/migrate_template_links.py --dry-run --list /var/tmp/agent-pages-migration/list.txt
    uv run --project <repo> python scripts/migrate_template_links.py --backup /var/tmp/agent-pages-migration/backup

Rewrites in every .html/.htm page under the roots (default: the config's roots):
  file://<old template folder>/<file>   ->  file://<repo>/template/<file>   (report.css, report.js, favicon.png, ...)
  ../_assets/theme-tum.css              ->  ../_assets/themes/tum.css       (lesson pages)
The old folders default to ~/Documents/perso/03-resources/templates/report-html (the template before it moved
into the repo) and ~/code/side-projects/pages/template (the repo before its rename to agent-pages); --old,
repeatable, replaces them.
Folders that hold no pages of their own (node_modules, dist, build, .git, sync version folders ...) and the
old template folders themselves are skipped, as are symlinked files and folders.
--backup copies each file it changes to <backup>/<absolute path> before writing it. Standard library only.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

from agent_pages import TEMPLATE_DIR, config

SKIP_DIRS = {
    ".git", ".hg", ".svn", ".stversions", ".stfolder", ".Trash", ".cache", ".venv", "venv", "__pycache__",
    "site-packages", "node_modules", "dist", "build", "_site", ".next", ".svelte-kit", ".nuxt", ".parcel-cache",
}
PAGE_EXT = {".html", ".htm"}
LESSON_RENAMES = {
    '"../_assets/theme-tum.css"': '"../_assets/themes/tum.css"',
}


def default_old() -> list[Path]:
    return [
        Path.home() / "Documents/perso/03-resources/templates/report-html",
        Path.home() / "code/side-projects/pages/template",
    ]


def rewrite(text: str, old_url: str | list[str], new_dir: Path) -> tuple[str, int, list[str]]:
    """Return the rewritten text, the number of links changed and the links left alone (no such file in new_dir)."""
    count, missing = 0, []
    for url in [old_url] if isinstance(old_url, str) else old_url:
        out, i = [], 0
        while True:
            j = text.find(url, i)
            if j < 0:
                out.append(text[i:])
                break
            out.append(text[i:j])
            k = j + len(url)
            end = k
            while end < len(text) and text[end] not in "\"' )>\n":
                end += 1
            name = text[k:end]
            if name and (new_dir / name).is_file():
                out.append(new_dir.as_uri() + "/" + name)
                count += 1
            else:
                out.append(text[j:end])
                missing.append(url + name)
            i = end
        text = "".join(out)
    for a, b in LESSON_RENAMES.items():
        n = text.count(a)
        if n:
            text = text.replace(a, b)
            count += n
    return text, count, missing


def pages_under(root: Path, skip: set[Path]):
    for dirpath, dirnames, filenames in os.walk(root):
        d = Path(dirpath)
        dirnames[:] = sorted(n for n in dirnames if n not in SKIP_DIRS and (d / n) not in skip and not (d / n).is_symlink())
        for n in sorted(filenames):
            p = d / n
            if p.suffix.lower() in PAGE_EXT and not p.is_symlink():
                yield p


def backup_file(p: Path, backup: Path) -> None:
    dest = backup / p.resolve().relative_to("/")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, dest)


def migrate(roots: list[Path], old_dir: Path | list[Path], new_dir: Path, dry_run: bool,
            backup: Path | None) -> list[tuple[Path, int, list[str]]]:
    old_dirs = [old_dir] if isinstance(old_dir, Path) else list(old_dir)
    old_urls = [d.as_uri() + "/" for d in old_dirs if d.absolute() != new_dir.absolute()]
    skip = {new_dir, new_dir.resolve(), *old_dirs, *(d.resolve() for d in old_dirs)}
    changed, seen = [], set()
    for root in roots:
        for p in pages_under(root, skip):
            real = p.resolve()
            if real in seen:
                continue
            seen.add(real)
            try:
                text = p.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if not any(u in text for u in old_urls) and not any(a in text for a in LESSON_RENAMES):
                continue
            new, n, missing = rewrite(text, old_urls, new_dir)
            if n == 0:
                if missing:
                    changed.append((p, 0, missing))
                continue
            changed.append((p, n, missing))
            if dry_run:
                continue
            if backup:
                backup_file(p, backup)
            tmp = p.with_name(f".{p.name}.agent-pages-migrate.tmp")
            tmp.write_text(new, encoding="utf-8")
            shutil.copymode(p, tmp)
            os.replace(tmp, p)
    return changed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0], epilog=__doc__.split("\n\n", 1)[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("roots", nargs="*", type=Path, help="folders to scan (default: the config's roots)")
    ap.add_argument("--old", type=Path, action="append",
                    help="old template folder, repeatable (default: the report-html folder and ~/code/side-projects/pages/template)")
    ap.add_argument("--new", type=Path, default=TEMPLATE_DIR, help="new template folder (default: the repo template)")
    ap.add_argument("--dry-run", action="store_true", help="list the pages without changing them")
    ap.add_argument("--list", type=Path, help="write the list of pages (one per line) to this file")
    ap.add_argument("--backup", type=Path, help="copy each page to <backup>/<absolute path> before changing it")
    ap.add_argument("--no-backup", action="store_true", help="change pages without a backup")
    a = ap.parse_args(argv)
    if not a.dry_run and not a.backup and not a.no_backup:
        ap.error("a real run needs --backup <dir> (or --no-backup)")
    roots = [r.expanduser() for r in a.roots] or list(config.load().roots.values())
    if not roots:
        ap.error("no roots given and none in the config")
    olds = [o.expanduser() for o in a.old] if a.old else default_old()
    changed = migrate(roots, olds, a.new.expanduser(), a.dry_run, a.backup)
    links = sum(n for _, n, _ in changed)
    for p, n, missing in changed:
        print(f"{n:3d}  {p}")
        for m in missing:
            print(f"     left alone (not in the new template): {m}")
    if a.list:
        a.list.parent.mkdir(parents=True, exist_ok=True)
        a.list.write_text("".join(f"{p}\n" for p, n, _ in changed if n), encoding="utf-8")
    verb = "would change" if a.dry_run else "changed"
    print(f"{verb} {links} links in {sum(1 for _, n, _ in changed if n)} pages", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

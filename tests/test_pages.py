"""Config defaults, `agent-pages new` with an empty config, and the template link migration.

    uv run python -m unittest discover -s tests
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from agent_pages import REPO, TEMPLATE_DIR, cli, config

_spec = importlib.util.spec_from_file_location("migrate", REPO / "scripts" / "migrate_template_links.py")
migrate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migrate)


class TempHome(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name).resolve()
        self.cfg_file = self.tmp / "config.toml"
        env = {"AGENT_PAGES_CONFIG": str(self.cfg_file), "XDG_DATA_HOME": str(self.tmp / "data")}
        self._env = mock.patch.dict(os.environ, env)
        self._env.start()

    def tearDown(self):
        self._env.stop()
        self._tmp.cleanup()

    def run_cli(self, *argv: str) -> str:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            try:
                cli.main(list(argv))
            except SystemExit as e:
                if e.code not in (None, 0):
                    raise
        return out.getvalue()


class ConfigDefaults(TempHome):
    def check_defaults(self, cfg: config.Config):
        self.assertEqual(cfg.host, "127.0.0.1")
        self.assertEqual(cfg.port, 8320)
        self.assertEqual(cfg.base_url, "http://127.0.0.1:8320")
        self.assertEqual(cfg.roots, {})
        self.assertEqual(cfg.lessons_dir, self.tmp / "data" / "agent-pages" / "lessons")
        self.assertEqual(cfg.theme, "plain")
        self.assertEqual(cfg.lesson_theme, "plain")
        self.assertEqual(cfg.app_theme, "plain")
        self.assertTrue(cfg.vim_default)
        self.assertEqual(cfg.figure_backend, "matplotlib")
        self.assertIsNone(cfg.texfig_dir)
        self.assertIsNone(cfg.vault)
        self.assertIsNone(cfg.remote_open.queue)
        self.assertEqual(cfg.remote_open.synced, [])
        self.assertEqual(cfg.theme_css(), TEMPLATE_DIR / "themes" / "plain.css")

    def test_missing_file(self):
        cfg = config.load()
        self.assertFalse(cfg.exists)
        self.check_defaults(cfg)

    def test_empty_file(self):
        self.cfg_file.write_text("")
        cfg = config.load()
        self.assertTrue(cfg.exists)
        self.check_defaults(cfg)

    def test_values(self):
        self.cfg_file.write_text(
            'port = 9000\ntheme = "tum"\nvim_default = false\n[roots]\ndocs = "~/Documents"\n'
            '[remote_open.synced]\n"~/Documents" = "/Users/x/Documents"\n'
        )
        cfg = config.load()
        self.assertEqual(cfg.base_url, "http://127.0.0.1:9000")
        self.assertEqual(cfg.lesson_theme, "tum")
        self.assertEqual(cfg.app_theme, "tum")
        self.assertFalse(cfg.vim_default)
        self.assertEqual(cfg.roots["docs"], Path.home() / "Documents")
        self.assertEqual(cfg.remote_open.synced, [(Path.home() / "Documents", Path("/Users/x/Documents"))])
        self.cfg_file.write_text('theme = "plain"\nlesson_theme = "tum"\napp_theme = "basenord"\n')
        cfg = config.load()
        self.assertEqual((cfg.lesson_theme, cfg.app_theme), ("tum", "basenord"))

    def test_bad_values(self):
        for text in ('port = "80"', 'figure_backend = "svg"', "nope = 1", 'vim_default = "no"', "[remote_open]\nx = 1"):
            self.cfg_file.write_text(text)
            with self.assertRaises(config.ConfigError, msg=text):
                config.load()

    def test_unknown_theme(self):
        self.cfg_file.write_text('theme = "nope"')
        with self.assertRaises(config.ConfigError):
            config.load().theme_css()


class NewPage(TempHome):
    def test_new_with_empty_config(self):
        self.cfg_file.write_text("")
        dest = self.tmp / "out" / "2026-11-11_status.html"
        printed = self.run_cli("new", str(dest), "--title", "Status & next steps")
        self.assertEqual(printed.strip(), str(dest))
        page = dest.read_text()
        base = TEMPLATE_DIR.as_uri()
        self.assertIn(f'href="{base}/report.css"', page)
        self.assertIn(f'src="{base}/report.js"', page)
        self.assertIn(f'href="{base}/favicon.png"', page)
        self.assertIn(f'href="{base}/themes/plain.css"', page)
        self.assertIn('data-doc-id="2026-11-11_status"', page)
        self.assertIn("<title>Status &amp; next steps</title>", page)
        self.assertIn("<h1>Status &amp; next steps</h1>", page)
        self.assertNotIn("data-vim-default", page)
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stderr(io.StringIO()):
                self.run_cli("new", str(dest))

    def test_new_with_theme_and_vim_off(self):
        self.cfg_file.write_text('theme = "tum"\nvim_default = false\n')
        dest = self.tmp / "p.html"
        self.run_cli("new", str(dest), "--id", "custom-id")
        page = dest.read_text()
        self.assertIn(f'href="{TEMPLATE_DIR.as_uri()}/themes/tum.css"', page)
        self.assertIn('<html data-vim-default="off"', page)
        self.assertIn('data-doc-id="custom-id"', page)

    def test_lesson_new(self):
        self.cfg_file.write_text(f'lessons_dir = "{self.tmp / "lessons"}"\nlesson_theme = "tum"\n')
        self.run_cli("lesson", "new", "Row vs column", "--title", "Rows", "--date", "2026-11-11")
        d = self.tmp / "lessons" / "2026-11-11_row-vs-column"
        page = (d / "index.html").read_text()
        self.assertIn('href="../_assets/report.css"', page)
        self.assertIn('href="../_assets/themes/tum.css"', page)
        self.assertTrue((d / "lesson.json").is_file())
        self.assertEqual((self.tmp / "lessons" / "_assets").resolve(), TEMPLATE_DIR.resolve())


class Migration(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name).resolve()
        self.old = self.tmp / "old-template"
        self.old.mkdir()
        old = self.old.as_uri()
        self.root = self.tmp / "docs"
        self.page = self.root / "a" / "report.html"
        self.page.parent.mkdir(parents=True)
        self.original = (
            f'<link rel="icon" href="{old}/favicon.png">\n<link rel="stylesheet" href="{old}/report.css">\n'
            f'<script src="{old}/report.js"></script>\n<img src="{old}/gone.png">\n'
        )
        self.page.write_text(self.original)
        self.lesson = self.root / "lessons" / "2026-11-04_x" / "index.html"
        self.lesson.parent.mkdir(parents=True)
        self.lesson.write_text('<link rel="stylesheet" href="../_assets/theme-tum.css">\n')
        skipped = self.root / "app" / "node_modules" / "pkg" / "index.html"
        skipped.parent.mkdir(parents=True)
        skipped.write_text(f'<link href="{old}/report.css">')
        (self.root / "plain.html").write_text("<p>no template</p>")

    def tearDown(self):
        self._tmp.cleanup()

    def test_dry_run_changes_nothing(self):
        changed = migrate.migrate([self.root], self.old, TEMPLATE_DIR, dry_run=True, backup=None)
        self.assertEqual(sorted(p for p, n, _ in changed if n), sorted([self.page, self.lesson]))
        self.assertEqual(self.page.read_text(), self.original)

    def test_rewrite_with_backup(self):
        backup = self.tmp / "backup"
        changed = migrate.migrate([self.root], self.old, TEMPLATE_DIR, dry_run=False, backup=backup)
        counts = {p: n for p, n, _ in changed}
        self.assertEqual(counts, {self.page: 3, self.lesson: 1})
        text = self.page.read_text()
        new = TEMPLATE_DIR.as_uri()
        self.assertIn(f'href="{new}/report.css"', text)
        self.assertIn(f'src="{new}/report.js"', text)
        self.assertIn(f'href="{new}/favicon.png"', text)
        self.assertIn(f'src="{self.old.as_uri()}/gone.png"', text)  # no such file in the new template: left alone
        self.assertEqual(self.lesson.read_text(), '<link rel="stylesheet" href="../_assets/themes/tum.css">\n')
        self.assertEqual((backup / self.page.relative_to("/")).read_text(), self.original)
        node = self.root / "app" / "node_modules" / "pkg" / "index.html"
        self.assertIn(self.old.as_uri(), node.read_text())
        again = migrate.migrate([self.root], self.old, TEMPLATE_DIR, dry_run=False, backup=None)
        self.assertEqual([p for p, n, _ in again if n], [])

    def test_several_old_folders(self):
        older = self.tmp / "side-projects" / "pages" / "template"  # the repo before its rename
        page = self.root / "b" / "plan.html"
        page.parent.mkdir(parents=True)
        page.write_text(f'<link rel="stylesheet" href="{older.as_uri()}/report.css">\n')
        changed = migrate.migrate([self.root], [self.old, older], TEMPLATE_DIR, dry_run=False, backup=None)
        counts = {p: n for p, n, _ in changed}
        self.assertEqual(counts, {self.page: 3, self.lesson: 1, page: 1})
        self.assertEqual(page.read_text(), f'<link rel="stylesheet" href="{TEMPLATE_DIR.as_uri()}/report.css">\n')
        self.assertEqual(migrate.default_old()[1], Path.home() / "code/side-projects/pages/template")


if __name__ == "__main__":
    unittest.main()


_bspec = importlib.util.spec_from_file_location("bundle", TEMPLATE_DIR / "bundle.py")
bundle = importlib.util.module_from_spec(_bspec)
_bspec.loader.exec_module(bundle)


class Bundle(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name).resolve()
        (self.tmp / "fig.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
        t = TEMPLATE_DIR.as_uri()
        self.page = self.tmp / "page.html"
        self.page.write_text(
            f'<link rel="icon" href="{t}/favicon.png">\n<link rel="stylesheet" href="{t}/report.css">\n'
            f'<img src="fig.png"><img src="{(self.tmp / "fig.png").as_uri()}"><img src="https://x.org/a.png">\n'
            f'<img src="gone.png">\n<script src="{t}/report.js"></script>\n'
        )

    def tearDown(self):
        self._tmp.cleanup()

    def test_fonts_and_local_images_become_data_uris(self):
        with contextlib.redirect_stderr(io.StringIO()) as err:
            html = bundle.bundle(self.page)
        self.assertNotIn('url("fonts/', html)
        self.assertIn("data:font/woff2;base64,", html)
        self.assertEqual(html.count('<img src="data:image/png;base64,'), 2)
        self.assertIn('<img src="https://x.org/a.png">', html)
        self.assertIn('<img src="gone.png">', html)
        self.assertIn("gone.png", err.getvalue())
        self.assertNotIn(TEMPLATE_DIR.as_uri(), html)

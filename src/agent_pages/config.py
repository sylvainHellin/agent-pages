"""User configuration: ~/.config/agent-pages/config.toml, or the file AGENT_PAGES_CONFIG names.

Every key has a default, so a missing or empty file works on localhost.
See config.example.toml at the repo root for the keys and what they do.
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from . import THEMES_DIR

FIGURE_BACKENDS = ("texfig", "matplotlib", "none")
KNOWN_KEYS = {
    "host", "port", "base_url", "roots", "lessons_dir", "theme", "lesson_theme", "app_theme",
    "vim_default", "figure_backend", "texfig_dir", "vault", "remote_open", "template_aliases",
}
REMOTE_OPEN_KEYS = {"queue", "mac_home", "log", "synced"}


class ConfigError(Exception):
    pass


@dataclass
class RemoteOpen:
    """How `agent-pages open` on a machine without a browser reaches the Mac (queue folder carried by Syncthing)."""

    queue: Path | None = None
    mac_home: Path | None = None
    log: Path | None = None
    synced: list[tuple[Path, Path]] = field(default_factory=list)  # (local folder, Mac folder)


@dataclass
class Config:
    path: Path
    exists: bool
    host: str = "127.0.0.1"
    port: int = 8320
    base_url: str = ""
    roots: dict[str, Path] = field(default_factory=dict)
    lessons_dir: Path = Path()
    theme: str = "plain"
    lesson_theme: str = "plain"
    app_theme: str = "plain"  # the library app's colours and fonts
    vim_default: bool = True
    figure_backend: str = "matplotlib"
    texfig_dir: Path | None = None
    vault: Path | None = None
    template_aliases: list[Path] = field(default_factory=list)  # old template folders the server maps to template/
    remote_open: RemoteOpen = field(default_factory=RemoteOpen)

    def theme_css(self, name: str | None = None) -> Path:
        """The stylesheet of a theme: a name from template/themes/ or a path to a .css file."""
        return theme_css(name or self.theme)


def config_path() -> Path:
    env = os.environ.get("AGENT_PAGES_CONFIG")
    if env:
        return Path(env).expanduser()
    base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config").expanduser()
    return base / "agent-pages" / "config.toml"


def default_lessons_dir() -> Path:
    base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share").expanduser()
    return base / "agent-pages" / "lessons"


def theme_css(theme: str) -> Path:
    if not theme:
        raise ConfigError("theme is empty")
    if "/" not in theme and not theme.endswith(".css"):
        css = THEMES_DIR / f"{theme}.css"
        if not css.is_file():
            names = ", ".join(sorted(p.stem for p in THEMES_DIR.glob("*.css")))
            raise ConfigError(f"unknown theme {theme!r}; built-in themes: {names}, or a path to a .css file")
        return css
    css = Path(theme).expanduser()
    if not css.is_file():
        raise ConfigError(f"theme stylesheet not found: {css}")
    return css.resolve()


def _str(data: dict, key: str, where: str) -> str | None:
    v = data.get(key)
    if v is None:
        return None
    if not isinstance(v, str):
        raise ConfigError(f"{where}{key} must be a string, got {type(v).__name__}")
    return v


def _path(data: dict, key: str, where: str = "") -> Path | None:
    v = _str(data, key, where)
    return Path(v).expanduser() if v else None


def load(path: Path | None = None) -> Config:
    path = path or config_path()
    data: dict = {}
    exists = path.is_file()
    if exists:
        try:
            data = tomllib.loads(path.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as e:
            raise ConfigError(f"{path}: {e}") from e
    unknown = set(data) - KNOWN_KEYS
    if unknown:
        raise ConfigError(f"{path}: unknown keys {', '.join(sorted(unknown))}")

    cfg = Config(path=path, exists=exists)
    cfg.host = _str(data, "host", "") or cfg.host
    port = data.get("port", cfg.port)
    if not isinstance(port, int) or isinstance(port, bool) or not 0 < port < 65536:
        raise ConfigError(f"{path}: port must be an integer between 1 and 65535")
    cfg.port = port
    cfg.base_url = (_str(data, "base_url", "") or f"http://{cfg.host}:{cfg.port}").rstrip("/")

    roots = data.get("roots", {})
    if not isinstance(roots, dict) or not all(isinstance(v, str) for v in roots.values()):
        raise ConfigError(f"{path}: roots must be a table of name = \"folder\"")
    cfg.roots = {name: Path(v).expanduser() for name, v in roots.items()}

    cfg.lessons_dir = _path(data, "lessons_dir") or default_lessons_dir()
    cfg.theme = _str(data, "theme", "") or "plain"
    cfg.lesson_theme = _str(data, "lesson_theme", "") or cfg.theme
    cfg.app_theme = _str(data, "app_theme", "") or cfg.lesson_theme

    vim = data.get("vim_default", True)
    if not isinstance(vim, bool):
        raise ConfigError(f"{path}: vim_default must be true or false")
    cfg.vim_default = vim

    backend = _str(data, "figure_backend", "") or "matplotlib"
    if backend not in FIGURE_BACKENDS:
        raise ConfigError(f"{path}: figure_backend must be one of {', '.join(FIGURE_BACKENDS)}")
    cfg.figure_backend = backend
    cfg.texfig_dir = _path(data, "texfig_dir")
    cfg.vault = _path(data, "vault")
    aliases = data.get("template_aliases", [])
    if not isinstance(aliases, list) or not all(isinstance(v, str) and v for v in aliases):
        raise ConfigError(f"{path}: template_aliases must be a list of folders")
    cfg.template_aliases = [Path(v).expanduser() for v in aliases]

    ro = data.get("remote_open", {})
    if not isinstance(ro, dict):
        raise ConfigError(f"{path}: remote_open must be a table")
    unknown = set(ro) - REMOTE_OPEN_KEYS
    if unknown:
        raise ConfigError(f"{path}: unknown keys in remote_open: {', '.join(sorted(unknown))}")
    synced = ro.get("synced", {})
    if not isinstance(synced, dict) or not all(isinstance(v, str) for v in synced.values()):
        raise ConfigError(f"{path}: remote_open.synced must be a table of \"local folder\" = \"Mac folder\"")
    cfg.remote_open = RemoteOpen(
        queue=_path(ro, "queue", "remote_open."),
        mac_home=_path(ro, "mac_home", "remote_open."),
        log=_path(ro, "log", "remote_open."),
        synced=[(Path(k).expanduser(), Path(v)) for k, v in synced.items()],
    )
    return cfg


def describe(cfg: Config) -> str:
    """The effective configuration, one key per line."""
    ro = cfg.remote_open
    lines = [
        f"# {cfg.path}{'' if cfg.exists else ' (missing: defaults)'}",
        f"host = {cfg.host!r}",
        f"port = {cfg.port}",
        f"base_url = {cfg.base_url!r}",
        f"lessons_dir = {str(cfg.lessons_dir)!r}",
        f"theme = {cfg.theme!r}",
        f"lesson_theme = {cfg.lesson_theme!r}",
        f"app_theme = {cfg.app_theme!r}",
        f"vim_default = {str(cfg.vim_default).lower()}",
        f"figure_backend = {cfg.figure_backend!r}",
        f"texfig_dir = {str(cfg.texfig_dir) if cfg.texfig_dir else ''!r}",
        f"vault = {str(cfg.vault) if cfg.vault else ''!r}",
        f"template_aliases = {[str(p) for p in cfg.template_aliases]!r}",
        "[roots]",
        *(f"{k} = {str(v)!r}" for k, v in cfg.roots.items()),
        "[remote_open]",
        f"queue = {str(ro.queue) if ro.queue else ''!r}",
        f"mac_home = {str(ro.mac_home) if ro.mac_home else ''!r}",
        f"log = {str(ro.log) if ro.log else ''!r}",
        "[remote_open.synced]",
        *(f"{str(a)!r} = {str(b)!r}" for a, b in ro.synced),
    ]
    return "\n".join(lines)

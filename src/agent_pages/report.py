"""agent-pages new | open | url | drain: create report pages, open them in the Mac browser, print their links.

On the Mac, `open` runs macOS `open -g` directly, so the browser gets the tab without coming to the front.
On another machine (a home server), `open` writes a JSON request into the queue folder of the config's
[remote_open] table, which a file sync (Syncthing) carries to the Mac; there a LaunchAgent runs
`agent-pages drain` when the folder changes, waits for the page itself to arrive, opens it and deletes the request.
Without [remote_open], `open` on Linux falls back to xdg-open.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import secrets
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote

from .config import Config
from .page import report_page

IS_MAC = platform.system() == "Darwin"
# Paths a file sync never carries inside the synced folders.
UNSYNCED_PARTS = {".stversions", ".stfolder"}
# What a queued request may open; anything else (an .app, a .command) is refused on the Mac.
OPENABLE = {".html", ".htm", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
WAIT_S = 120  # how long one drain run waits for pages still in transit
STALE_S = 24 * 3600  # requests older than this are dropped unopened


def die(msg: str, code: int = 1):
    print(f"agent-pages: {msg}", file=sys.stderr)
    sys.exit(code)


def state_dir() -> Path:
    base = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local/state").expanduser()
    return base / "agent-pages" / "open"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def mac_path_for(cfg: Config, path: Path) -> Path | None:
    """Map a resolved local path to its Mac path, or None when no synced folder holds it."""
    for local_root, mac_root in cfg.remote_open.synced:
        try:
            rel = path.relative_to(local_root.resolve())
        except ValueError:
            continue
        if UNSYNCED_PARTS & set(rel.parts):
            return None
        return mac_root / rel
    return None


def synced_hint(cfg: Config) -> str:
    folders = ", ".join(str(a) for a, _ in cfg.remote_open.synced) or "(none configured)"
    return f"save it in a folder the sync mirrors to the Mac: {folders}"


# ------------------------------------------------------------------------- new


def cmd_new(cfg: Config, args) -> None:
    dest = Path(args.path).expanduser().absolute()
    if dest.exists():
        die(f"{dest} already exists; refusing to overwrite")
    page = report_page(args.title, args.id or dest.stem, cfg.theme_css(args.theme), cfg.vim_default)
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(dest, "x", encoding="utf-8") as f:
            f.write(page)
    except FileExistsError:
        die(f"{dest} already exists; refusing to overwrite")
    if not IS_MAC and cfg.remote_open.synced and mac_path_for(cfg, dest.resolve()) is None:
        print(f"agent-pages: warning: {dest} does not reach the Mac; {synced_hint(cfg)}", file=sys.stderr)
    print(dest)


# ------------------------------------------------------------------------ open


def cmd_open(cfg: Config, args) -> None:
    target = Path(args.path).expanduser().absolute()
    if not target.is_file():
        die(f"{target} is not a file")
    if IS_MAC:
        sys.exit(subprocess.call(["open", "-g", str(target)]))

    ro = cfg.remote_open
    if not (ro.queue and ro.synced):
        opener = shutil.which("xdg-open")
        if opener:
            sys.exit(subprocess.call([opener, str(target)]))
        die("no browser here and no [remote_open] queue in the config; see config.example.toml")

    real = target.resolve()
    mac = mac_path_for(cfg, real)
    if mac is None:
        die(f"{target} is not in a folder the sync mirrors to the Mac; {synced_hint(cfg)}")
    if real.suffix.lower() not in OPENABLE:
        die(f"{real.suffix or 'files without an extension'} cannot be opened remotely; "
            f"allowed: {' '.join(sorted(OPENABLE))}")

    now = time.time()
    req_id = f"{time.strftime('%Y%m%dT%H%M%S', time.gmtime(now))}-{secrets.token_hex(4)}"
    request = {
        "id": req_id,
        "server_path": str(real),
        "mac_path": str(mac),
        "sha256": sha256(real),
        "size": real.stat().st_size,
        "time": now,
        "time_iso": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(now)),
        "host": socket.gethostname(),
    }
    ro.queue.mkdir(parents=True, exist_ok=True)
    final = ro.queue / f"{req_id}.json"
    part = ro.queue / f".{req_id}.json.part"  # hidden and not .json, so drain never reads it half-written
    part.write_text(json.dumps(request, indent=2) + "\n", encoding="utf-8")
    os.replace(part, final)
    print(f"queued for the Mac: {mac}")
    print("it opens there once the sync has delivered the page (usually a few seconds)")


# ----------------------------------------------------------------------- drain


class Drain:
    def __init__(self, cfg: Config):
        ro = cfg.remote_open
        if not ro.queue:
            die("remote_open.queue is not set in the config, so there is no queue to drain")
        self.queue = ro.queue
        self.mac_home = ro.mac_home or Path.home()
        self.log_path = ro.log or Path.home() / "Library/Logs/agent-pages-open.log"
        self.state = state_dir()

    def log(self, msg: str) -> None:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")


def is_request(p: Path) -> bool:
    n = p.name
    return p.is_file() and n.endswith(".json") and not n.startswith((".", "~")) and ".sync-conflict-" not in n


def remove(p: Path) -> None:
    try:
        p.unlink()
    except FileNotFoundError:
        pass


class Done:
    """Ids already opened, so a request the sync delivers twice opens once."""

    def __init__(self, state: Path):
        self.path = state / "opened.txt"
        try:
            self.ids = self.path.read_text().split()
        except FileNotFoundError:
            self.ids = []

    def __contains__(self, req_id: str) -> bool:
        return req_id in self.ids

    def add(self, req_id: str) -> None:
        self.ids = (self.ids + [req_id])[-500:]
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text("\n".join(self.ids) + "\n")
        os.replace(tmp, self.path)


def load_request(p: Path) -> dict | None:
    try:
        req = json.loads(p.read_text(encoding="utf-8"))
        req["id"], req["mac_path"], req["time"] = str(req["id"]), str(req["mac_path"]), float(req["time"])
        return req
    except (OSError, ValueError, KeyError, TypeError):
        return None


def check(req: dict) -> str:
    """'ok' when the page on disk is the one requested, 'missing', or 'other' (a different version)."""
    target = Path(req["mac_path"])
    try:
        if not target.is_file():
            return "missing"
        if req.get("sha256") and sha256(target) == req["sha256"]:
            return "ok"
        return "other"
    except OSError:
        return "missing"


def settled(target: Path) -> bool:
    try:
        a = target.stat()
        time.sleep(1)
        b = target.stat()
    except OSError:
        return False
    return a.st_size == b.st_size and a.st_mtime == b.st_mtime and a.st_size > 0


def open_on_mac(d: Drain, p: Path, req: dict, done: Done, note: str = "") -> None:
    target = Path(req["mac_path"])
    rc = subprocess.call(["/usr/bin/open", "-g", str(target)])
    if rc == 0:
        done.add(req["id"])
        d.log(f"opened {target} (request {req['id']} from {req.get('host', '?')}){note}")
    else:
        d.log(f"open failed with exit {rc}: {target} (request {req['id']}); dropped")
    remove(p)


def cmd_drain(cfg: Config, _args) -> None:
    if not IS_MAC:
        die("drain runs on the Mac only")
    import fcntl

    d = Drain(cfg)
    d.state.mkdir(parents=True, exist_ok=True)
    d.queue.mkdir(parents=True, exist_ok=True)
    lock = open(d.state / "lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return  # another run is draining; it rescans the queue until it is empty

    done = Done(d.state)
    start = time.time()
    waiting_logged: set[str] = set()
    while True:
        pending = []
        for p in sorted(d.queue.iterdir()):
            if not is_request(p):
                continue
            req = load_request(p)
            if req is None:
                d.log(f"unreadable request {p.name}; dropped")
                remove(p)
                continue
            if req["id"] in done:
                remove(p)
                continue
            age = time.time() - req["time"]
            if age > STALE_S:
                d.log(f"stale request {req['id']} ({age / 3600:.0f} h old) for {req['mac_path']}; dropped")
                remove(p)
                continue
            target = Path(req["mac_path"])
            if target.suffix.lower() not in OPENABLE or not target.is_relative_to(d.mac_home):
                d.log(f"refused request {req['id']}: {target} is not an openable file under {d.mac_home}")
                remove(p)
                continue
            state = check(req)
            if state == "ok" and settled(target):
                open_on_mac(d, p, req, done)
                continue
            pending.append((p, req, state))

        if not pending:
            return
        if time.time() - start >= WAIT_S:
            for p, req, state in pending:
                if state == "other" and settled(Path(req["mac_path"])):
                    open_on_mac(d, p, req, done, note=f"; content differs from the request after {WAIT_S} s, opened what is there")
                else:
                    d.log(f"page not here after {WAIT_S} s: {req['mac_path']} (request {req['id']}); retrying on the next run")
            return
        for p, req, state in pending:
            if req["id"] not in waiting_logged:
                waiting_logged.add(req["id"])
                d.log(f"waiting for {req['mac_path']} ({state}, request {req['id']})")
        time.sleep(2)


# ------------------------------------------------------------------------- url


def page_url(cfg: Config, path: Path) -> str:
    """The server link of a file under one of the configured roots (raises ValueError otherwise)."""
    real = path.expanduser().absolute().resolve()
    for name, root in cfg.roots.items():
        try:
            rel = real.relative_to(root.resolve())
        except ValueError:
            continue
        if any(p.startswith(".") for p in rel.parts):
            raise ValueError(f"{real} sits in a hidden folder, which the server does not serve")
        return f"{cfg.base_url}/{name}/{quote(rel.as_posix())}"
    roots = ", ".join(f"{k}={v}" for k, v in cfg.roots.items()) or "none configured"
    raise ValueError(f"{real} is outside the served roots ({roots}), so it has no link")


def cmd_url(cfg: Config, args) -> None:
    real = Path(args.path).expanduser().absolute().resolve()
    if not real.is_file():
        die(f"{real} is not a file")
    try:
        url = page_url(cfg, real)
    except ValueError as e:
        die(str(e))
    if real.suffix.lower() not in {".html", ".htm"}:
        print("agent-pages: warning: the server serves only pages and the files they link", file=sys.stderr)
    print(url)

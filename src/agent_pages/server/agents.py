"""Send to agent: a page's comment export goes to the agent session that wrote it, queued until its turn ends.

The agents: every pi with the agent-pages-inbox extension holds one SSE stream,
GET /api/agents/listen?session&pid&host&harness&where. The server keeps one stream per session id (a new one gets
the session, the old one gets the event `superseded` and is closed), writes a comment line every HEARTBEAT_S, and
select()s the socket so a closed connection drops its entry at once. The registration is also kept in
<data>/agents/<session>.json; DELETE /api/agents/<session> (the extension's session_shutdown) removes it, a pi that
dies without one leaves it behind.

The sends: POST /api/send {page, id, markdown[, new]} stores <data>/sends/<id>.json (the id is the client's, so a
repeat is the same send) and the export beside it as <id>.md, then picks a route and answers at once:
  live      a listener holds one of the page's sessions (newest first): the event `send` {id, markdown_url} goes to
            it, the extension fetches the markdown, claims the send (POST /api/agents/claim/<id> {pid, host}: 200
            once, and again only to that same pi retrying a lost answer), queues it as a follow-up and reports
            POST /api/agents/started/<id> when it starts
  pending   a session is registered but not connected (a live local pid, or another host's registration never
            closed), a Paseo agent holding the session is running, or the server started less than GRACE_S ago;
            the send waits for that session's stream and is pushed when it connects
  paseo     an idle Paseo agent holds the session: the server claims the send and runs `send` ([harness.paseo])
  resuming  a pi session file on this machine (one match, header cwd present, untouched for FRESH_S): the server
            claims it, imports the session into Paseo with --cwd pages_dir, then sends
  failed    the session file was written in the last FRESH_S, or its working folder is gone
  none      none of these: the app offers a new agent, POST /api/send {..., "new": true}, which runs `new` in the
            page's folder and adds the new agent's session to the page
POST /api/agents/release/<id> hands a claimed send that did not start back (pending, pushed again); a new
registration of the session takes back its claimed sends that never started when their claimer is gone: a dead pid on
this host, or for a claimer on another host a registration from that host with another pid. GET /api/sends?page=<id> lists
a page's sends and GET /api/sends/<id>/markdown serves the export.

The page is listed as sent (library.mark_sent) when the delivery starts: POST /api/agents/started for a pi's
send, the end of the Paseo command for the server's own; it reads as open once the agent revises its file. A claim,
a release or a claim taken back changes nothing on the page.

Commands run as argument lists with no shell, never with anything from the page's HTML besides session ids that
are UUIDs and the review id.
"""

from __future__ import annotations

import json
import os
import re
import select
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

from ..config import PLACEHOLDER_RE, default_paseo
from ..page import add_session
from . import library

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
SEND_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
REVIEW_ID_RE = re.compile(r"^r[0-9a-f]{16}$")
WHERE_RE = re.compile(r"^[A-Za-z0-9._:@/+-]{0,200}$")
HOST_RE = re.compile(r"^[A-Za-z0-9._-]{1,253}$")
HARNESSES = ("paseo", "herdr", "pi")
HEARTBEAT_S = 20.0
GRACE_S = 60.0  # after a start, the agents get this long to reconnect before a send falls back
FRESH_S = 120.0  # a session file written this recently may be open in a pi without the extension
MD_LIMIT = 600_000
COMMAND_S = 120  # one Paseo command
SESSION_WAIT_S = 30  # how long a new agent gets to name its session
SERVER_ROUTES = ("paseo", "resuming", "new")  # sends the server claims itself
DROP_ENV = ("PASEO_AGENT_ID", "PASEO_AGENT_CWD")  # set in an agent's shell, they would pull new agents into it

DATA = library.DATA
AGENTS = DATA / "agents"
SENDS = DATA / "sends"
PAGES_DIR = Path.home() / "pages"
COMMANDS: dict[str, list[str]] = {}
STARTED = time.time()
HOST = socket.gethostname()

_lock = threading.RLock()
_live: dict[str, "Listener"] = {}
_inflight: set[str] = set()  # send ids being routed: a repeat meanwhile is refused, never routed twice


class SendError(ValueError):
    """A request the server refuses (400)."""


def configure(data_dir: Path, pages_dir: Path, commands: dict[str, list[str]] | None = None) -> None:
    global DATA, AGENTS, SENDS, PAGES_DIR, COMMANDS, STARTED
    DATA = Path(data_dir)
    AGENTS = DATA / "agents"
    SENDS = DATA / "sends"
    PAGES_DIR = Path(pages_dir)
    COMMANDS = {**default_paseo(), **(commands or {})}
    STARTED = time.time()
    close_all()


RESTARTED = "the server restarted during delivery; check the agent before sending again"


def start() -> None:
    """Fail the server's own deliveries a restart cut off; route the sends still waiting for the start grace once
    it ends."""
    with _lock:
        for rec in _records():
            if rec.get("state") == "claimed" and rec.get("route") in SERVER_ROUTES and not rec.get("started_at"):
                # the Paseo command may or may not have run: never retried, the reader checks the agent
                rec.update(state="failed", error=RESTARTED)
                _save(rec)
    t = threading.Timer(max(0.0, STARTED + GRACE_S - time.time()) + 0.5, after_grace)
    t.daemon = True
    t.start()


def close_all() -> None:
    with _lock:
        listeners = list(_live.values())
        _live.clear()
    for lst in listeners:
        lst.put(b"", close=True)


# ---------- files ----------

def _read(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


def _reg_path(session: str) -> Path:
    return AGENTS / f"{session}.json"


def _send_path(send_id: str) -> Path:
    return SENDS / f"{send_id}.json"


def _load(send_id: str) -> dict | None:
    return _read(_send_path(send_id)) if SEND_ID_RE.match(send_id or "") else None


def _save(rec: dict) -> None:
    _write(_send_path(rec["id"]), rec)


def _records() -> list[dict]:
    if not SENDS.is_dir():
        return []
    return [r for r in (_read(p) for p in SENDS.glob("*.json")) if r and SEND_ID_RE.match(str(r.get("id", "")))]


def summary(rec: dict) -> dict:
    """A send as the app sees it."""
    keys = ("id", "page", "url", "state", "route", "where", "harness", "host", "session", "agent", "error",
            "created", "claimed_at", "started_at")
    return {k: rec.get(k) for k in keys}


# ---------- the registry ----------

class Listener:
    """One live SSE stream: its registration and the bytes waiting to be written by its handler thread."""

    def __init__(self, session: str, pid: int, host: str, harness: str, where: str):
        self.reg = {"session": session, "pid": pid, "host": host, "harness": harness, "where": where,
                    "connected_at": time.time(), "last_seen": time.time()}
        self.session = session
        self.out: list[bytes] = []
        self.closing = False
        self.deleted = False  # DELETE received: the registration goes when the stream does
        self.qlock = threading.Lock()
        self.wake_r, self.wake_w = socket.socketpair()

    def put(self, data: bytes, close: bool = False) -> None:
        with self.qlock:
            if data:
                self.out.append(data)
            self.closing = self.closing or close
        try:
            self.wake_w.send(b"x")
        except OSError:
            pass

    def take(self) -> tuple[list[bytes], bool]:
        with self.qlock:
            out, self.out = self.out, []
            return out, self.closing


def live(session: str) -> dict | None:
    """The registration of the stream that holds a session now, else None."""
    with _lock:
        lst = _live.get(session)
        return dict(lst.reg) if lst else None


def _event(rec: dict) -> bytes:
    data = json.dumps({"id": rec["id"], "markdown_url": f"api/sends/{rec['id']}/markdown"})
    return f"event: send\ndata: {data}\n\n".encode()


SUPERSEDED = b"event: superseded\ndata: {}\n\n"


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except (OSError, OverflowError, ValueError):
        return False
    return True


def _registered(session: str) -> dict | None:
    """A registration that is not connected but whose pi may come back: a live local pid, or another host's
    registration that was never closed. A dead local pid's file is dropped."""
    reg = _read(_reg_path(session))
    if not reg:
        return None
    if reg.get("host") != HOST:
        return reg
    pid = reg.get("pid")
    if isinstance(pid, int) and pid > 0 and _alive(pid):
        return reg
    try:
        _reg_path(session).unlink()
    except OSError:
        pass
    return None


def _params(query: dict) -> tuple[str, int, str, str, str]:
    def one(k: str) -> str:
        return (query.get(k) or [""])[0].strip()

    session, host, harness, where = one("session"), one("host"), one("harness"), one("where")
    if not UUID_RE.match(session):
        raise SendError("session must be a pi session id (a UUID)")
    try:
        pid = int(one("pid"))
    except ValueError:
        raise SendError("pid must be a number") from None
    if not HOST_RE.match(host):
        raise SendError("host must be a host name")
    if harness not in HARNESSES:
        harness = "pi"
    if not WHERE_RE.match(where):
        where = ""
    return session.lower(), pid, host, harness, where


def _register(lst: Listener) -> tuple["Listener | None", list[dict]]:
    """Make lst the session's stream; give back the claims another pi left unstarted; the sends to push now."""
    s, reg = lst.session, lst.reg
    with _lock:
        old = _live.get(s)
        _live[s] = lst
        _write(_reg_path(s), reg)
        push = []
        for rec in sorted(_records(), key=lambda r: r.get("created", 0)):
            if rec.get("state") == "claimed" and rec.get("session") == s and rec.get("route") not in SERVER_ROUTES:
                if _claimer_gone(rec.get("claimer") or {}, reg):
                    rec.update(state="pending", claimer=None, claimed_at=None)
                    _save(rec)
            if rec.get("state") != "pending":
                continue
            if rec.get("session") == s:
                push.append(rec)
            elif _waits_for_grace(rec) and s in (rec.get("sessions") or []):
                rec.pop("grace", None)
                rec.update(session=s, harness=reg["harness"], where=reg["where"], host=reg["host"])
                _save(rec)
                push.append(rec)
    return old, push


def _claimer_gone(claimer: dict, reg: dict) -> bool:
    """Whether a new registration of the session shows that the pi holding a claim is gone: on this host, its pid
    is dead; on another host, which this one cannot look into, a pi there registered with another pid. The claimer
    itself registering again is never gone."""
    pid, host = claimer.get("pid"), claimer.get("host")
    if not isinstance(pid, int) or not host:
        return True  # a claim that names no pi has no one to wait for
    if (pid, host) == (reg["pid"], reg["host"]):
        return False
    if host == HOST:
        return not _alive(pid)
    return reg["host"] == host and reg["pid"] != pid


def _unregister(lst: Listener) -> None:
    with _lock:
        if _live.get(lst.session) is lst:
            del _live[lst.session]
        elif _live.get(lst.session) is not None:
            return  # superseded: the file is the new stream's
        current = _read(_reg_path(lst.session))
        if not current or current.get("connected_at") != lst.reg["connected_at"]:
            return
        if lst.deleted:
            try:
                _reg_path(lst.session).unlink()
            except OSError:
                pass
        else:
            _write(_reg_path(lst.session), {**lst.reg, "last_seen": time.time()})


def listen(handler, query: dict) -> None:
    """GET /api/agents/listen: hold the stream until the client goes, another pi takes the session, or the
    server closes it."""
    try:
        session, pid, host, harness, where = _params(query)
    except SendError as e:
        return handler._json({"error": str(e)}, 400)
    lst = Listener(session, pid, host, harness, where)
    handler.close_connection = True
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()
    conn = handler.connection
    try:
        handler.wfile.write(b": connected\n\n")
    except OSError:
        return
    old, push = _register(lst)
    if old is not None:
        old.put(SUPERSEDED, close=True)
    for rec in push:
        lst.put(_event(rec))
    conn.settimeout(30)  # a client that stops reading fails the write instead of holding the thread
    beat = time.monotonic() + HEARTBEAT_S
    try:
        while True:
            out, closing = lst.take()
            for chunk in out:
                handler.wfile.write(chunk)
            if closing:
                break
            ready, _, _ = select.select([conn, lst.wake_r], [], [], max(0.0, beat - time.monotonic()))
            if conn in ready and not conn.recv(4096):
                break  # EOF: the pi is gone
            if lst.wake_r in ready:
                lst.wake_r.recv(4096)
            if time.monotonic() >= beat:
                handler.wfile.write(b": hb\n\n")
                beat = time.monotonic() + HEARTBEAT_S
                lst.reg["last_seen"] = time.time()
    except (OSError, ValueError):
        pass
    finally:
        _unregister(lst)
        lst.wake_r.close()
        lst.wake_w.close()


def deregister(session: str) -> None:
    """DELETE /api/agents/<session>: the pi shuts down cleanly; its registration goes with its stream."""
    if not UUID_RE.match(session or ""):
        raise SendError("not a session id")
    session = session.lower()
    with _lock:
        lst = _live.get(session)
        if lst is not None:
            lst.deleted = True
            return
        try:
            _reg_path(session).unlink()
        except OSError:
            pass


# ---------- claim, release, started ----------

def _claimer(session: str | None) -> dict | None:
    lst = _live.get(session) if session else None
    reg = lst.reg if lst else (_read(_reg_path(session)) if session else None)
    return {"pid": reg.get("pid"), "host": reg.get("host")} if reg else None


def _claimant(body) -> dict | None:
    """The pi a claim request names in its body {pid, host}; None when it names none."""
    if not isinstance(body, dict) or ("pid" not in body and "host" not in body):
        return None
    pid, host = body.get("pid"), body.get("host")
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        raise SendError("pid must be a process id")
    if not isinstance(host, str) or not HOST_RE.match(host):
        raise SendError("host must be a host name")
    return {"pid": pid, "host": host}


def claim(send_id: str, body=None) -> dict:
    """POST /api/agents/claim/<id> with {pid, host}: 200 once while the send is pending, and again to the same pi
    while its claim has not started (it retries a claim whose answer it lost). KeyError: no such send;
    LookupError: not pending; SendError: a bad body."""
    who = _claimant(body)
    with _lock:
        rec = _load(send_id)
        if rec is None:
            raise KeyError(send_id)
        held = rec.get("claimer") or {}
        if (who and rec.get("state") == "claimed" and rec.get("route") not in SERVER_ROUTES
                and (held.get("pid"), held.get("host")) == (who["pid"], who["host"])):
            return summary(rec)
        if rec.get("state") != "pending" or not rec.get("session"):
            raise LookupError(f"send {send_id} is {rec.get('state')}")
        rec.update(state="claimed", claimed_at=time.time(), claimer=who or _claimer(rec["session"]))
        _save(rec)
    return summary(rec)


def release(send_id: str) -> dict:
    """POST /api/agents/release/<id>: a claimed send that did not start goes back to pending and to the session's
    stream, if one is open."""
    with _lock:
        rec = _load(send_id)
        if rec is None:
            raise KeyError(send_id)
        if rec.get("state") != "claimed" or rec.get("route") in SERVER_ROUTES:
            raise LookupError(f"send {send_id} is {rec.get('state')}")
        rec.update(state="pending", claimer=None, claimed_at=None)
        _save(rec)
        lst = _live.get(rec.get("session") or "")
    if lst is not None:
        lst.put(_event(rec))
    return summary(rec)


def started(send_id: str) -> dict:
    """POST /api/agents/started/<id>: the queued message started; the page is listed as sent from now."""
    with _lock:
        rec = _load(send_id)
        if rec is None:
            raise KeyError(send_id)
        if rec.get("state") == "started":
            return summary(rec)
        if rec.get("state") != "claimed":
            raise LookupError(f"send {send_id} is {rec.get('state')}")
        rec.update(state="started", started_at=time.time())
        _save(rec)
    _mark_sent(rec, rec["started_at"])
    return summary(rec)


def _mark_sent(rec: dict, at: float) -> None:
    """The page is sent from `at`, when the delivery started: a claim or a release never touches its status."""
    try:
        library.mark_sent(rec["key"], at)
    except OSError as e:
        print(f"agent-pages serve: send {rec['id']}: could not mark the page sent: {e}", file=sys.stderr, flush=True)


def markdown(send_id: str) -> str:
    rec = _load(send_id)
    if rec is None:
        raise KeyError(send_id)
    try:
        return Path(rec["markdown"]).read_text(encoding="utf-8")
    except (OSError, KeyError):
        raise KeyError(send_id) from None


def sends_of(rid: str) -> list[dict]:
    """GET /api/sends?page=<id>: a page's sends, newest first."""
    out = [r for r in _records() if r.get("page") == rid]
    out.sort(key=lambda r: r.get("created", 0), reverse=True)
    return [summary(r) for r in out[:20]]


# ---------- POST /api/send ----------

def send(body) -> dict:
    """Store a send and route it. SendError: a bad body; KeyError: no such page; library.SharedKey: the page's
    data-doc-id is shared; LookupError: the same id is being routed right now. A send id stored before answers with
    that send."""
    if not isinstance(body, dict):
        raise SendError("the body must be a JSON object")
    rid, send_id, md = body.get("page"), body.get("id"), body.get("markdown")
    if not isinstance(rid, str) or not REVIEW_ID_RE.match(rid):
        raise SendError("page must be a page id")
    if not isinstance(send_id, str) or not SEND_ID_RE.match(send_id):
        raise SendError("id must be 6 to 64 letters, digits, - or _")
    if not isinstance(md, str) or not md.strip():
        raise SendError("nothing to send: comment, answer a question or write a note first")
    if len(md.encode("utf-8")) > MD_LIMIT:
        raise SendError(f"the export is larger than {MD_LIMIT // 1000} kB")
    new = body.get("new") is True
    with _lock:
        known = _load(send_id)
        if known is not None:
            return summary(known)
        if send_id in _inflight:
            raise LookupError(f"send {send_id} is being routed: ask again for its state")
        _inflight.add(send_id)
    try:
        return _send(rid, send_id, md, new)
    finally:
        with _lock:
            _inflight.discard(send_id)


def _send(rid: str, send_id: str, md: str, new: bool) -> dict:
    item = library.get_item(rid)
    if item is None:
        raise KeyError(rid)
    if item["shared"]:
        e = library.SharedKey(f"data-doc-id {item['key']!r} is used by several pages: "
                              f"{', '.join([item['url'], *item['shared']])}")
        e.urls = sorted([item["url"], *item["shared"]])
        raise e
    sessions = [s.lower() for s in reversed(item.get("sessions") or []) if UUID_RE.match(s)]
    rec = {"id": send_id, "page": rid, "key": item["key"], "url": item["url"], "sessions": list(dict.fromkeys(sessions)),
           "session": None, "state": "pending", "route": "", "where": "", "harness": "", "host": "", "agent": None,
           "error": None, "created": time.time(), "claimed_at": None, "started_at": None, "claimer": None,
           "markdown": str(SENDS / f"{send_id}.md")}
    if new:
        return _route_new(rec, item, md)
    return _route(rec, md)


def _store_new(rec: dict, md: str) -> None:
    """Save a new send and its export; a send of the same page still pending is cancelled (one at a time)."""
    path = Path(rec["markdown"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(md, encoding="utf-8")
    for other in _records():
        if other.get("page") == rec["page"] and other.get("state") == "pending" and other["id"] != rec["id"]:
            other.update(state="cancelled", replaced_by=rec["id"])
            _save(other)
    _save(rec)


def _route(rec: dict, md: str | None = None) -> dict:
    """Pick the route of a pending send (md: its export, when it is new) and act on it; the summary answers."""
    sessions = rec["sessions"]
    if not sessions:
        return {**summary(rec), "route": "none", "state": None}
    with _lock:
        for s in sessions:
            lst = _live.get(s)
            if lst is not None:
                rec.update(session=s, route="live", harness=lst.reg["harness"], where=lst.reg["where"], host=lst.reg["host"])
                if md is not None:
                    _store_new(rec, md)
                else:
                    _save(rec)
                lst.put(_event(rec))
                return summary(rec)
        for s in sessions:
            reg = _registered(s)
            if reg is not None:
                rec.update(session=s, route="pending", harness=reg.get("harness") or "pi", where=reg.get("where") or "",
                           host=reg.get("host") or "")
                return _keep(rec, md)
        if time.time() - STARTED < GRACE_S:
            rec.update(route="pending", grace=True, where="agents reconnecting")
            return _keep(rec, md)
    for s in sessions:
        agent = _paseo_agent(s)
        if agent is None:
            continue
        rec.update(session=s, harness="paseo", where=agent["id"], host=HOST, agent=agent["id"])
        if _paseo_status(agent) == "running":
            rec.update(route="pending")
            return _keep(rec, md)
        rec.update(route="paseo")
        return _server_claim(rec, md, lambda r: _run_send(r, agent["id"]))
    for s in sessions:
        files = _session_files(s)
        if files:
            return _resume(rec, md, s, files)
    return {**summary(rec), "route": "none", "state": None}


def _keep(rec: dict, md: str | None) -> dict:
    with _lock:
        if md is not None:
            _store_new(rec, md)
        else:
            _save(rec)
    return summary(rec)


def _fail(rec: dict, md: str | None, error: str) -> dict:
    rec.update(state="failed", route="failed", error=error)
    return _keep(rec, md)


def _server_claim(rec: dict, md: str | None, work) -> dict:
    """The server delivers this send itself: claim it now and run `work` in the background."""
    rec.update(state="claimed", claimed_at=time.time(), claimer={"pid": os.getpid(), "host": HOST, "server": True})
    _keep(rec, md)
    threading.Thread(target=_deliver, args=(rec["id"], work), daemon=True, name=f"send-{rec['id']}").start()
    return summary(rec)


def _deliver(send_id: str, work) -> None:
    rec = _load(send_id)
    if rec is None:
        return
    try:
        work(rec)
    except Exception as e:  # noqa: BLE001 - any error fails the send rather than leaving it claimed
        print(f"agent-pages serve: send {send_id} failed: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        with _lock:
            rec = _load(send_id) or rec
            rec.update(state="failed", error=str(e)[:2000])
            _save(rec)
        return
    with _lock:
        rec = {**(_load(send_id) or rec), **{k: rec[k] for k in ("agent", "where", "session") if rec.get(k)}}
        now = time.time()
        rec.update(state="started", claimed_at=rec.get("claimed_at") or now, started_at=now)
        _save(rec)
    _mark_sent(rec, rec["started_at"])


NO_AGENT = "no agent holds this session; start a new one"


def _waits_for_grace(rec: dict) -> bool:
    return rec.get("state") == "pending" and bool(rec.get("grace")) and rec.get("session") is None


def after_grace() -> None:
    """The start grace is over: route each send that still waits for it, as it is on disk now (a pi may have taken
    it, or a newer send replaced it, since the listing). One that finds no route is stored as none, so the app
    offers a new agent instead of showing it pending."""
    with _lock:
        waiting = [r["id"] for r in _records() if _waits_for_grace(r)]
    for send_id in waiting:
        with _lock:
            rec = _load(send_id)
            if rec is None or not _waits_for_grace(rec):
                continue
            rec.pop("grace", None)
            rec.update(route="", where="")
            _save(rec)  # no pi connecting from here on binds it (_register binds grace sends only): _route decides
        try:
            out = _route(rec)
        except Exception as e:  # noqa: BLE001 - one bad record must not stop the others
            print(f"agent-pages serve: send {send_id}: {e}", file=sys.stderr, flush=True)
            out = {"route": "failed", "state": None, "error": str(e)[:2000]}
        if out.get("state") is not None:
            continue  # routed and stored
        with _lock:  # none, or an error before anything stored it: never left pending
            cur = _load(send_id)
            if cur is not None and cur.get("state") == "pending" and cur.get("session") is None:
                if out["route"] == "none":
                    cur.update(state="none", route="none", error=NO_AGENT)
                else:
                    cur.update(state="failed", route="failed", error=out["error"])
                _save(cur)


# ---------- Paseo and pi session files ----------

def _paseo_home() -> Path:
    return Path(os.environ.get("PASEO_HOME") or Path.home() / ".paseo")


def _paseo_agent(session: str) -> dict | None:
    """The Paseo agent (not archived) whose pi session is this one, the most recently updated when several."""
    found = []
    for f in (_paseo_home() / "agents").glob("*/*.json"):
        a = _read(f)
        if not a or a.get("archivedAt") or not UUID_RE.match(str(a.get("id") or "")):
            continue
        if str((a.get("persistence") or {}).get("sessionId") or "").lower() == session:
            found.append(a)
    found.sort(key=lambda a: str(a.get("updatedAt") or ""), reverse=True)
    return found[0] if found else None


def _paseo_status(agent: dict) -> str:
    """running, idle, ...: what `inspect` says, else the status Paseo last stored."""
    try:
        out = _run("inspect", agent=agent["id"])
        status = json.loads(out).get("Status")
        if isinstance(status, str) and status:
            return status.lower()
    except (SendError, OSError, ValueError, AttributeError, subprocess.SubprocessError):
        pass
    return str(agent.get("lastStatus") or "").lower()


def _session_files(session: str) -> list[Path]:
    return sorted((Path.home() / ".pi" / "agent" / "sessions").glob(f"*/*_{session}.jsonl"))


def _resume(rec: dict, md: str | None, session: str, files: list[Path]) -> dict:
    rec.update(session=session, harness="paseo", host=HOST)
    if len(files) != 1:
        return _fail(rec, md, f"several session files for {session}")
    f = files[0]
    try:
        with f.open(encoding="utf-8", errors="replace") as fh:
            header = json.loads(fh.readline())
        cwd = str(header.get("cwd") or "") if isinstance(header, dict) else ""
        mtime = f.stat().st_mtime
    except (OSError, ValueError):
        return _fail(rec, md, "the session file cannot be read")
    if not cwd or not Path(cwd).is_dir():
        return _fail(rec, md, "working folder removed")
    if time.time() - mtime < FRESH_S:
        return _fail(rec, md, f"the session was written in the last {int(FRESH_S // 60)} minutes, so a pi without "
                              "the agent-pages extension may still hold it: send again once it is closed")
    rec.update(route="resuming", where="Paseo pages")

    def work(r: dict) -> None:
        PAGES_DIR.mkdir(parents=True, exist_ok=True)
        agent = _agent_id(_run("import", session_file=str(f), pages_dir=str(PAGES_DIR), page=r["page"]))
        r["agent"] = agent
        _run_send(r, agent)
    return _server_claim(rec, md, work)


def _route_new(rec: dict, item: dict, md: str) -> dict:
    """A new Paseo agent in the page's folder, started on the export; its session is added to the page."""
    page = _page_path(item)
    if page is None:
        raise SendError("the page has no file on this server")
    rec.update(route="new", harness="paseo", host=HOST, where="new agent")

    def work(r: dict) -> None:
        prompt = (f"The reader commented on the agent-pages page {page}. Read their comment export in {r['markdown']} "
                  "and address every comment and answer as the agent-pages skill describes.")
        agent = _agent_id(_run("new", cwd=str(page.parent), page=r["page"], prompt=prompt))
        r.update(agent=agent, where=agent)
        threading.Thread(target=_record_session, args=(r["id"], agent, page), daemon=True).start()
    return _server_claim(rec, md, work)


def _page_path(item: dict) -> Path | None:
    if item["origin"] == "tutor":
        return library.page_file(item["slug"])
    pages = library._pages
    found = pages.page_file(item["url"]) if pages is not None else None
    return found[0] if found else None


def _record_session(send_id: str, agent: str, page: Path) -> None:
    """Wait for the new agent's pi session id in Paseo's store and add it to the page, keeping the file's date."""
    end = time.time() + SESSION_WAIT_S
    session = None
    while time.time() < end and session is None:
        for f in (_paseo_home() / "agents").glob(f"*/{agent}.json"):
            sid = str(((_read(f) or {}).get("persistence") or {}).get("sessionId") or "")
            if UUID_RE.match(sid):
                session = sid.lower()
        if session is None:
            time.sleep(0.5)
    if session is None:
        return
    try:
        text = page.read_text(encoding="utf-8")
        revised = add_session(text, session)
        if revised != text:
            st = page.stat()
            tmp = page.with_name(f".{page.name}.session.tmp")
            tmp.write_text(revised, encoding="utf-8")
            os.chmod(tmp, st.st_mode & 0o7777)
            os.utime(tmp, ns=(st.st_atime_ns, st.st_mtime_ns))  # the server's write is no revision: Sent stays
            tmp.replace(page)
    except OSError as e:
        print(f"agent-pages serve: send {send_id}: could not add session {session} to {page}: {e}", file=sys.stderr,
              flush=True)
        return
    with _lock:
        rec = _load(send_id)
        if rec is not None:
            rec["session"] = session
            _save(rec)
    if library._pages is not None:
        library._pages.scan()


def _run_send(rec: dict, agent: str) -> None:
    _run("send", agent=agent, prompt_file=rec["markdown"])


def _agent_id(out: str) -> str:
    try:
        data = json.loads(out)
    except ValueError:
        raise SendError(f"Paseo answered no agent id: {out.strip()[:300]}") from None
    if isinstance(data, list) and data:
        data = data[0]
    agent = str((data or {}).get("agentId") or (data or {}).get("id") or "") if isinstance(data, dict) else ""
    if not UUID_RE.match(agent):
        raise SendError(f"Paseo answered no agent id: {out.strip()[:300]}")
    return agent


def command(name: str, **values: str) -> list[str]:
    """The argv of a [harness.paseo] command, each placeholder filled inside its own argument."""
    return [PLACEHOLDER_RE.sub(lambda m: values[m.group(1)], arg) for arg in COMMANDS[name]]


def _run(name: str, **values: str) -> str:
    """Run a command with no shell; its stdout, or SendError with its stderr."""
    argv = command(name, **values)
    env = {k: v for k, v in os.environ.items() if k not in DROP_ENV}
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=COMMAND_S, env=env, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        raise SendError(f"{argv[0]} not found") from None
    except subprocess.TimeoutExpired:
        raise SendError(f"{argv[0]} {name} took longer than {COMMAND_S} s") from None
    if p.returncode != 0:
        raise SendError(f"{argv[0]} {name} failed: {(p.stderr or p.stdout).strip()[:1500]}")
    return p.stdout

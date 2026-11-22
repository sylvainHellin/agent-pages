"""Send to agent: the agent registry (SSE listen), the send records and every route of POST /api/send, against a
temporary home with fake pi session files, a fake Paseo store and a fake `paseo` executable on PATH.

    uv run python -m unittest discover -s tests
"""

from __future__ import annotations

import json
import os
import re
import socket
import stat
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest import mock

from agent_pages import config
from agent_pages.page import page_sessions
from agent_pages.server import agents, app, library, reports

S_OLD = "01a20000-0000-7000-8000-00000000a001"
S_NEW = "01a20000-0000-7000-8000-00000000a002"
S_LESSON = "01a20000-0000-7000-8000-00000000a003"
S_CREATED = "01a20000-0000-7000-8000-00000000a004"
AGENT = "aaaaaaaa-0000-4000-8000-000000000001"
IMPORTED = "bbbbbbbb-0000-4000-8000-000000000002"
NEW_AGENT = "cccccccc-0000-4000-8000-000000000003"
DOC_ID = "send-test"
RID = reports.review_id(DOC_ID)
MD = "# Comments on Send test\n\n- fix the table\n"
HOST = socket.gethostname()


def page(doc_id: str, sessions: str, title: str = "Send test") -> str:
    return f"""<!DOCTYPE html>
<html lang="en" data-doc-id="{doc_id}">
<head>
<meta charset="utf-8">
<meta name="agent-pages-session" content="{sessions}">
<title>{title}</title>
<script src="file:///home/someone/code/agent-pages/template/report.js"></script>
</head><body><main><p>Text.</p></main></body></html>
"""


# Logs its argv as one JSON line, answers like the Paseo CLI 0.11 does with --json.
FAKE_PASEO = """#!{python}
import json, os, sys
from pathlib import Path
argv = sys.argv[1:]
with open(os.environ["FAKE_PASEO_LOG"], "a") as f:
    f.write(json.dumps(argv) + "\\n")
state = Path(os.environ["FAKE_PASEO_STATE"])
if (state / "fail").exists():
    print("AGENT_IMPORT_FAILED something broke", file=sys.stderr)
    sys.exit(1)
cmd = argv[0]
if cmd == "inspect":
    agent = argv[-1]
    st = state / ("status-" + agent)
    print(json.dumps({{"Id": agent, "Status": st.read_text().strip() if st.exists() else "idle"}}))
elif cmd == "import":
    print(json.dumps({{"agentId": "{imported}", "status": "created", "provider": "pi"}}))
elif cmd == "run":
    home = Path(os.environ["PASEO_HOME"]) / "agents" / "new"
    home.mkdir(parents=True, exist_ok=True)
    (home / "{new_agent}.json").write_text(json.dumps({{"id": "{new_agent}",
        "persistence": {{"provider": "pi", "sessionId": "{created}"}}}}))
    print(json.dumps({{"agentId": "{new_agent}", "status": "running"}}))
elif cmd == "send":
    pass
"""


def until(cond, timeout: float = 5.0, what: str = "condition"):
    end = time.time() + timeout
    while True:
        value = cond()
        if value:
            return value
        if time.time() > end:
            raise AssertionError(f"timed out waiting for {what}")
        time.sleep(0.02)


class SSE:
    """A raw listener connection, as the agent-pages-inbox extension opens it; collects events and comments."""

    def __init__(self, port: int, session: str, pid: int | None = None, host: str = HOST, harness: str = "herdr",
                 where: str = "t17"):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=5)
        q = urllib.parse.urlencode({"session": session, "pid": pid or os.getpid(), "host": host,
                                    "harness": harness, "where": where})
        self.sock.sendall(f"GET /api/agents/listen?{q} HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n".encode())
        self.events: list[tuple[str, str]] = []
        self.comments: list[str] = []
        self.status = 0
        self.closed = threading.Event()
        self._buf = b""
        self._head = threading.Event()
        threading.Thread(target=self._read, daemon=True).start()
        self._head.wait(5)

    def _read(self):
        event = {"type": "", "data": []}
        try:
            while True:
                chunk = self.sock.recv(4096)
                if not chunk:
                    break
                self._buf += chunk
                if not self._head.is_set():
                    if b"\r\n\r\n" not in self._buf:
                        continue
                    head, self._buf = self._buf.split(b"\r\n\r\n", 1)
                    self.status = int(head.split()[1])
                    self._head.set()
                while b"\n" in self._buf:
                    line, self._buf = self._buf.split(b"\n", 1)
                    line = line.decode()
                    if line == "":
                        if event["type"] or event["data"]:
                            self.events.append((event["type"], "\n".join(event["data"])))
                        event = {"type": "", "data": []}
                    elif line.startswith(":"):
                        self.comments.append(line)
                    elif line.startswith("event:"):
                        event["type"] = line[6:].strip()
                    elif line.startswith("data:"):
                        event["data"].append(line[5:].lstrip())
        except OSError:
            pass
        self._head.set()
        self.closed.set()

    def sends(self) -> list[dict]:
        return [json.loads(d) for t, d in self.events if t == "send"]

    def close(self):
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


class SendToAgent(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        home = self.home = Path(self._tmp.name).resolve()
        bin_dir = home / "bin"
        bin_dir.mkdir()
        self.state = home / "fake-paseo"
        self.state.mkdir()
        self.log = home / "paseo.log"
        fake = bin_dir / "paseo"
        fake.write_text(FAKE_PASEO.format(python=sys.executable, imported=IMPORTED, new_agent=NEW_AGENT, created=S_CREATED))
        fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
        env = {"HOME": str(home), "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
               "FAKE_PASEO_LOG": str(self.log), "FAKE_PASEO_STATE": str(self.state), "PASEO_HOME": str(home / ".paseo"),
               "PASEO_AGENT_ID": "dddddddd-0000-4000-8000-000000000009", "PASEO_AGENT_CWD": "/elsewhere"}
        self._env = mock.patch.dict(os.environ, env)
        self._env.start()
        self._quiet = mock.patch.object(app.Handler, "log_message", lambda *a: None)
        self._quiet.start()
        self._timing = mock.patch.multiple(agents, GRACE_S=0, HEARTBEAT_S=0.3)
        self._timing.start()
        docs = self.docs = home / "docs"
        (docs / "area").mkdir(parents=True)
        self.page_file = docs / "area" / "page.html"
        self.page_file.write_text(page(DOC_ID, f"{S_OLD} {S_NEW}"))
        old = time.time() - 3600
        os.utime(self.page_file, (old, old))
        lessons = docs / "lessons"
        lessons.mkdir()
        self.work = home / "work"
        self.work.mkdir()
        self.cfg = config.Config(path=home / "config.toml", exists=False, roots={"documents": docs}, lessons_dir=lessons)
        self.cfg.pages_dir = home / "pages"
        self.start()

    def start(self):
        self.srv, self.index = app.build(self.cfg, "127.0.0.1", 0)
        self.port = self.srv.server_address[1]
        self.base = "http://127.0.0.1:%d" % self.port
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.listeners: list[SSE] = []

    def tearDown(self):
        for s in self.listeners:
            s.close()
        agents.close_all()
        self.srv.shutdown()
        self.srv.server_close()
        self._timing.stop()
        self._quiet.stop()
        self._env.stop()
        self._tmp.cleanup()

    # ---- helpers ----
    def req(self, method: str, path: str, body=None, headers: dict | None = None) -> tuple[int, dict | str]:
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.base + path, data=data, method=method,
                                   headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(r, timeout=10) as resp:
                raw, status, ctype = resp.read(), resp.status, resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            raw, status, ctype = e.read(), e.code, e.headers.get("Content-Type", "")
        return status, json.loads(raw) if "json" in ctype else raw.decode()

    def send(self, send_id: str = "send-0001", rid: str = RID, **extra) -> tuple[int, dict]:
        return self.req("POST", "/api/send", {"page": rid, "id": send_id, "markdown": MD, **extra})

    def listen(self, session: str = S_NEW, **kw) -> SSE:
        s = SSE(self.port, session, **kw)
        self.listeners.append(s)
        self.assertEqual(s.status, 200)
        until(lambda: agents.live(session) is not None, what="the listener to register")
        return s

    def record(self, send_id: str = "send-0001") -> dict:
        status, body = self.req("GET", f"/api/sends?page={RID}")
        self.assertEqual(status, 200)
        return next(s for s in body["sends"] if s["id"] == send_id)

    def item(self, rid: str = RID) -> dict:
        return next(i for i in self.req("GET", "/api/items")[1]["items"] if i["id"] == rid)

    def paseo_calls(self) -> list[list[str]]:
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def session_file(self, session: str, cwd: Path | None = None, age: float = 3600) -> Path:
        d = self.home / ".pi" / "agent" / "sessions" / "--work--"
        d.mkdir(parents=True, exist_ok=True)
        f = d / f"2026-11-22T10-00-00-000Z_{session}.jsonl"
        f.write_text(json.dumps({"type": "session", "version": 3, "id": session, "cwd": str(cwd or self.work)}) + "\n")
        t = time.time() - age
        os.utime(f, (t, t))
        return f

    def paseo_agent(self, session: str, agent: str = AGENT, status: str = "idle", archived: bool = False) -> None:
        d = self.home / ".paseo" / "agents" / "work"
        d.mkdir(parents=True, exist_ok=True)
        rec = {"id": agent, "provider": "pi", "lastStatus": status, "persistence": {"provider": "pi", "sessionId": session}}
        if archived:
            rec["archivedAt"] = "2026-11-20T00:00:00.000Z"
        (d / f"{agent}.json").write_text(json.dumps(rec))
        (self.state / f"status-{agent}").write_text(status)

    # ---- registry ----
    def test_listen_registers_heartbeats_and_drops_on_eof(self):
        s = self.listen(S_NEW, harness="herdr", where="t17")
        reg = json.loads((library.DATA / "agents" / f"{S_NEW}.json").read_text())
        self.assertEqual((reg["pid"], reg["host"], reg["harness"], reg["where"]), (os.getpid(), HOST, "herdr", "t17"))
        until(lambda: len(s.comments) >= 3, what="heartbeats")  # one on connect, then every HEARTBEAT_S
        s.close()
        until(lambda: agents.live(S_NEW) is None, timeout=1.0, what="EOF to drop the entry")
        self.assertTrue((library.DATA / "agents" / f"{S_NEW}.json").exists())  # not closed cleanly: kept

    def test_eof_drops_the_entry_before_any_write(self):
        with mock.patch.multiple(agents, HEARTBEAT_S=30):
            s = self.listen(S_NEW)
            s.close()
            until(lambda: agents.live(S_NEW) is None, timeout=1.0, what="select() to see the EOF")

    def test_delete_on_shutdown_clears_the_registration(self):
        s = self.listen(S_NEW)
        self.assertEqual(self.req("DELETE", f"/api/agents/{S_NEW}")[0], 200)
        s.close()
        until(lambda: not (library.DATA / "agents" / f"{S_NEW}.json").exists(), what="the registration to go")
        self.assertEqual(self.req("DELETE", "/api/agents/not-a-uuid")[0], 400)

    def test_second_listener_supersedes_the_first(self):
        first = self.listen(S_NEW, pid=111)
        second = self.listen(S_NEW, pid=222)
        until(lambda: ("superseded", "{}") in first.events, what="superseded on the old stream")
        until(first.closed.is_set, what="the old stream to close")
        self.assertFalse(second.closed.is_set())
        self.assertEqual(agents.live(S_NEW)["pid"], 222)
        self.assertEqual(json.loads((library.DATA / "agents" / f"{S_NEW}.json").read_text())["pid"], 222)

    def test_listen_refuses_a_bad_session(self):
        s = SSE(self.port, "x; rm -rf /")
        self.listeners.append(s)
        self.assertEqual(s.status, 400)

    # ---- delivery ----
    def test_live_route_claim_started_and_status(self):
        s = self.listen(S_NEW, where="t17")
        status, body = self.send()
        self.assertEqual(status, 200)
        self.assertEqual((body["route"], body["state"], body["where"], body["harness"]), ("live", "pending", "t17", "herdr"))
        pushed = until(s.sends, what="the push")
        self.assertEqual(pushed, [{"id": "send-0001", "markdown_url": "api/sends/send-0001/markdown"}])
        status, md = self.req("GET", "/api/sends/send-0001/markdown")
        self.assertEqual((status, md), (200, MD))
        self.assertEqual(self.record()["state"], "pending")  # fetching the markdown claims nothing
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001")[0], 200)
        rec = self.record()
        self.assertEqual(rec["state"], "claimed")
        self.assertEqual(self.item()["status"], "open")  # claimed is not delivered yet
        time.sleep(0.05)
        self.assertEqual(self.req("POST", "/api/agents/started/send-0001")[0], 200)
        rec = self.record()
        self.assertEqual(rec["state"], "started")
        item = self.item()
        self.assertEqual(item["status"], "sent")
        self.assertAlmostEqual(item["sent_at"], rec["started_at"], places=3)
        self.assertEqual(self.req("POST", "/api/agents/started/send-0001")[0], 200)  # idempotent
        # the agent revises the page after the send started: listed as open again
        later = rec["started_at"] + 5
        os.utime(self.page_file, (later, later))
        self.index.scan()
        self.assertEqual(self.item()["status"], "open")

    def test_claim_exactly_once_under_concurrency(self):
        self.listen(S_NEW)
        self.send()
        codes: list[int] = []
        barrier = threading.Barrier(12)

        def claim():
            barrier.wait()
            codes.append(self.req("POST", "/api/agents/claim/send-0001")[0])
        threads = [threading.Thread(target=claim) for _ in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(codes), [200] + [409] * 11)
        self.assertEqual(self.req("POST", "/api/agents/claim/no-such-send")[0], 404)

    def test_a_claim_repeated_by_the_same_pi_is_answered_again(self):
        s = self.listen(S_NEW, pid=4321)
        self.send()
        until(s.sends)
        me = {"pid": 4321, "host": HOST}
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001", me)[0], 200)
        stored = json.loads((library.DATA / "sends" / "send-0001.json").read_text())
        self.assertEqual(stored["claimer"], me)  # from the request
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001", me)[0], 200)  # its first answer was lost
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001", {"pid": 4322, "host": HOST})[0], 409)
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001", {"pid": 4321, "host": "other"})[0], 409)
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001")[0], 409)
        self.req("POST", "/api/agents/started/send-0001")
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001", me)[0], 409)  # started: no second delivery
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001", {"pid": "x", "host": HOST})[0], 400)

    def test_release_puts_a_claim_back_and_pushes_it_again(self):
        s = self.listen(S_NEW)
        self.send()
        until(s.sends)
        self.req("POST", "/api/agents/claim/send-0001")
        self.assertEqual(self.req("POST", "/api/agents/release/send-0001")[0], 200)
        self.assertEqual(self.record()["state"], "pending")
        until(lambda: len(s.sends()) == 2, what="the re-push")
        self.req("POST", "/api/agents/claim/send-0001")
        self.req("POST", "/api/agents/started/send-0001")
        self.assertEqual(self.req("POST", "/api/agents/release/send-0001")[0], 409)  # started: stays started

    def test_a_released_claim_never_lists_the_page_as_sent(self):
        s = self.listen(S_NEW)
        self.send()
        until(s.sends)
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001")[0], 200)
        self.assertEqual(self.req("POST", "/api/agents/release/send-0001")[0], 200)
        item = self.item()
        self.assertEqual((item["status"], item.get("sent_at")), ("open", None))

    def test_pending_while_registered_and_pushed_on_reconnect(self):
        s = self.listen(S_NEW, where="t17")
        s.close()
        until(lambda: agents.live(S_NEW) is None)
        status, body = self.send()  # its pi is alive (this test's pid) but not connected
        self.assertEqual((body["route"], body["state"], body["where"]), ("pending", "pending", "t17"))
        again = self.listen(S_NEW)
        self.assertEqual(until(again.sends, what="the re-push on connect")[0]["id"], "send-0001")
        self.assertEqual(self.paseo_calls(), [])  # never fell back on its own

    def test_remote_registration_not_closed_is_pending(self):
        s = self.listen(S_NEW, host="sylvain-mac", pid=4242, harness="pi", where="")
        s.close()
        until(lambda: agents.live(S_NEW) is None)
        self.session_file(S_NEW)
        body = self.send()[1]
        self.assertEqual((body["route"], body["host"]), ("pending", "sylvain-mac"))

    def test_dead_local_pid_is_not_a_registration(self):
        s = self.listen(S_NEW, pid=2 ** 22 + 12345)  # no such process
        s.close()
        until(lambda: agents.live(S_NEW) is None)
        self.assertEqual(self.send()[1]["route"], "none")

    def test_a_new_pid_takes_back_claimed_sends_not_started(self):
        s = self.listen(S_NEW, pid=os.getpid())
        self.send()
        until(s.sends)
        self.req("POST", "/api/agents/claim/send-0001")
        s.close()
        until(lambda: agents.live(S_NEW) is None)
        same = self.listen(S_NEW, pid=os.getpid())  # the same pi reconnecting: its claim stands
        time.sleep(0.2)
        self.assertEqual((self.record()["state"], same.sends()), ("claimed", []))
        other = self.listen(S_NEW, pid=os.getppid())  # another pi (the first was SIGKILLed): claim returned
        self.assertEqual(until(other.sends, what="the re-push to the new pi")[0]["id"], "send-0001")
        self.assertEqual(self.record()["state"], "pending")
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001")[0], 200)

    # ---- POST /api/send routes ----
    def test_newest_session_first(self):
        self.listen(S_OLD, where="t1")
        self.listen(S_NEW, where="t2")
        self.assertEqual(self.send()[1]["where"], "t2")

    def test_paseo_agent_running_is_pending(self):
        self.paseo_agent(S_NEW, status="running")
        self.session_file(S_NEW)
        body = self.send()[1]
        self.assertEqual((body["route"], body["harness"], body["where"]), ("pending", "paseo", AGENT))
        self.assertNotIn("send", [c[0] for c in self.paseo_calls()])  # never interrupts a running turn

    def test_paseo_agent_idle_gets_the_export(self):
        self.paseo_agent(S_NEW, status="idle")
        self.paseo_agent(S_OLD, agent="eeeeeeee-0000-4000-8000-000000000005", status="idle", archived=True)
        body = self.send()[1]
        self.assertEqual((body["route"], body["where"]), ("paseo", AGENT))
        until(lambda: self.record()["state"] == "started", what="the paseo send")
        sends = [c for c in self.paseo_calls() if c[0] == "send"]
        md_file = str(library.DATA / "sends" / "send-0001.md")
        self.assertEqual(sends, [["send", "--no-wait", "--prompt-file", md_file, AGENT]])
        self.assertEqual(Path(md_file).read_text(), MD)
        self.assertEqual(self.item()["status"], "sent")
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001")[0], 409)  # claimed by the server

    def test_resume_route_imports_into_pages_and_sends(self):
        f = self.session_file(S_NEW)
        body = self.send()[1]
        self.assertEqual((body["route"], body["where"]), ("resuming", "Paseo pages"))
        until(lambda: self.record()["state"] == "started", what="import and send")
        calls = self.paseo_calls()
        self.assertEqual(calls[0], ["import", "--provider", "pi", "--cwd", str(self.home / "pages"),
                                    f"--label", f"agent-pages.page={RID}", "--json", str(f)])
        self.assertEqual(calls[1], ["send", "--no-wait", "--prompt-file", str(library.DATA / "sends" / "send-0001.md"), IMPORTED])
        self.assertTrue((self.home / "pages").is_dir())
        rec = self.record()
        self.assertEqual((rec["agent"], rec["session"]), (IMPORTED, S_NEW))

    def test_resume_env_has_no_paseo_agent_variables(self):
        self.session_file(S_NEW)
        dump = self.home / "env.json"
        (self.home / "bin" / "paseo").write_text(f"#!{sys.executable}\nimport json, os\n"
                                                 f"open({str(dump)!r}, 'w').write(json.dumps(dict(os.environ)))\n"
                                                 "print(json.dumps({'agentId': '" + IMPORTED + "'}))\n")
        self.send()
        env = until(lambda: dump.exists() and json.loads(dump.read_text()), what="the command")
        self.assertNotIn("PASEO_AGENT_ID", env)
        self.assertNotIn("PASEO_AGENT_CWD", env)

    def test_resume_refused_when_the_session_file_is_fresh(self):
        self.session_file(S_NEW, age=30)
        body = self.send()[1]
        self.assertEqual((body["route"], body["state"]), ("failed", "failed"))
        self.assertIn("2 minutes", body["error"])
        self.assertEqual(self.paseo_calls(), [])

    def test_resume_failed_when_the_working_folder_is_gone(self):
        self.session_file(S_NEW, cwd=self.home / "removed")
        body = self.send()[1]
        self.assertEqual((body["route"], body["error"]), ("failed", "working folder removed"))
        self.assertEqual(self.paseo_calls(), [])

    def test_an_unexpected_error_in_a_server_delivery_fails_the_send(self):
        self.paseo_agent(S_NEW, status="idle")
        with mock.patch.object(agents, "_run_send", side_effect=RuntimeError("boom")):
            self.assertEqual(self.send()[1]["route"], "paseo")
            rec = until(lambda: (r := self.record())["state"] == "failed" and r, what="the failure")
        self.assertIn("boom", rec["error"])

    def test_a_restart_fails_the_server_deliveries_it_cut_off(self):
        sends = library.DATA / "sends"
        sends.mkdir(parents=True, exist_ok=True)
        base = {"page": RID, "key": DOC_ID, "url": "/documents/area/page.html", "sessions": [S_NEW], "session": S_NEW,
                "created": time.time(), "claimed_at": time.time(), "markdown": str(sends / "x.md")}
        records = {"send-cut1": {"state": "claimed", "route": "resuming", "started_at": None},
                   "send-cut2": {"state": "claimed", "route": "new", "started_at": None},
                   "send-done": {"state": "started", "route": "paseo", "started_at": time.time()},
                   "send-live": {"state": "claimed", "route": "live", "started_at": None}}
        for sid, extra in records.items():
            (sends / f"{sid}.json").write_text(json.dumps({**base, "id": sid, **extra}))
        agents.start()
        states = {sid: (self.record(sid)["state"], self.record(sid)["error"]) for sid in records}
        reason = "the server restarted during delivery; check the agent before sending again"
        self.assertEqual(states, {"send-cut1": ("failed", reason), "send-cut2": ("failed", reason),
                                  "send-done": ("started", None), "send-live": ("claimed", None)})
        self.assertEqual(self.paseo_calls(), [])  # no retry

    def test_resume_failure_is_recorded(self):
        self.session_file(S_NEW)
        (self.state / "fail").write_text("")
        self.send()
        rec = until(lambda: (r := self.record())["state"] == "failed" and r, what="the failure")
        self.assertIn("AGENT_IMPORT_FAILED", rec["error"])
        self.assertNotEqual(self.item()["status"], "sent")

    def test_none_then_a_new_agent(self):
        status, body = self.send()
        self.assertEqual((status, body["route"]), (200, "none"))
        status, body = self.send("send-0002", new=True)
        self.assertEqual((status, body["route"]), (200, "new"))
        until(lambda: S_CREATED in page_sessions(self.page_file.read_text()), what="the new session on the page")
        run = next(c for c in self.paseo_calls() if c[0] == "run")
        self.assertEqual(run[:8], ["run", "--background", "--json", "--provider", "pi", "--cwd", str(self.page_file.parent),
                                   "--label"])
        self.assertEqual(run[8], f"agent-pages.page={RID}")
        self.assertIn(str(library.DATA / "sends" / "send-0002.md"), run[9])
        rec = self.record("send-0002")
        self.assertEqual((rec["state"], rec["agent"]), ("started", NEW_AGENT))
        self.assertEqual(page_sessions(self.page_file.read_text()), [S_OLD, S_NEW, S_CREATED])
        self.assertLess(self.page_file.stat().st_mtime, rec["started_at"])  # the server's own write keeps the date
        self.index.scan()
        self.assertEqual(self.item()["status"], "sent")

    def test_injection_never_reaches_argv(self):
        evil = "evil$(touch pwned)`id`;rm -rf ~"
        bad = docs_page = self.docs / "area" / "injected.html"
        docs_page.write_text(page(evil, f"{S_NEW};touch_x $(id) ../../etc {S_OLD}|ls"))
        self.index.scan()
        rid = reports.review_id(evil)
        self.session_file(S_NEW)
        body = self.send(rid=rid)[1]
        self.assertEqual(body["route"], "none")  # no recorded id is a clean UUID
        body = self.send("send-0003", rid=rid, new=True)[1]
        until(lambda: any(c[0] == "run" for c in self.paseo_calls()), what="the run")
        for argv in self.paseo_calls():
            for arg in argv:
                self.assertNotIn("$(", arg)
                self.assertNotIn("`", arg)
                self.assertNotIn(";", arg)
                self.assertNotIn("evil", arg)
        self.assertFalse((self.home / "pwned").exists())
        self.assertEqual(self.send("bad id; ls", rid=rid)[0], 400)
        self.assertEqual(self.req("POST", "/api/send", {"page": "../x", "id": "send-0004", "markdown": MD})[0], 400)
        self.assertTrue(bad.exists())

    def test_start_grace_keeps_sends_pending_then_routes_them(self):
        self.session_file(S_NEW)
        with mock.patch.multiple(agents, GRACE_S=60):
            body = self.send()[1]
        self.assertEqual((body["route"], body["where"]), ("pending", "agents reconnecting"))
        self.assertEqual(self.paseo_calls(), [])
        agents.after_grace()  # the timer the server sets for the end of the grace
        until(lambda: self.record()["state"] == "started", what="the route after the grace")
        self.assertEqual(self.record()["route"], "resuming")

    def test_a_grace_send_with_no_route_after_the_grace_is_stored_as_none(self):
        with mock.patch.multiple(agents, GRACE_S=60):
            self.assertEqual(self.send()[1]["route"], "pending")
        agents.after_grace()
        rec = self.record()
        self.assertEqual((rec["state"], rec["route"], rec["error"]),
                         ("none", "none", "no agent holds this session; start a new one"))
        stored = json.loads((library.DATA / "sends" / "send-0001.json").read_text())
        self.assertNotIn("grace", stored)

    def test_after_grace_routes_the_current_record_not_its_listing(self):
        with mock.patch.multiple(agents, GRACE_S=60):
            self.send()
            listing = agents._records()  # what after_grace listed before a pi connected
            s = self.listen(S_OLD)
        until(s.sends)
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001")[0], 200)
        with mock.patch.object(agents, "_records", return_value=listing):
            agents.after_grace()
        time.sleep(0.2)
        self.assertEqual((self.record()["state"], len(s.sends())), ("claimed", 1))

    def test_grace_send_goes_to_the_first_candidate_that_connects(self):
        with mock.patch.multiple(agents, GRACE_S=60):
            self.send()
            s = self.listen(S_OLD)
        self.assertEqual(until(s.sends)[0]["id"], "send-0001")
        self.assertEqual(self.record()["session"], S_OLD)

    def test_shared_key_is_refused(self):
        (self.docs / "area" / "copy.html").write_text(page(DOC_ID, S_NEW))
        self.index.scan()
        status, body = self.send()
        self.assertEqual(status, 409)
        self.assertEqual(sorted(body["urls"]), ["/documents/area/copy.html", "/documents/area/page.html"])

    def test_send_id_dedupes_and_a_new_send_replaces_a_pending_one(self):
        s = self.listen(S_NEW)
        first = self.send()[1]
        self.assertEqual(self.send()[1], first)  # the same id again: the same record, no second push
        time.sleep(0.2)
        self.assertEqual(len(s.sends()), 1)
        self.send("send-0002")
        self.assertEqual(self.record("send-0001")["state"], "cancelled")
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0001")[0], 409)
        self.assertEqual(self.req("POST", "/api/agents/claim/send-0002")[0], 200)

    def test_a_repeat_while_the_first_is_routed_is_not_routed_again(self):
        s = self.listen(S_NEW)
        route = agents._route

        def slow(rec, md=None):
            time.sleep(0.3)
            return route(rec, md)
        answers: list[tuple[int, dict]] = []
        with mock.patch.object(agents, "_route", slow):
            threads = [threading.Thread(target=lambda: answers.append(self.send())) for _ in range(2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        time.sleep(0.2)
        self.assertEqual(len(s.sends()), 1)
        self.assertEqual(sorted(code for code, _ in answers), [200, 409])
        self.assertEqual(self.send(), (200, self.record()))  # stored now: the repeat gets its summary

    def test_bad_bodies(self):
        self.assertEqual(self.req("POST", "/api/send", {"page": RID, "id": "send-0001", "markdown": ""})[0], 400)
        self.assertEqual(self.req("POST", "/api/send", {"page": RID, "id": "send-0001", "markdown": "x" * 600_001})[0], 400)
        self.assertEqual(self.req("POST", "/api/send", {"page": "r" + "0" * 16, "id": "send-0001", "markdown": MD})[0], 404)
        self.assertEqual(self.req("POST", "/api/send", {"page": RID, "id": "send-0001", "markdown": MD},
                                  {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.req("GET", "/api/sends/nope-0001/markdown")[0], 404)

    def test_a_tutor_lesson_reaches_the_session_its_page_names(self):
        slug = "2026-01-02_send-lesson"
        d = self.cfg.lessons_dir / slug
        d.mkdir()
        (d / "index.html").write_text(page(slug, S_LESSON, "A lesson").replace(f' data-doc-id="{slug}"', ""))
        (d / "lesson.json").write_text(json.dumps({"title": "A lesson"}))
        rid = reports.review_id(library.tutor_key(slug))
        self.listen(S_LESSON, where="t9")
        body = self.send(rid=rid)[1]
        self.assertEqual((body["route"], body["where"]), ("live", "t9"))


class Suppressions(unittest.TestCase):
    def test_every_noqa_states_its_reason(self):
        """A lint suppression in the server carries `# noqa: CODE - why`; a bare one hides a fixable warning."""
        src = Path(agents.__file__).resolve().parents[1]
        bare = []
        for f in sorted(src.rglob("*.py")):
            for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                if "# noqa" in line and not re.search(r"# noqa: [A-Z0-9, ]+ - \S", line):
                    bare.append(f"{f.relative_to(src)}:{n}")
        self.assertEqual(bare, [])


if __name__ == "__main__":
    unittest.main()

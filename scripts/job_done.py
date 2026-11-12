#!/usr/bin/env python3
"""Tell the Tutor Library that an agent job has finished (the app then shows the lesson).

  tutor-job-done <job id> <lesson folder name>       the lesson is written or revised
  tutor-job-done <job id> --failed "<reason>"        the job could not be done
  --api URL   the library server (default: host and port from the agent-pages config)
"""
import argparse
import os
import json
import sys
import urllib.error
import urllib.request

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("job")
ap.add_argument("lesson", nargs="?", default="")
ap.add_argument("--failed", metavar="REASON")
def _default_api() -> str:
    try:
        from agent_pages.config import load
        cfg = load()
        return f"http://{cfg.host}:{cfg.port}"
    except Exception:
        return "http://127.0.0.1:8320"


ap.add_argument("--api", default=_default_api())
a = ap.parse_args()
if not a.lesson and a.failed is None:
    sys.exit("give the lesson folder name, or --failed REASON")
body = {"slug": a.lesson, "status": "failed" if a.failed is not None else "done", "note": a.failed or ""}
req = urllib.request.Request(f"{a.api.rstrip('/')}/api/jobs/{a.job}/report", data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        j = json.load(r)
except urllib.error.HTTPError as e:
    sys.exit(f"refused: {e.read().decode(errors='replace')}")
except OSError as e:
    sys.exit(f"cannot reach the library at {a.api}: {e}")
print(f"reported: job {j['id'][:8]} is {j['status']}" + (f", lesson {j['slug']}" if j.get("slug") else ""))

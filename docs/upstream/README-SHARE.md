# Tutor Library: shareable package (2026-11-10)

Two parts:

- `tutorLibrary/`: the web app. A Python server (`services/api`, standard library only) and a React front end, with a prebuilt copy in `apps/ui/dist`. It lists lessons in a month calendar, opens them in a reader, and stores answers and comments. It can also start new lesson jobs.
- `tutor-skill/`: the agent skill that writes the lessons (`SKILL.md`, the lesson HTML template, and TikZ figure helpers).

Personal lessons, answers and job logs are not included.

## Run the app

```bash
cd tutorLibrary/services/api
HOST=127.0.0.1 PORT=8320 python3 -u server.py
# open http://127.0.0.1:8320/
```

Python 3.10 or newer, no packages needed. Lessons are read from `tutorLibrary/lessons/<YYYY-MM-DD_slug>/`.
Each lesson is an `index.html` plus a `lesson.json`. The shared styles are in `lessons/_assets`.

Optional environment variables:

- `TUTOR_LESSONS`, `TUTOR_DATA`, `TUTOR_STATE`: where the lessons, answers and job logs live (default: inside the repo).
- `WS_REGISTRY`: a folder with a `projects.yaml` (project id → name, path), used to link lessons to projects. Without it, lessons are simply unlinked.

To rebuild the front end: `cd tutorLibrary/apps/ui && npm install && npm run build`.

## Writing lessons

- **By hand or with any agent.** Run `python3 tutorLibrary/scripts/new_lesson.py --help`.
  It creates the lesson folder from `tutor-skill/assets/lesson.html` (set `TUTOR_TEMPLATE` to that path).
- **With the skill.** Copy `tutor-skill/` to `~/.agents/skills/tutor` (pi) or `~/.claude/skills/tutor` (Claude Code), then ask the agent to teach you something.
- **Figures.** They are rendered with `tutor-skill/figures/render_fig.py`, which needs `tectonic` or a LaTeX install.

## Original-setup specifics you may need to change

This was built for one machine, so a few places assume it:

- **"New lesson" button.** The app's jobs start a `pi` coding agent in a `tuios` terminal window (`services/api/jobs.py`, `TUTOR_PI`, `TUTOR_TUIOS`).
  Without those tools, reading, answers and comments still work, but the New lesson button will not.
- **Hard-coded addresses.** Tailnet addresses (a Tailscale IP and a `*.ts.net` host name) appear as defaults in:
  - `scripts/serve.sh`
  - `scripts/job_done.py` (`--api`)
  - `scripts/new_lesson.py` (`TUTOR_LIBRARY_URL`)
  - `apps/ui/src/lib/api.ts` (the `REGISTRY` link)
  - `tutor-skill/SKILL.md` (the "Local setup" lines)

  Replace them with your own host.

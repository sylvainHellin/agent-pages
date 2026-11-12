# agent-pages

HTML pages an agent writes for a person to read and comment on.
A page comes in two kinds: a report, for an answer too long for the chat, and a lesson, which teaches a topic.
A page is a lesson when its head carries `<meta name="agent-pages-kind" content="lesson">`, wherever it lives; the app lists the tutor's lessons and these marked pages together under Lessons.
The reader comments on the page, answers its questions and pastes the export back to the agent, from a desktop browser or a phone.
The repo holds the page template with its themes, the `agent-pages` CLI, the server with the library app that lists reports and lessons, the figure backends, and two agent skills that teach an agent to write reports and lessons.

## Credits

Suhyung Jang (TUM CMS) built the lesson library app as `tutorLibrary`: the app in `apps/ui/`, the lesson index and review sync of the server, the graded answers, and the touch and IME fixes in the template.
His original README is in `docs/upstream/`.
Sylvain Hellin built the page template, the `agent-pages` CLI and the skills.

## Parts

- `template/`: `report.css`, `report.js`, the page and lesson skeletons, `themes/` (plain, tum, basenord) and `review-sync.js`; its README documents every component and what the reader can do.
- `skills/agent-pages/`, `skills/tutor/`: the agent skills for report pages and for lessons.
- `src/agent_pages/`: the `agent-pages` CLI and its config module (stdlib and PyYAML).
- `src/agent_pages/server/`: the standard-library HTTP server behind `agent-pages serve` (`app.py`), the report page index (`reports.py`), the lesson index (`library.py`) and the link inbox and agent jobs (`jobs.py`); it serves `template/` at `/_template/` and `/lessons/_assets/`, and the app theme's tokens for the app at `/api/theme.css` (`theme.py`).
- `apps/ui/`: the React app, one build laid out for desktop and phone, in the colours and fonts of the app theme and in the light or dark mode the pages use; `dist/` is built on the machine that serves it.
- `scripts/job_done.py`: the agent reports a finished job; `scripts/migrate_template_links.py`: points pages at `template/` instead of an old template folder (the report-html folder, or the repo before its rename).

## Install

Requirements: git and [uv](https://docs.astral.sh/uv/); Node and pnpm to build the library app; for TikZ figures, tectonic, pdftoppm (poppler) and a checkout of [tex-fig](https://github.com/sylvainHellin/tex-fig).

```bash
git clone https://github.com/sylvainHellin/agent-pages.git ~/code/agent-pages
mkdir -p ~/.config/agent-pages
cp ~/code/agent-pages/config.example.toml ~/.config/agent-pages/config.toml
```

The CLI runs from the checkout with no global install, `uv run --project ~/code/agent-pages agent-pages <command>`, so a shim on the `PATH` (here `~/.local/bin/agent-pages`) makes it the `agent-pages` command the skills call:

```bash
printf '#!/bin/sh\nexec uv run --quiet --project "$HOME/code/agent-pages" agent-pages "$@"\n' > ~/.local/bin/agent-pages
chmod +x ~/.local/bin/agent-pages
agent-pages config      # prints the effective configuration
```

## Configure

The config is `~/.config/agent-pages/config.toml` (`AGENT_PAGES_CONFIG` overrides the path); every key has a default, so an empty file works on localhost, and `config.example.toml` explains each key.
The keys a new machine usually sets:

- `lessons_dir`: the folder that holds the lessons.
- `theme`, `lesson_theme` and `app_theme`: `plain`, `tum`, `basenord`, or the path to any stylesheet that overrides the template's tokens; `app_theme` gives the library app its colours and fonts and defaults to `lesson_theme`.
- `figure_backend`: `matplotlib`, `texfig` (with `texfig_dir`), or `none`.
- `[roots]` and `base_url`: the folders the server publishes and the address it is reached at, for the links `agent-pages url` prints.
- `vault`: an Obsidian vault whose open project notes group the lessons; unset, lessons have no projects.

## Use

```bash
agent-pages new <path.html> [--title T] [--id slug] [--theme T]   # report page from template/report.html
agent-pages open <path>                                           # open in the browser (Mac), or queue it for the Mac
agent-pages url <path>                                            # server link of a page under a configured root
agent-pages drain                                                 # Mac LaunchAgent: open the queued pages
agent-pages lesson new <slug> --title T [--project ID] [...]      # lesson folder in lessons_dir
agent-pages fig build <file.tex|file.py>                          # figure via tex-fig or matplotlib
agent-pages config                                                # effective configuration
```

New pages link `template/` by `file://` path, with the theme and the Vim keys default from the config, so they open from disk with no server.

Tests: `uv run python -m unittest discover -s tests`.

## Where things live

- Lessons: `<lessons_dir>/<YYYY-MM-DD>_<slug>/` with `index.html`, `lesson.json` and `figures/`; `<lessons_dir>/_assets` is a symlink to `template/` (`agent-pages lesson new` creates it).
- Server state (review sync, inbox, jobs, last opened): `<lessons_dir>/_data/`, never served as files; `pages.json` there holds the status, projects and tags of the marked pages read in place.
- Projects: the open notes in `<vault>/02-areas/` and `<vault>/01-projects/`; the id is the note name, and a lesson created inside the repo a note names in `repo:` is linked to it.

## Serve

The server publishes the configured roots, the lessons and the library app (Lessons and Reports); it has no login.
On a server, run `agent-pages serve` as a service (a systemd user unit or a launchd agent), not in a terminal.

```bash
cd apps/ui && pnpm install && pnpm build && cd ../..
agent-pages serve                    # http://127.0.0.1:8320, or the config's host and port
```

On one machine, `http://127.0.0.1:8320/` is enough.
For other devices, publish it on a Tailscale tailnet only, never with Funnel or a public port, since anyone who reaches it can read every page:

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:8320
```

Then set `base_url = "https://<machine>.<tailnet>.ts.net:8443"` in the config; HTTPS also lets the pages' Export button write to the clipboard.
On an iPhone, open that URL in Safari and use Share, Add to Home Screen.

## Agent skills

`skills/agent-pages/` teaches an agent to write report pages (when to write one, structure, question cards, figures, the comment round trip), and `skills/tutor/` to teach a topic through a lesson.
Both call the `agent-pages` command, so the shim above must be on the agent's `PATH`.
An agent that reads skill folders gets them as symlinks, which keep them current with the checkout:

```bash
ln -s ~/code/agent-pages/skills/agent-pages ~/.claude/skills/agent-pages      # Claude Code
ln -s ~/code/agent-pages/skills/tutor ~/.claude/skills/tutor
ln -s ~/code/agent-pages/skills/agent-pages ~/.pi/agent/skills/agent-pages    # pi
ln -s ~/code/agent-pages/skills/tutor ~/.pi/agent/skills/tutor
```

An agent without skill folders gets a line in its instruction file (`AGENTS.md`) naming `skills/agent-pages/SKILL.md` and `skills/tutor/SKILL.md` and when to read them.

## Not adapted yet

Starting a lesson or a revision from the app (`jobs.py`) still drives tuios, Suhyung's terminal manager; the server keeps the job runner off until it drives hc.

## License

MIT, copyright Sylvain Hellin and Suhyung Jang; see `LICENSE`.
The bundled fonts keep their own licence, the SIL Open Font License.

# agent-pages

HTML pages an agent writes for a person to read and comment on.
A page is a report, for an answer too long for the chat, or a lesson, which teaches a topic.
The app shows every page in one list, each with one status (open, sent, done, archived) and free tags; a lesson carries the tag `lesson`.
A page under the server's roots carries it when its head has `<meta name="agent-pages-kind" content="lesson">`, so the tag travels with the file, and the tutor's lessons always carry it.
The reader comments on the page, answers its questions and pastes the export back to the agent, from a desktop browser or a phone.
The repo holds the page template with its themes, the `agent-pages` CLI, the server with the library app that lists every page, the figure backends, and two agent skills that teach an agent to write reports and lessons.

## Credits

Suhyung Jang (TUM CMS) built the lesson library app as `tutorLibrary`: the app in `apps/ui/`, the lesson index and review sync of the server, the graded answers, and the touch and IME fixes in the template.
His original README is in `docs/upstream/`.
Sylvain Hellin built the page template, the `agent-pages` CLI and the skills.

## Parts

- `template/`: `report.css`, `report.js`, the page and lesson skeletons, `themes/` (plain, tum, basenord) and `review-sync.js`; its README documents every component and what the reader can do.
- `skills/agent-pages/`, `skills/tutor/`: the agent skills for report pages and for lessons.
- `src/agent_pages/`: the `agent-pages` CLI and its config module (stdlib and PyYAML).
- `src/agent_pages/server/`: the standard-library HTTP server behind `agent-pages serve` (`app.py`), the page index (`reports.py`), the one list with its status and tag store (`library.py`) and the link inbox and agent jobs (`jobs.py`); it serves `template/` at `/_template/` and `/lessons/_assets/`, and the app theme's tokens for the app at `/api/theme.css` (`theme.py`).
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
agent-pages session <path> [--add [ID]]                           # agent sessions that wrote a page (add the current one)
agent-pages open <path>                                           # open the server's copy (Mac), or queue it for the Mac
agent-pages url <path>                                            # server link of a page under a configured root
agent-pages drain                                                 # Mac LaunchAgent: open the queued pages
agent-pages lesson new <slug> --title T [--project ID] [...]      # lesson folder in lessons_dir
agent-pages fig build <file.tex|file.py>                          # figure via tex-fig or matplotlib
agent-pages config                                                # effective configuration
agent-pages migrate-items                                         # once: _data/pages.json into _data/items.json
```

New pages link `template/` by `file://` path, with the theme and the Vim keys default from the config, so they open from disk with no server.
They record the id of the agent session that wrote them (`$AGENT_PAGES_SESSION`, else `$PI_SESSION_ID`) in `<meta name="agent-pages-session">`, and the comment export repeats it, so an agent in a later session can look up the conversation behind the page.
`open` opens a page under a configured root from the server once it serves the current version of the file (it waits up to 15 s for Syncthing), so its comments sync between devices; otherwise it opens the file and says why.

Tests: `uv run python -m unittest discover -s tests`.

## Where things live

- Lessons: `<lessons_dir>/<YYYY-MM-DD>_<slug>/` with `index.html`, `lesson.json` and `figures/`; `<lessons_dir>/_assets` is a symlink to `template/` (`agent-pages lesson new` creates it).
- Server state (review sync, inbox, jobs, statuses and tags): `<lessons_dir>/_data/`, never served as files.
- Status, tags, projects, topic and summary of every page: `<lessons_dir>/_data/items.json`, keyed by the page's `data-doc-id` (its URL when it has none, `tutor:<slug>` for a tutor lesson), so a page that keeps its id keeps them through a move; the lesson tag of a page under a root is its marker, in the file.
  Only a change in the app writes it, and only the fields it sets; every other field of a tutor lesson comes from its `lesson.json` (status `open`, `done` or `archived`; `learning` and `understood` still read as open and done), which the server reads and never writes.
  The older URL-keyed `_data/pages.json` is not read for the list: `agent-pages migrate-items`, run once by hand, copies the entry of each URL that names a page today into `items.json` under that page's key (`understood` becomes `done`, `learning` becomes `open`, a field `items.json` already has stays), prints and drops the URLs with no page now, and renames the file `pages.json.migrated`.
  A `lesson.json` the tutor rewrites after a change in the app wins for each field whose value it changed.
- Comments, answers and notes of every page the server serves: `<lessons_dir>/_data/review/` (lessons by slug, report pages under `pages/` by their `data-doc-id`); a page opened as a file keeps them in that browser only.
- Projects: the open notes in `<vault>/02-areas/` and `<vault>/01-projects/`; the id is the note name, and a lesson created inside the repo a note names in `repo:` is linked to it.

## Serve

The server publishes the configured roots, the lessons and the library app (the one list of pages); it has no login.
Under a root it serves pages and the files they link, never hidden folders (`.git`, `.agents`, dotfiles) or build folders (`node_modules`, `dist`, ...), with one exception: a repo's `.sync/`, where agents save the pages a person reads.
A symlink is judged by the file it resolves to, so a link into a hidden folder or out of every root is refused, and a link to a servable page is listed once, under the target's own URL.
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

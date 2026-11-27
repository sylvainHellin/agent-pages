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
agent-pages migrate-items                                         # once, with the server stopped: _data/pages.json into _data/items.json
```

New pages link `template/` by `file://` path, with the theme and the Vim keys default from the config, so they open from disk with no server.
They record the id of the agent session that wrote them (`$AGENT_PAGES_SESSION`, else `$PI_SESSION_ID`) in `<meta name="agent-pages-session">`, and the comment export repeats it, so an agent in a later session can look up the conversation behind the page.
The line lists the sessions oldest first; `session --add` of a session the line already names moves it to the end, so the last id is the newest.
A pi-subagents child never records its own session: the bash of a child has the child's `$PI_SESSION_ID`, so `agent-pages` follows its session file's `parentSession` header to the first session that is no subagent (the one that dispatched it), and records nothing when that chain breaks.
A parent that wants a page credited to itself passes its id explicitly: `AGENT_PAGES_SESSION=<its $PI_SESSION_ID>` in the subagent's task, or `--session <id>`.
`open` opens a page under a configured root from the server once it serves the current version of the file (it waits up to 15 s for Syncthing), so its comments sync between devices; otherwise it opens the file and says why.
`open` and `url` warn when a page links `report.css` but not `report.js`, since such a page renders without its bar (search, comments, Export, Send to agent).

Tests: `uv run python -m unittest discover -s tests` and `node --test tests/*.test.mjs`.
The browser tests (`tests/test_browser.py`) open pages in headless Chromium through Playwright; run `uv run playwright install chromium-headless-shell` once per machine, else they skip.

## Where things live

- Lessons: `<lessons_dir>/<YYYY-MM-DD>_<slug>/` with `index.html`, `lesson.json` and `figures/`; `<lessons_dir>/_assets` is a symlink to `template/` (`agent-pages lesson new` creates it).
- Server state (review sync, inbox, jobs, statuses and tags, Send to agent): `<lessons_dir>/_data/`, never served as files.
- Send to agent: `_data/agents/<session>.json`, one per pi registered with the server; `_data/sends/<send id>.json` with the export beside it as `<send id>.md`.
- Status, tags, projects, topic and summary of every page: `<lessons_dir>/_data/items.json`, keyed by the page's `data-doc-id` (its URL when it has none, `tutor:<slug>` for a tutor lesson), so a page that keeps its id keeps them through a move; the lesson tag of a page under a root is its marker, in the file.
  Only a change in the app writes it, and only the fields it sets; every other field of a tutor lesson comes from its `lesson.json` (status `open`, `done` or `archived`; `learning` and `understood` still read as open and done), which the server reads and never writes.
  The older URL-keyed `_data/pages.json` is not read for the list: `agent-pages migrate-items`, run once by hand with the server stopped (its `items.json` lock holds only within one process), copies the entry of each URL that names a page today into `items.json` under that page's key (`understood` becomes `done`, `learning` becomes `open`, a field `items.json` already has stays), prints and drops the URLs with no page now, and renames the file `pages.json.migrated`.
  A `lesson.json` the tutor rewrites after a change in the app wins for each field whose value it changed.
  A field the tutor changes and later changes back to its value at that change in the app, with no app change between, shows the app's older value again, since it looks like a rewrite that left the field alone.
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

The app keeps itself and every page opened in it readable with no connection: a service worker (`apps/ui/public/sw.js`, served at `/sw.js`) shows the saved copy first and asks the server for a newer one in the background, and Download for offline in a page's More menu also saves the images it references.
It also downloads every Open page with what it references, the pages changed last first and up to 150 MB, when the list loads and again on reconnecting or returning to the app, at most every 30 minutes; the Save Open pages offline switch (sidebar, or the phone's header menu) turns that off, for instance on a cellular-heavy day.
A page that leaves the Open list or no longer fits the 150 MB is removed again, unless it was opened or saved with Download for offline.
Service workers need HTTPS or localhost, so offline reading works behind `tailscale serve` or on `127.0.0.1`, not on a plain `http://` tailnet address.
A comment saved while another device's newer save is pending reaches the server the next time the page is opened on the same device.
If a tab is closed while its reader types and another tab of the same page on the same device holds newer data, the other device's comment can be lost.

## Send to agent

Send to agent hands a page's comment export to the agent session that wrote the page, queued until its current turn ends, from the desktop or the phone.
The targets are the ids in the page's session line, newest first; an id that is not a UUID is skipped.
Routing is live first: a connected pi of an older session gets the send now rather than leaving it to wait for a newer session whose pi is registered but away (a sleeping Mac).
Only a send made in the server's first minute, while the pis reconnect, waits for the newest registered session instead of going to the first pi that comes back; after that minute it is routed live first like any other.

A pi reaches the server through the `agent-pages-inbox` pi extension (in Sylvain's dotfiles, `pi/.config/pi/extensions/agent-pages-inbox`).
On every session start it holds one stream, `GET /api/agents/listen`, naming its session, pid, host and harness (`paseo`, `herdr` for an hc terminal, else `pi`), and it reads the server's address from `base_url`.
The server keeps one stream per session, sends a heartbeat every 20 s, drops a stream the moment its socket closes, and tells an older stream of the same session `superseded` when a new pi takes it.
A pi loads extensions when it starts, so each running pi needs `/reload` or a restart once after the extension is installed.

`POST /api/send` with `{"page": <page id>, "id": <send id from the page>, "markdown": <the export>}` stores the send and answers at once with its route.
The page's Send to agent button (`template/agent-send.js`, in the More menu next to Export) posts the export Export builds (`bn.review.markdown()`), up to 600 kB, since the server cannot rebuild it: it depends on how each comment anchors in the reader's browser.
The server adds that script and the page's id to every page it serves with the review layer, unless the page's `data-doc-id` is shared; how the button shows each route is in `template/README.md`, "Send to agent".

- `live`: a pi holds one of the sessions; it gets the send, fetches the export, claims it and queues it as a follow-up; the claim names the pi's pid and host, so a retry whose first answer was lost is answered again for that same pi only.
- `pending`: a session's pi is registered but not connected (a live process on this machine, or another machine's pi that never closed its registration and was connected in the last 24 hours), a Paseo agent holding the session is running, or the server started less than a minute ago; the send goes to that pi when it connects, and one waiting for the start is routed again after that minute.
  A send waiting on a running Paseo agent is also checked every 30 s: once the agent is idle the server sends it with `paseo send --no-wait`, since a send to a running agent would abort its turn, and after 30 minutes of a busy agent it is stored as `none`.
  The server asks Paseo for the agent's status with `paseo inspect` for at most 5 s, then reads the status Paseo stored.
- `paseo`: an idle Paseo agent holds the session; the server sends the export to it with `paseo send`.
- `resuming`: no agent holds the session but its pi session file is on this machine; the server imports it into Paseo with `--cwd <pages_dir>`, so the agent shows in the Paseo workspace `pages` and works in the session's own folder, then sends the export.
- `held`: the session file could be resumed, but a pi on this machine may have it open without the extension: a pi whose command line names the session, or a pi working in the session's folder with no registration.
  The page then offers Resume anyway, `POST /api/send` with `"force": true`, which skips this check only.
  A pi names itself `pi` in `/proc/<pid>/comm` and loses its arguments from `/proc/<pid>/cmdline`, so the folder is usually what finds it.
- `failed`: the session file changed in the last 2 minutes (a pi without the extension may have it open, forced or not), or the session's working folder is gone; the Export button still works.
- `none`: nothing holds or stores the sessions; the page then offers Start a new agent, `POST /api/send` with `"new": true`, which starts a Paseo agent in the page's folder on the export and adds its session to the page.

The page is listed as Sent when the delivery starts (the pi reports the queued message starting, or the server's Paseo command succeeded), so it reads as Open again once the agent revises the file; a claim that is released or taken back leaves the page as it was.
A claimed send that never started goes back to pending when its pi releases it, or when the session registers again and the claiming pi is gone: a dead process on the server's machine, or a new pi on the claimer's own machine (the server cannot look into another machine's processes).
Two pi on the same session on one other machine can therefore both deliver a send; this gap is accepted.
A click while a send waits makes a new send, which cancels the page's send only while no agent has taken it yet (state `pending`); once a send is claimed, the page disables its buttons until the send is final, so a click cannot deliver the export twice.
`GET /api/sends?page=<page id>` lists a page's sends with their state: `pending`, `claimed`, `started`, `failed`, `held`, `cancelled` when a newer send of the page replaced one still pending, or `none` when a send found no agent after waiting out the server's first minute or a busy Paseo agent, so the page offers Start a new agent.
The Paseo command lines are the config's `[harness.paseo]` keys; each runs as an argument list with no shell, and only UUIDs, the hex page id and paths the server chose fill their placeholders.

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

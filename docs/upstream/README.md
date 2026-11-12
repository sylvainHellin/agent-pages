# tutorLibrary

The lessons the `tutor` skill (`~/.agents/skills/tutor`) writes, in one place, each linked to
the workspace projects it explains. It answers one question: when did I learn which topic, for
which project? It is also where new lessons are started (from a topic or collected links) and where
answers go back to the tutor.

- Open: https://<machine>.<tailnet>.ts.net/tutor/ (tailnet only; HTTPS so the lesson pages'
  Export can write to the clipboard). Direct: http://<tailscale-ip>:8320/
- Phone: https://<machine>.<tailnet>.ts.net/tutor/app/ is the same app (Safari: Share → Add to Home
  Screen). Older home-screen icons point there, so the path stays.
- One project's lessons: `…/tutor/#/p/<project id>`; one lesson: `…/tutor/#/l/<slug>`.
  Put the project link in a project README to reach its lessons from there.

## One app for desktop and phone (`apps/ui`)

Vite + React + TypeScript + Tailwind v4 + shadcn/ui (radix, lucide icons), Pretendard (npm `pretendard`,
dynamic subset, served from `dist/assets`; no CDN). Quiet look: zinc neutrals, white surfaces, one teal
accent (#0e6e64), project colours only as small dots, hairlines, 150 ms transitions. One code base, laid out
by width: from 900 px a sidebar (Library / New lesson / Jobs, the projects, registry link); below it a
header and a bottom tab bar (Lessons / New / Jobs), bottom sheets instead of dialogs, 44 px touch
targets and safe-area insets for the iOS Web Clip. Every feature exists once and works at both sizes;
the checklist of what the two old front ends did is `apps/ui/FEATURES.md`.

Routes (hash):

| route | view |
|---|---|
| `#/` | month board: a calendar month (‹ › Today, ← →), each day's lessons as one-line chips (project dot, ring = learning, filled = understood), "+N more" popover; search (`/`), archived toggle. Phone: the month compact with dots and its lessons listed by day; tap a day to scroll there |
| `#/p/<id>` | one registry project: facts, notes, its board |
| `#/unlinked` | lessons without a project, as a board |
| `#/l/<slug>` | the lesson page (iframe) with its bar (status, projects, edit, text size, earlier/later, link) and the review bar; tap the text (or Esc) to hide the bars |
| `#/new` (`#/links`) | new lesson: topic, project, "Search the web for more sources", shared link inbox, recent jobs |
| `#/jobs` | all jobs with state, Log, Stop / Cancel, Read |
| `#/add?u=<url>&n=<note>` | adds a link (iOS Share-Sheet shortcut target), then `#/new` with it selected |

Build (the server serves `apps/ui/dist` at `/` and at `/app/`; without a build it answers 503):

```bash
cd apps/ui && npm install && npm run build      # then reload the page; no service restart needed
```

`index.html` is served with `Cache-Control: no-cache`, the hashed files under `assets/` as immutable.
`vite.config.ts` uses `base: './'`, and every server URL is resolved against the app root
(`./`, or `../` from `/app/`, see `src/lib/api.ts`), so the build works at `/`, `/app/`, `/tutor/` and
`/tutor/app/`.

Develop against a test copy (never the live data):

```bash
T=/tmp/tl-ui; mkdir -p $T/data; cp -r lessons $T/lessons
(cd services/api && TUTOR_LESSONS=$T/lessons TUTOR_DATA=$T/data TUTOR_STATE=$T/data/state.json \
  TUTOR_TUIOS_SESSION=tutor-test HOST=127.0.0.1 PORT=8329 python3 -u server.py &)
cd apps/ui && npm run dev                       # http://127.0.0.1:8328 (and /app/), proxies /api and /lessons to 8329
```

Jobs in a test copy start real agents. For UI work set `TUTOR_PI=/bin/false` and `TUTOR_TUIOS` to a stub
that answers `list-windows` / `new-window` / `capture-pane` from a JSON file; then report a job done with
`curl -X POST -d '{"slug":"<lesson>"}' 127.0.0.1:8329/api/jobs/<id>/report`.

### Adding a feature (once)

1. Data and API calls go into `src/lib/store.ts` (lists: lessons, projects, inbox, jobs; polling) or a
   view's own state. What the user types belongs in `src/lib/draft.ts` (localStorage), never in a list
   that polling replaces.
2. Build the UI from `src/components/ui` (shadcn; add more with `npx shadcn@latest add <name>`) and the
   shared pieces in `src/components` (`bits.tsx`: chips, status, `ResponsiveDialog` = dialog on desktop,
   bottom sheet on a phone; `lessons.tsx`, `jobs.tsx`, `lesson-meta.tsx`, `shell.tsx`).
3. Make it work at both widths with Tailwind classes (`desk:` = 900 px and up, `max-desk:` below); only
   when the controls differ (toolbar vs. ⋯ menu in the reader bar) render both from the same handlers.
4. Add a line to `apps/ui/FEATURES.md`, check it at 1440×900 and 393×852, `npm run build`, commit.

## New lessons and jobs

A lesson starts from a topic, from links, or both. The link inbox (`data/inbox.json`) is shared by all
devices: paste any text with links (one or many; the server splits it), use Paste (clipboard), or send a
page from Safari through the Share-Sheet shortcut (help on the New page). New links are selected for the
next lesson. "Search the web for more sources" (on by default) lets the agent search with Exa
(`mcp__exa` in codemode or the exa-search skill); off = only the given links and the workspace.
"Make a lesson" posts `api/jobs`.

A job is an interactive `pi --session-id <job id>` in a window of the tuios session **`tutor`**
(`services/api/jobs.py`; cwd `~/workspace`, so the pi session is stored with the workspace sessions and
can be resumed or watched: `tuios attach tutor`). One job runs at a time; others wait ("waits for the
job before it"). The agent reports the end with `tutor-job-done <job id> <slug>`
(scripts/job_done.py → `POST /api/jobs/<id>/report`); if it goes idle without reporting, or runs past
45 min, the job becomes `attention` (look at the window). Lesson ↔ session map: `data/lesson_sessions.json`.
The app polls jobs every 5 s while one is active (20 s otherwise, and on return to the app) and
refreshes only the lists, so typing is never interrupted. Drafts (topic, links, note, project, search,
selection) stay in localStorage `tl-new-draft`.

Every job is a real agent run with bash on the Spark, billed to the Claude account. The fetched pages
are treated as untrusted in the prompt, and the API is tailnet only, but there is no auth: anyone on
the tailnet can queue a job.

## Review round trip

In the reader, answer the recall questions, or select text (long press on a phone) and "Add comment".
The bar under the page counts them; "Send to tutor" posts the page's export to
`POST /api/lessons/<slug>/feedback` (saved in `data/feedback/<slug>/`). That queues a revise job: the
line goes into the lesson's own agent window if it is still open and idle, else a new window resumes
the lesson's pi session, else a fresh agent reads the page. The bar shows "Waiting for the tutor…" /
"revising" / "waiting for you", and the page reloads by itself when the revision is done.

Answers, comments and notes live in the browser (report.js, localStorage `anno:<slug>*`).
`lessons/_assets/review-sync.js` (loaded by the app, same origin as the pages) mirrors them to
`data/review/<slug>.json` through `GET/POST /api/lessons/<slug>/review`: pulled before a lesson page
loads and when the app comes back to the front (the page reloads if something changed), pushed every
1.5 s while reading, when leaving the lesson and when the page is hidden. If two devices changed it
since the last sync, the two are merged (comments by id, answers by question, notes concatenated).

- **Phone reading**: the app adds `apps/ui/public/reader.css` to the lesson page (rules apply below
  720 px) and stacks wide tables as one card per row (`src/lib/reader-page.ts`; the lesson HTML and
  `lessons/_assets` stay as they are).
- **Text size**: a pinch on a phone changes the lesson's text size (80-200 %) instead of zooming the
  page, so lines rewrap to the screen. The app sets `--tl-fs` on the page's `<html>` and reader.css
  scales the root font size by it; the page's own zoom is off in the reader (viewport meta, `touch-action`,
  cancelled `gesture*` events); iOS `gesturechange.scale` or the two-finger distance drive it, the line
  under the fingers stays put, and the size is kept per device for all lessons (localStorage
  `tl-text-scale`). A− / % / A+ in the reader's ⋯ menu do the same at any width.
- **Focus mode**: a single tap on the lesson text (not a link, control, answer field, summary, figure or
  comment; not a scroll, selection or pinch) hides the app bar, the review bar and the page's own toolbar;
  tap again to bring them back. Esc or ⋯ → Hide controls on desktop. A hint shows the first time.
- **Local visuals**: lesson and revise prompts (and the tutor skill) tell the agent to reuse images,
  renders, GIFs and videos already in `~/workspace` projects, copied into `lessons/<slug>/media/`
  (video as H.264 mp4 ≤ 720 px; the server answers byte ranges, which iOS needs for `<video>`).
- **Links between lessons** (`#/l/<slug>` or `../<slug>/`) are handled by `report.js`: inside the app
  they switch the reader (same iframe, no extra history entry), on a page opened alone they go to the
  sibling folder; links to other sites open a new tab.

## API

`GET /api/lessons[?project=<id>]`, `GET /api/projects`, `PATCH /api/lessons/<slug>` (title, topic,
summary, projects, tags, status), `POST /api/lessons/<slug>/opened`, `GET/POST /api/inbox`,
`DELETE /api/inbox/<id>`, `POST /api/jobs`, `GET /api/jobs/<id>/log` (the agent window's screen),
`POST /api/jobs/<id>/cancel`, `POST /api/jobs/<id>/report` (agents only, refused with an Origin
header), `POST /api/lessons/<slug>/feedback`, `GET/POST /api/lessons/<slug>/review`, `GET /healthz`.
Mutations from a browser must come from the same origin.

## Layout

```text
lessons/
  _assets/                 report.css, theme-tum.css, report.js (copied from the skill), review-sync.js
  YYYY-MM-DD_<slug>/
    index.html             the lesson page, revised in place each round
    lesson.json            metadata the library reads (below)
    figures/               <name>.tex + rendered <name>.svg
apps/ui/                   the app (Vite + React + shadcn/ui); FEATURES.md; public/ = manifest, icons, reader.css
  src/lib/                 api.ts (URLs, types), store.ts, draft.ts, router.ts, sync.ts, format.ts (dates,
                           calendar, project colours), reader-page.ts (what the app adds to a lesson page)
  src/components/          shell, board (month grid, phone month), lessons, lesson-meta, jobs, bits; ui/ = shadcn
  src/views/               LibraryView (board for home, project, unlinked), ReaderView, NewLessonView, JobsView
  dist/                    build output, served at / and /app/ (gitignored)
services/api/              server.py (stdlib HTTP), library.py (lessons, registry, state),
                           jobs.py (link inbox + pi agent jobs in tuios session `tutor`)
scripts/serve.sh           deployed server, run by ws-tutorLibrary.service
scripts/new_lesson.py      `tutor-lesson` on PATH: creates a lesson folder
scripts/job_done.py        `tutor-job-done`: an agent reports its job
data/                      state.json, inbox.json, jobs/, feedback/, review/ (gitignored)
```

## lesson.json

```json
{
  "title": "KV cache transfer between model families",
  "topic": "LLM inference",
  "summary": "one line for the list",
  "created": "2026-11-05",
  "projects": ["render2bim"],
  "tags": ["llm"],
  "status": "learning"
}
```

`projects` holds ids from `_registry/projects.yaml`; the server refuses others. A lesson
whose project was later renamed or removed shows that chip in orange. `status` is
`learning` (round trip still open), `understood` (recall answers right) or `archived`
(hidden unless "Archived" is on).

## Create a lesson from a shell

```bash
cd ~/workspace/projects/render2bim          # the project is taken from the cwd
tutor-lesson kv-cache --title "KV cache transfer" --summary "..." [--project other] [--no-project]
```

It copies the skill's `assets/lesson.html` into `lessons/<date>_<slug>/index.html` with the
placeholders filled and prints the folder and the URL. Link more projects later with "Link to
projects" in the lesson bar or `PATCH /api/lessons/<slug>` with `{"projects": [...]}`.

## Run

```bash
cd apps/ui && npm run build                    # after any change in apps/ui
systemctl --user restart ws-tutorLibrary      # deployed (<tailscale-ip>:8320); needed after server changes
HOST=127.0.0.1 PORT=8329 python3 services/api/server.py   # a second copy for testing (see above)
```

Registry: port block 8320-8329 (8328 = Vite dev, 8329 = test server) and the `/tutor` route in
`_registry/ports.yaml`.

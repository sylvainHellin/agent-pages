# Decision log

## 2026-11-22 - _data/pages.json is migrated once into items.json by agent-pages migrate-items, and the list never reads it
Why: pages.json is keyed by URL while items.json is keyed by data-doc-id, so the read-time fallback lost a page's fields when the page moved and handed them to any new page written at the old URL; Sylvain's pages.json held only 3 entries, each {"status": "understood"}.
Rule: `agent-pages migrate-items`, run by hand, copies the fields of each pages.json URL that names an indexed page into that page's items.json entry (understood -> done, learning -> open), never over a field the entry already has.
Rule: migrate-items runs once with the server stopped, since it is its own process and the items.json lock holds only within one process.
Rule: a URL with no page now, or whose data-doc-id several pages share, is printed and dropped; pages.json is then renamed pages.json.migrated, so a second run does nothing; the server never runs the migration at start.
Rule: lesson.json stays a live fallback for tutor lessons, since the tutor skill keeps writing it.
Rejected: keeping the read-time fallback (it loses fields on a move); migrating at server start (an invisible write to Sylvain's data).
Source: review of 8ed9c1c..one-list, dispatch brief from Sylvain's session, 2026-11-22.
Status: accepted

## 2026-11-18 - The /lessons/ route refuses dot files, dot segments and anything that resolves into _data
Why: the route checked only that the resolved file stayed inside the lessons folder and refused _data by the raw request string, so /lessons/<lesson>/.env, /lessons/./_data/state.json and /lessons/<lesson>/../_data/state.json were served; a review of 0884177 found it.
Rule: a /lessons/ request with a . or .. segment or a hidden() segment is refused before any route below it, _assets included.
Rule: a lesson file is served only when its resolved path, relative to the resolved lessons folder, has no hidden() segment and no _data segment, so a symlink into _data is refused too.
Rule: lesson pages, their figures and audio, and /lessons/_assets/ (the repo template) keep working; browsers send ../_assets/ already resolved to /lessons/_assets/.
Rejected: a second hidden rule for lessons (hidden() from reports.py is the one rule).
Source: dispatch brief from Sylvain's session, 2026-11-18.
Status: accepted

## 2026-11-18 - What is served is decided by the file a path resolves to, after every symlink
Why: the hidden-folder check read only the requested path, so a harmless-looking link (notes/link.html -> ../.git/config, a folder link notes/g -> ../.git, a link out of every root) served private content; a review found it on 60550a8 and its parent.
Rule: a file is served only when its resolved path is inside a resolved root with no hidden() segment below it; reports.servable() is the one check for pages, assets, the listing and agent-pages url and open.
Rule: a link to a servable page keeps working at the link's URL and is listed once, under the target's own URL, so the target's comments keep syncing.
Rule: the lessons folder's _assets link into the repo template keeps working through the template route, which runs before this check.
Rejected: refusing every symlink (links between servable folders are legitimate); following links only inside one root (a link to a servable file in another root is harmless).
Source: dispatch brief from Sylvain's session, 2026-11-18.
Status: accepted

## 2026-11-18 - A repo's .sync folder under a root is served; every other hidden folder stays private
Why: the skills tell agents to save a page in the repo's .sync/, and ~/Documents/basenord became a git repo with a real .sync/ folder, which the server and agent-pages url refused as hidden.
Rule: a path segment named exactly .sync passes the hidden-folder check in the server (pages, their assets, the index and the app's listing) and in agent-pages url and open; reports.hidden() is the one check for both.
Rule: every other dot segment (.git, .agents, .stversions, dotfiles) and SKIP_DIRS stay refused, including below .sync (.sync/.cache); the CLI now refuses SKIP_DIRS as the server does.
Rule: the app groups a page in <area>/<repo>/.sync/ under <area>/<repo>, as it groups the code root's mirrored <org>/<repo>/sync/.
Rejected: serving .agents too (agent state, not for the reader); a config list of served dot folders (one fixed name is enough).
Source: chat with Sylvain, 2026-11-18.
Status: accepted

## 2026-11-16 - A page records the agent sessions that wrote it, and the export names them
Why: a comment export pasted into a new session lost the conversation behind the page, so the new agent answered without it.
Rule: agent-pages new writes <meta name="agent-pages-session" content="<ids>"> from --session, else $AGENT_PAGES_SESSION, else $PI_SESSION_ID; ids are space-separated, oldest first.
Rule: an agent revising the page from another session appends its id with agent-pages session <path> --add; the export prints "Written in agent sessions: ..." under the file path.
Rule: existing pages get no backfill; the line appears once a session creates or revises them.
Rejected: only the creating session (a revising session holds context too); a server-side index of pages to sessions (the id has to travel with the file and the export).
Source: chat with Sylvain, 2026-11-16.
Status: accepted

## 2026-11-15 - Comments of every served page sync through the server, keyed by data-doc-id
Why: comments stayed in the browser of the device that wrote them, so a review could not continue on another machine.
Rule: the server adds review-sync.js to every page it serves and stores its state in <lessons_dir>/_data/review/pages/; a data-doc-id used by two pages is refused and logged.
Rule: the merge records deletions, so a comment deleted on one device does not come back from another.
Rule: agent-pages open opens the server's copy once it serves the current file (15 s wait), else the file.
Rule: comments already stored in a browser from file:// pages are left there; no import or migration.
Rejected: sync code inside report.js (the public template must work as a plain file); keys by path (a move loses the comments); syncing only the app's Reports view (open shows pages outside it).
Source: chat with Sylvain, 2026-11-15.
Status: accepted

## 2026-11-11 - Lessons live in one central folder, ~/Documents/perso/03-resources/lessons, and the tutor skill writes there
Why: the app indexes one folder; Syncthing already mirrors ~/Documents between the Mac and the home server.
Rejected: keeping each lesson next to its topic and indexing all of ~/Documents (more code, slower index).
Source: report comment export on 2026-11-10_tutor-library-review.html.
Status: accepted

## 2026-11-11 - Projects come from the vault's open 02-areas and 01-projects notes
Why: the vault is the single source of truth for projects; Suhyung's YAML registry does not exist here.
Rejected: no project grouping at first.
Source: report comment export on 2026-11-10_tutor-library-review.html.
Status: accepted

## 2026-11-11 - New lesson from the phone starts agents on the same Paseo runner as Send to agent, built after it
Why: the week of reading on the phone this waited for is over, and Send to agent brings the runner that replaces tuios in jobs.py.
Rejected: never building it; a separate runner for lessons.
Source: report comment export on 2026-11-10_tutor-library-review.html; updated by the comment export on 2026-11-21_agent-pages-next-steps.html.
Status: accepted

## 2026-11-11 - Suhyung's touch and IME fixes go into the report-html template; Vim keys stay on with a mouse and off on touch screens
Why: every report page becomes usable on the phone, and the lesson pages share one report.js with the template.
Rejected: his default of Vim keys off everywhere; keeping his fork inside the app only.
Source: report comment export on 2026-11-10_tutor-library-review.html.
Status: accepted

## 2026-11-11 - The code lives in the repo sylvainHellin/agent-pages; Suhyung is credited in the README and the LICENSE
Why: the zip had no history or license; his share package was the first commit until the history was squashed for the public release on 2026-11-12, and GitHub never showed it under his name anyway.
Rejected: the names lesson-library, readback, folio and margin.
Source: report comment exports on 2026-11-10_tutor-library-review.html and 2026-11-11_page-kit-project.html; chat with Sylvain, 2026-11-12.
Status: accepted

## 2026-11-11 - agent-pages is one project: report template, themes, config, CLI, server with the library app, page and tutor skills, figure backends
Why: the pieces depend on each other but lived in four places (template in ~/Documents without git, CLI and report-web in dotfiles, skills in dotfiles, the app here), and Suhyung should be able to use and improve all of them.
Rule: machine values (base URL, roots, theme, Vim default on, figure backend tex-fig, matplotlib or none) live in a user config file, never in the repo; tex-fig stays its own repo, used only when the config picks it.
Rule: the first version moves everything at once, including the server merge that retires report-web.
Rejected: core first and the server merge second.
Source: report comment export on 2026-11-11_page-kit-project.html.
Status: accepted

## 2026-11-12 - Public under the MIT license, copyright Sylvain Hellin and Suhyung Jang, with the history squashed into one commit
Why: Suhyung agreed by mail on 2026-11-12; the old history held a real research report as the template's example (unpublished scope, colleagues' names), now an invented Tidepool page, and squashing removes it more simply than a filter-repo rewrite.
Rejected: publishing the history as it was; rewriting it file by file with filter-repo.
Source: Suhyung's mail of 2026-11-12; report comment export of 2026-11-12.
Status: accepted

## 2026-11-11 - Served from the home server on 127.0.0.1:8095 (systemd user unit agent-pages.service), published on the tailnet only with tailscale serve on ports 15443 and 16443
Why: the server has no login, so Tailscale is the access control, as for report-web; HTTPS lets the Export button write to the clipboard.
Rule: one process for report pages, lessons and the app; 15443 keeps report-web's page links working and 16443 the phone app's, and the old lesson server port 8320 is gone.
Rejected: Funnel or any public port.
Source: report comment export on 2026-11-10_tutor-library-review.html.
Status: accepted

## 2026-11-11 - The default icon is the app's logo mark, three lines of text on a Basenord tile, one SVG rendered for tabs, iOS and the library app
Why: the mark in the app's sidebar reads better at tab size than the page-with-a-comment drawing it replaced on 2026-11-12, and the tab now matches the app.
Rule: template/icon/icon.svg is the only source; template/icon/build.py renders every size.
Rejected: a page with a comment in its margin (too busy at 16 px), a highlighted line, a proofreading caret, a round-trip arrow, a bookmark ribbon.
Source: chat with Sylvain, 2026-11-11 and 2026-11-12.
Status: accepted

## 2026-11-11 - A page title names the subject in eight words at most; the finding goes in the lede
Why: finding-style h1s ran to fifteen words and did not scan in a tab, a list or a link.
Rule: the same title in <title> and the h1, e.g. "How BrowserOS neo works".
Rejected: an h1 that states the finding.
Source: chat with Sylvain, 2026-11-11.
Status: accepted

## 2026-11-11 - agent-setup points to this repo for report pages and lessons instead of carrying its own template and tutor skill
Why: agent-setup is public for students, and since this repo went public on 2026-11-12 a pointer reaches them; two copies would drift.
Rule: agent-setup's README, TOOLS.md and skills README name this repo, and its pi settings example lists ~/code/agent-pages/skills; this README's Install and Configure must keep working from a fresh clone with an empty config.
Rejected: keeping the copies in agent-setup (done only while this repo was private).
Source: chat with Sylvain, 2026-11-11 and 2026-11-18 (PERSO-299).
Status: accepted

## 2026-11-11 - The project is named agent-pages, the app Agent Pages: one tool for the HTML pages an agent writes for a person to read and comment on
Why: a report and a lesson are two kinds of the same page, and the library app shows both, so one name covers the tool, the CLI, the skill and the app.
Rule: distribution and command agent-pages, package agent_pages, config ~/.config/agent-pages/config.toml (AGENT_PAGES_CONFIG), skill agent-pages next to tutor, app name Agent Pages; localStorage keys, API routes, served paths and file formats keep their names.
Rejected: keeping the name pages.
Source: chat with Sylvain, 2026-11-11.
Status: accepted

## 2026-11-11 - A page carries the lesson tag by a marker line in its head, wherever it lives
Why: many pages written outside the tutor skill teach a concept and belong with the lessons, and a marker inside the file travels with it through moves and Syncthing.
Rule: `<meta name="agent-pages-kind" content="lesson">` makes a page under the server's roots an in-place lesson; absent or any other value, it is a report.
Rule: an in-place lesson has the slug page-<first 12 hex of the SHA-1 of its server URL>, and its status, projects, tags, topic, summary and title override live in <lessons_dir>/_data/items.json under the page's data-doc-id (else its URL), never in the page file (2026-11-22: the older URL-keyed pages.json is migrated once by agent-pages migrate-items).
Rule: the line is the page's lesson tag: adding or removing the tag lesson in the app writes or removes it (PATCH /api/items); pages in the lessons folder and tutor lessons keep their lesson tag.
Rejected: moving pages into the lessons folder (links into repos break, the page leaves its work); guessing the kind from headings (wrong both ways, the eyebrows are free text).
Source: chat with Sylvain, 2026-11-11.
Status: accepted

## 2026-11-11 - The app follows the app theme of the config and shares light and dark with the pages
Why: the app's own zinc and teal look clashed with the themed pages it frames, and on the phone a lesson could not switch between light and dark once focus mode hid the page's bar.
Rule: app_theme in the config names the app's theme and defaults to lesson_theme, so the app can wear another look than the lessons (2026-11-12); Sylvain's own config puts both in Basenord, lessons included, since they are personal learning and nothing ties them to TUM (2026-11-12).
Rule: while a page fills the screen (the lesson reader, a report page), the app's bars borrow that page's own tokens, so the frame around a page never mixes two themes; the library views keep the app theme (2026-11-12).
Rule: the server serves the app theme's tokens renamed --pg-* at /api/theme.css, and apps/ui/src/index.css maps the shadcn tokens onto them; the app's own look stays only as the fallback when that stylesheet does not load.
Rule: one light or dark state for the app and the pages: the localStorage key bn-theme with the OS setting as fallback, as report.js; a switch in the app chrome sets it on the app and every open page, and the page's own button sets it on the app.
Rejected: linking the theme file as is (the page tokens --muted, --accent, --primary and --ring collide with shadcn's); loading report.css in the app (its page styles and 270 kB of fonts).
Source: chat with Sylvain, 2026-11-11.
Status: accepted

## 2026-11-22 - Every page is in one list with a status, Open, Sent, Done or Archived, and lesson is a tag
Why: Sylvain screens what still waits on him and what waits on an agent in one place; lessons and reports were two lists only because two older tools were merged on 2026-11-11.
Rule: the app opens on the Open pages, newest change first, with the month board one tap away; tags are free and editable on every page, and lesson is one of them.
Rule: Sent is set when Send to agent starts delivering the export; a Sent page goes back to Open when its file changes after that, ignoring writes the server made itself.
Rule: tutor lessons map learning to Open and understood to Done; the status lives in items.json, never in the page file.
Rejected: keeping two kinds with a move between them; a Lesson switch as a special control (Sylvain asked for a general function, so it is a tag); naming the first status To review (Sylvain chose Open).
Source: report comment export on 2026-11-21_agent-pages-next-steps.html.
Status: accepted

## 2026-11-22 - Send to agent delivers a page's export into the pi session that wrote it, live if one holds it, else resumed in the Paseo workspace pages
Why: one button replaces copying the export into the right session; Export stays for any other place.
Rule: a running pi with the agent-pages-inbox extension registers its session on start and holds one idle SSE stream to the server; no polling, and it deregisters on exit.
Rule: an export for a live session is queued as a follow-up, so a busy agent finishes its turn first; the session is always continued, never forked.
Rule: a session nobody holds is resumed with paseo import into the Paseo workspace pages (folder ~/pages); a session that may be held by a pi without the extension (a pi in its folder on this host, or its file written in the last 2 minutes) is not resumed without Resume anyway; a session with no file on the server offers Start a new agent.
Rule: a page records only harness names and session ids; the commands per harness ([harness.paseo] import, send, new, inspect) live in the user config and run as argv with no shell, so nothing from a page reaches a command except validated ids.
Rule: the page posts its export; a second click replaces only a send no agent has taken yet.
Rejected: a constant ping from every pi (Sylvain: wasteful for a rarely used button); a herdr space named pages (Paseo shows on the phone and the Mac); forking the session; storing a continue command in the page (the server would run page content).
Source: report comment export on 2026-11-21_agent-pages-next-steps.html; design reviewed in .agents/workflow/send-to-agent/state.md.
Status: accepted

## 2026-11-22 - Pages read offline through a hand-written service worker that keeps every page opened and downloads every Open page up to 150 MB
Why: on the train every reopen downloaded the page and the 400 kB template again, and with no signal nothing opened.
Rule: every file and page answers with an ETag and 304 when the copy is current; the worker serves its copy offline and revalidates online.
Rule: the app downloads every Open page when the list loads, newest change first, under a 150 MB budget, with a switch to turn it off; a page opened or downloaded by hand is never evicted, an auto-downloaded page is removed once it is no longer Open or falls past the budget.
Rejected: vite-plugin-pwa (a new dependency for what a short worker does); downloading on Wi-Fi only (iOS gives a web app no way to tell Wi-Fi from cellular).
Source: report comment export on 2026-11-21_agent-pages-next-steps.html; research .agents/research/2026-11-21-pwa-offline.md.
Status: accepted

## 2026-11-25 - The page bar keeps what is used while reading; actions clicked once per round and settings sit in a More menu
Why: the bar had grown to sixteen controls in the app's page reader, and Sylvain found it too busy.
Rule: the bar shows Back, the outline button, the title, search, the change marks, Pick, the comments and answers counter, the page's status and a More menu (three dots) at its right end.
Rule: the More menu holds Send to agent, Export Markdown, Clear all, the light or dark switch and Vim keys; the app adds Download for offline and Open the page alone to it (#bn-menu-app); Cmd+Shift+X and the comment panel keep Export, Send and Clear one step away.
Rule: the bar no longer names the current section next to the title; the outline highlights it instead.
Rule: the tags button left the page bar, since the status button opens the same Status and tags dialog.
Source: chat with Sylvain, 2026-11-25.
Status: accepted

## 2026-11-25 - Every page opens in one reader, the page reader, and lesson is only a tag
Why: the one list (2026-11-22) made lesson a tag, but a lesson still opened in its own reader with a second app bar above the page's bar, the title twice and two More menus.
Decision: `#/r/<url>` reads every page, tutor lessons included; `#/l/<slug>` only goes on to it; text size, Hide the bar, Earlier and Later lesson and Copy link join the page's More menu; the lesson reader, its review bar, the app's copy of the review sync and the reader's revise-job state are removed (the page runs its own review sync, nothing in the app starts a revise job since Send to tutor went).
Rejected: keeping two readers and only folding the lesson reader's bar into the page's bar, since the hidden split between lessons and other pages would stay.
Status: accepted

## 2026-11-26 - The list header is two lines: search with the view controls, then status tabs with a Tags menu
Why: Sylvain found the top of the list ugly: a search field squeezed to a third of the line, pill chips for the status and two wrapping rows of tag chips (seven rows of chips on a phone), and a "168 pages, 42 changed this week" line floating in the middle.
Rule: the first line is the search field, as wide as the line allows, then Select and List / Month.
Rule: the status is a row of underlined tabs with their counts; the tags sit behind one Tags button at the end of that row, a searchable menu with counts, and the picked tags show under the tabs only while some are picked.
Rule: the list header shows no stats line, since All carries the total and the day headings show what changed lately; the board footer keeps its month counts.
Rejected: keeping the 12 most used tags as chips with "+N more" (they wrap into rows that push the list down, and most tags label one page).
Source: chat with Sylvain, 2026-11-26.
Status: accepted

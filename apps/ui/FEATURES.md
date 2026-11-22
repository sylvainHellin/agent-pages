# Tutor Library UI: feature checklist

The union of what the two old front ends did (`apps/web`, the desktop library at `/tutor/`, and
`apps/mobile`, the phone app / iOS Web Clip at `/tutor/app/`). Every item is built once in `apps/ui`
and must work at desktop width (1440×900) and phone width (393×852). Origin of each item:
**W** = old web, **M** = old mobile, **W+M** = both, **new** = added in the rewrite.

## Results (2026-11-05, test server 127.0.0.1:8329 on a copy of lessons/, agent-browser; redesign re-check 2026-11-06)

D = desktop 1440×900 (`/`), P = phone 393×852 (`/app/`). ✓ = exercised in the browser at that size;
✓s = same component rendered and opened at that size, the action itself exercised at the other size;
n/a = replaced at that size by design (noted). Jobs ran against a stub `tuios` (`TUTOR_TUIOS`,
`TUTOR_PI=/bin/false`), so the whole queued → running → done/attention flow was real server code
without an agent. No console errors or page errors at either size.

2026-11-22 (one list, branch one-list): rows marked **L** were exercised on a temp server over copies of the real
pages (152: 149 under the roots, 3 tutor lessons) in BrowserOS through Playwright, at 1440×900 and 390×844.

2026-11-06 (redesign: month board, pinch text size, focus mode, new look): rows marked **R** were
exercised again after the redesign; rows 57-65 are new. Touch input came from CDP `Input.dispatchTouchEvent`
with touch emulation (Chrome), so the two-finger fallback and the pointer-based tap logic ran for real;
iOS `gesture*` events and Safari's own zoom cannot be produced headless.

| # | Feature | D | P | How it was checked |
|---|---|---|---|---|
| 1 | One build at `/` and `/app/`, root-relative URLs | ✓ | ✓ | test server and live (`/tutor/`, `/tutor/app/`): assets, `review-sync.js` from `<root>/lessons/` |
| 2 | Trailing-slash fix | ✓ | ✓ | live `https://…/tutor` → `/tutor/` |
| 3 | Desktop sidebar (All pages / New / Jobs badge / projects / areas / vault) **L** | ✓ | n/a | phone uses the tab bar (4) |
| 4 | Phone header + tab bar (Pages / New / Jobs) + badge, 44 px targets, safe areas **L** | n/a | ✓ | desktop uses the sidebar (3) |
| 5 | Web Clip: manifest, icons, apple meta, standalone | ✓ | ✓ | served at both paths (curl); iOS standalone itself not testable headless |
| 6 | Refresh button, toast "Updated" | ✓ | ✓ | sidebar button / header button |
| 7 | Toasts (errors, confirmations) | ✓ | ✓ | e.g. "Write a topic or select a link", PATCH errors via store |
| 8 | Document title per view | ✓ | ✓ | lesson title, New, Jobs, project |
| 9 | The one list, newest change first; List / Month **L** | ✓ | ✓ | 152 pages (149 reports, 3 tutor lessons) under Today / Yesterday / month headings; Month shows the same filtered pages on the board, footer "10 pages in November · 2 projects · 2 done" |
| 10 | Lesson facts (topic, title, summary, date, projects, tags, counts, revised, status) **R** | ✓ | ✓ | D: hover preview of a chip, "+N" popover rows (title, topic · projects); P: list rows (title, projects, status) |
| 11 | Projects with counts + "Not linked yet" **R** | ✓ | ✓ | D: sidebar list (dot, name, count); P: header list menu; the tile shelf was replaced |
| 12 | ~~Drag a lesson onto a project~~ | n/a | n/a | removed in the redesign; linking stays in the reader bar (24) |
| 13 | `#/p/<id>` project page **R** | ✓ | ✓ | facts, notes, registry link, copy link, the project's board (render2bim: 1 lesson in November) |
| 14 | `#/unlinked` **R** | ✓ | ✓ | board with the one lesson without a project |
| 15 | Search, `/` focuses it **R** | ✓ | ✓ | `/` + "urdf" → 1 chip in November, footer "Oct 2026 (1)" jumps; no match → "No match in November"; Esc clears |
| 16 | Status chips Open / Sent / Done / Archived / All **L** | ✓ | ✓ | Open 149, Done 2, Archived 1, All 152; Done after a status change lists the changed page first |
| 17 | Stats **R** | ✓ | ✓ | the board footer (9) |
| 18 | Empty library how-to, empty jobs | ✓ | ✓ | server on an empty lessons dir |
| 19 | iframe location.replace (no extra history) | ✓ | ✓s | D: a cross-link adds exactly one entry (the hash), Back returns to the first lesson; P: same iframe switched |
| 20 | reader.css + stacked wide tables **R** | ✓s | ✓ | P: `#tutor-app-css` present, 3 tables stacked (also after a cross-link); D loads it too, its rules apply < 720 px only |
| 21 | ~~"Opened" ping~~ | n/a | n/a | removed with the one list: nothing showed it |
| 22 | Reader bar: back, date, topic, title | ✓ | ✓ | |
| 23 | Status Open / Done / Archived, Sent shown (PATCH api/items) **L** | ✓ | ✓s | lesson reader menu and report page dialog; `_data/items.json` checked |
| 24 | Project chips with unlink, picker (search, keyboard, toggle) **R** | ✓ | ✓ | D: × and picker typed "process2" + Enter; P: sheet, tap toggles; 2026-11-06: picker opened at both sizes |
| 25 | Edit topic / title / summary / tags **R** | ✓ | ✓ | D dialog (topic), P sheet (tags); 2026-11-06: dialog and sheet opened from ⋯ |
| 26 | Earlier / later | ✓ | ✓ | both in the ⋯ menu since the redesign |
| 27 | Copy link, open page alone | ✓ | ✓ | "Link copied"; href = `<root>/lessons/<slug>/` |
| 28 | Cross-lesson links switch the reader | ✓ | ✓ | link inside the MuJoCo lesson → URDF lesson |
| 29 | Lesson written after the list loaded | ✓ | ✓ | new folder → opens; unknown slug → "Not found" |
| 30 | Review bar counts / hint **R** | ✓ | ✓ | "2 answers · 1 comment ready to send"; 2026-11-06 D: hint, then "notes ready to send" |
| 31 | Send to tutor (feedback POST, `sent()`) **R** | ✓ | ✓ | revise jobs created from each size; 2026-11-06 D: revise job created |
| 32 | Waiting / revising / attention state **R** | ✓ | ✓ | queued (lesson agent busy), running, attention (fake job); 2026-11-06 D: "Waiting for the tutor…" |
| 33 | Auto reload when the revise job is done **R** | ✓ | ✓ | iframe reloaded, "Page revised" (2026-11-06 D: job reported done with curl) |
| 34 | Review sync between devices | ✓ | ✓ | D answer → P; P answer → D after `localStorage.clear()`; P answer while D open → D reloads on focus |
| 35 | Topic textarea | ✓ | ✓ | |
| 36 | Project select (active first) | ✓ | ✓s | D via keyboard (a mouse click on an option clipped by the list edge hit nothing in the harness) |
| 37 | Search the web checkbox, default on | ✓ | ✓ | job JSON `search` |
| 38 | Multi-link textarea + live count | ✓ | ✓ | prose with 3 links (one in parentheses) → "Add 3 links" → 3 items |
| 39 | Paste from clipboard (appends) | ✓s | ✓ | headless Chrome denies clipboard-read: fallback toast checked, then `readText` stubbed to check appending |
| 40 | Note for added links | ✓ | ✓ | |
| 41 | Ctrl/Cmd+Enter adds | ✓ | n/a | no hardware keyboard on the phone |
| 42 | New links auto-selected, titles refreshed | ✓ | ✓ | Wikipedia title arrived |
| 43 | Select / unselect / clear / count | ✓ | ✓ | |
| 44 | Delete link with confirmation | ✓s | ✓ | AlertDialog, selection pruned |
| 45 | "lesson ✓" marks on used links | ✓ | ✓ | after the job reported done |
| 46 | Make a lesson (refuses empty, clears topic + selection) | ✓ | ✓ | job JSON: items, focus, project, search |
| 47 | Jobs on the New page | ✓ | ✓ | "Recent jobs" (right column / below on the phone) |
| 48 | Drafts restored after reload **R** | ✓ | ✓ | topic, project, search, links text, note, selection; 2026-11-06 D: topic |
| 49 | `#/add?u=&n=` | ✓s | ✓ | link added, selected, `#/new` |
| 50 | Home Screen / Shortcut help | ✓ | ✓ | collapsible |
| 51 | Job states and badges | ✓ | ✓ | queued, running, attention, done, failed, cancelled |
| 52 | Log viewer, refreshed, pinned to the end **R** | ✓ | ✓ | 2026-11-06: opened at both sizes, last stub line visible |
| 53 | Stop / Cancel **R** | ✓ | ✓ | D: Stop running, Cancel queued; P: Stop; 2026-11-06 D: Stop on the attention job → cancelled |
| 54 | Polling 5 s while active (20 s idle), "A lesson is ready" + Read, list reload | ✓ | ✓ | toast captured; a job created by another client appeared within 20 s |
| 55 | Polling never resets or blurs typing **R** | ✓ | ✓ | 2 poll cycles while typing: same DOM node, value, focus, caret (2026-11-06 D: 12 s of typing, 5 s polls) |
| 56 | Refresh on focus / visible | ✓ | ✓s | focus → lists + review pull |
| 57 | Month board, ‹ › Today, ← →, opens on the newest lesson's month | ✓ | ✓ | Nov → Oct → Sep, → key, Today; P: same header, search below |
| 58 | Day chips, click opens, hover preview, "+N more" popover | ✓ | n/a | 5 lessons on 3 Nov → 3 chips + "+2 more" → popover with 5 rows; chip → `#/l/<slug>`; P uses the list (59) |
| 59 | Phone: compact month with dots, list by day, tap a day scrolls | n/a | ✓ | 2, 3 and 5 Nov tapped: the day's heading lands under the header (room added below the last day) |
| 60 | Search / project filter / archived apply to the board | ✓ | ✓ | see 13-16; P: header menu → site2sim → 3 lessons |
| 61 | Pinch = text size (80-200 %), reflow, anchored, persisted | n/a | ✓ | two-finger touch: root font 16 → 32 px (clamped at 200 %) and 16 → 24.8 px (155 %), `tl-text-scale` saved, same sentence under the fingers; at 200 % every one of the 19 test lessons has scrollWidth = clientWidth |
| 62 | A− / % / A+ in ⋯ | ✓ | ✓ | 100 → 120 → 110 %, reset; menu stays open |
| 63 | Wide content at large text | n/a | ✓ | code `overflow-x: auto`, tables stacked, no image wider than the screen; `.q-meta` and long `.badge` wrap (they overflowed before) |
| 64 | Focus mode by tap / Esc / ⋯, hint | ✓ | ✓ | tap text → bars and the page's toolbar hidden, iframe full height, hint once; second tap back. No toggle on a link, a drag-scroll, a tap with a selection, a double click, a tap 0.4 s after a pinch |
| 65 | Look from the lesson theme | ✓ | ✓ | 2026-11-11, headless Chrome (Playwright), lesson_theme tum: body #FFFFFF / ink #1A1A1A, primary button #0065BD, Helvetica Neue; dark #07192B, primary #64A0C8; api/theme.css blocked → zinc, teal, Pretendard |
| 66 | Light / dark shared with the pages | ✓ | ✓ | 2026-11-11, 1440 and 390 px: OS dark with nothing stored → app and lesson dark (src os); More → Dark mode off → app light, page `data-theme=light` `data-theme-src=stored`, `bn-theme=light`; the page's own #bn-theme → app dark; theme-color follows the background; #bn-theme at 390 px inside the screen and on top at 100, 160 and 200 % text |
| 67 | One bar on a report page **L** | ✓ | ✓s | basenord page: Back, status, tags and Open alone inside the page's own bar; a page without the bar gets the app header with the same controls |
| 68 | Areas in two levels **L** | ✓ | ✓s | sidebar Areas under Projects, tum opens its sub-areas; phone header menu lists projects then areas |
| 69 | Tag chips filter the list **L** | ✓ | ✓ | #lesson picked: 16 pages with All, "Clear tags" |
| 70 | Tag editor, the lesson tag moves the page between readers **L** | ✓ | ✓s | report page: Done, tags "School, Family " → #school #family, Tag as lesson → `#/l/page-…` and the marker in the file; Remove tag lesson in the lesson reader → `#/r/…`, marker gone |
| 71 | Old links still open the page **L** | ✓ | ✓s | `#/r/<url>` of a lesson page goes on to `#/l/<slug>`; `#/reports` is the list |
| 72 | Select mode: checkboxes, Select all shown, Open / Done / Archived for the selection **L** | ✓ | ✓ | 2026-11-22 on a fresh copy (149 open): 3 rows → Done (Open 146, Done 5), Select all shown (145, 4 pages with a shared data-doc-id cannot be picked), Select none, Esc leaves; P: bar above the tab bar, a tap on a row toggles it, 2 → Archived, × leaves |
| 73 | Offline: app, lists and opened pages | ✓ | n/a | 2026-11-22, headless Chromium (Playwright) on localhost, a temp root with one `agent-pages new` page and an image: offline, reload → Reports list from the cached api/pages, page in the app with report.css, report.js, the image and the app's buttons in its bar; the page alone; an unsaved page → "Offline. This page was not saved…" |
| 74 | Offline badge | ✓ | n/a | 2026-11-22: "Offline: saved copies" after the worker's request failed (Chromium headless keeps navigator.onLine true when offline is emulated); gone once a request succeeds |
| 75 | "This page was updated" + Reload | ✓ | n/a | 2026-11-22: page edited on disk, first open shows the cached copy, the hint appears, Reload shows the revised text; no hint for a changed review state alone |
| 76 | Saved mark, Download for offline | ✓ | n/a | 2026-11-22: cloud mark on the row of the opened page; the page bar's download button → "Saved for offline reading, 2 new files, 3 kB" |

Not ported: nothing. Changed on purpose: the phone's one-tap Learning/Understood pill is now the same
status menu as the desktop; the phone's "Make a lesson" bottom sheet is the New page itself
(topic, project and search are always visible); the phone tab "Links" is now "New" (`#/links` still works)
plus a "Jobs" tab.

## App shell
1. One build served at `/` and `/app/` (Vite `base: './'`); API, lessons and assets resolved against the app root (`./` or `../`). **W+M**
2. Trailing-slash fix behind `tailscale serve` (`/tutor` → `/tutor/`). **W**
3. Desktop: sidebar with All pages (count) / New lesson / Jobs (active-job badge), the projects with "Not linked yet", the areas, Vault link. **W** (+ jobs nav **new**)
4. Phone: header (list picker or title + refresh), bottom tab bar Pages / New / Jobs with active-job badge, 44 px targets, safe-area insets. **M**
5. Web Clip: manifest, icons 180/192/512, apple meta tags, standalone display, theme colour. **M**
6. Refresh button (reload the pages + inbox, toast "Updated"). **M**
7. Toasts for errors and confirmations (Sonner). **W+M**
8. Document title per view. **W**

## The list (`#/`)
9. Home is the one list of every page: the tutor's lessons and the pages under the server's roots (`GET api/items`), newest change first (the file's change or the last status, tag or detail edit) under Today / Yesterday / This week / month headings; a List / Month switch (kept in localStorage `ap-view`) shows the same filtered pages on the month board (57), with month counts (pages · projects · done) in its footer. **new**
10. Page facts: list rows with the status mark, title, area · topic, projects, tags and the time; on the board a hover preview of a day chip (topic, title, summary, date, projects, tags, section/question counts, "revised … ago", status) and phone rows (title, projects, status). **W+M**
11. Projects with their page counts + "Not linked yet", then the areas: desktop sidebar list, phone header menu; counts follow the status picked in the list. **W**
12. ~~Drag a lesson onto a project tile to link it~~: removed with the board (2026-11-06); link from the reader bar (24). **W**
13. Project filter: `#/p/<id>` page with registry facts, notes, "Open in registry", "Copy link to this page", topics, its list; empty state. **W**
14. `#/unlinked`: pages without a project. **W**
15. Search over title, topic, summary, path, slug, projects, tags (every word must match); `/` focuses it. **W+M**
16. Status chips Open (the default) / Sent / Done / Archived / All, each with its count in the list as filtered by tags and search. **new**
17. Stats: n pages, m changed this week (list header); n pages in the month · m projects · k done (board footer). **W**
18. Empty list how-to. **W+M**

## Readers (`#/l/<slug>` for a lesson, `#/r/<url>` for any other page)
19. Lesson page in an iframe; slug changes replace the iframe location (no extra history entries). **M**
20. `reader.css` injected into the page (media-gated to phone widths) + wide tables stacked as cards. **M**
21. ~~"Opened" ping~~: removed with the one list; nothing showed it. **W+M**
22. Reader bar: back, date, topic, title. **W+M**
23. Status Open / Done / Archived in the bar of both readers (`PATCH api/items/<id>`); Sent shows while an agent has the page (Send to agent sets it, a change of the page file opens it again). **W+M**
24. Project chips with unlink, "+ project" picker (search, keyboard, toggle). **W**
25. Edit topic / title / summary (PATCH): dialog on desktop, sheet on phone; tags have their own editor (70). **W**
26. Earlier / later lesson. **W**
27. Copy link to the lesson; open the page alone in a new tab. **W**
28. Cross-lesson links inside a page switch the app's reader (`report.js` sets `#/l/<slug>` on the parent). **W+M**
29. A lesson made after the list loaded is found (reload once before "not found"). **M**
30. Review bar under the page: counts of answers / comments / notes ready, hint when empty, hidden when the page has no review layer. **W+M**
31. Send to tutor → `POST api/lessons/<slug>/feedback` with the page's export, `bn.review.sent()`, toast. **W+M**
32. Waiting / revising / attention state while a revise job for the lesson is active. **W+M**
33. Auto reload of the page when the revise job finishes ("Page revised"); failure toast. **W+M**
34. Review sync (`review-sync.js`): pull before the page loads, push every 1.5 s while reading, on leaving the lesson and when hidden; on return to the front pull and reload if changed. **W+M**

## New lesson (`#/new`, also `#/links`)
35. Topic textarea ("What do you want to learn?"). **W+M**
36. Project select (active projects first). **W+M**
37. "Search the web for more sources" checkbox, on by default. **W+M**
38. Shared link inbox: multi-link textarea (any text with links in it), live count of links found. **W+M**
39. Paste-from-clipboard button that appends to the textarea. **M**
40. Note for the added links. **W+M**
41. Ctrl/Cmd+Enter adds the links. **W**
42. Newly added links are auto-selected; titles refreshed a moment later. **W+M**
43. Select / unselect links, clear selection, count "N links selected / topic only". **W+M**
44. Delete a link (with confirmation). **W+M**
45. "lesson ✓" marks on links already used, linking to the lesson. **W+M**
46. Make a lesson → `POST api/jobs` {items, focus, project, search}; refuses empty; clears topic + selection on success. **W+M**
47. Lessons in progress shown on the page. **W**
48. Drafts (topic, links text, note, project, search, selection) in localStorage, restored on reload; selections of deleted links forgotten. **W+M**
49. `#/add?u=<url>&n=<note>` (iOS Shortcut target) adds the link, then shows New. **M**
50. Help: Add to Home Screen and Share-Sheet Shortcut. **M**

## Jobs (`#/jobs`)
51. Jobs list with status badges: queued ("waits for the job before it"), running (writing / revising, started … ago), attention (waiting in tuios session "tutor"), done (Read), failed (error), cancelled. **W+M**
52. Log viewer (agent window screen), refreshed while open, stays scrolled to the bottom. **W+M**
53. Stop (running / attention) and Cancel (queued). **W+M**
54. 5 s polling while a job is active; "A lesson is ready" toast and list reload. **W+M**
55. Polling refreshes lists only: never resets, re-mounts or blurs what is being typed. **W+M**
56. Refresh the pages and jobs when the window gets focus / becomes visible. **W+M**

## Board, reading and look (redesign 2026-11-06)
57. Month (the list's switch) shows the pages as a calendar board by the date in their name: header = month, ‹ ›, Today; Mon-first 7-column grid; ← → change the month; opens on the newest page's month; the month is kept per list (`#/`, `#/p/<id>`, `#/unlinked`, an area) while a page is open. **new**
58. A day shows its pages as one-line chips: the project's colour as a small dot (ring = open, ring with a centre = sent, filled = done, grey = archived) + the title; click opens the page's reader; hover shows the facts (10); more than 3 → "+N more" popover with the whole day; today has its day number filled in the primary colour. **new**
59. Phone (< 900 px): the month compact (day numbers with coloured dots) and that month's pages listed by day under it; tapping a day scrolls the list to that day. **new**
60. Search, the status and tag chips and the project or area filter (sidebar / phone header menu) filter the board; with a search the footer counts matches in the month and links the other months that have some. **new**
61. Pinch on a phone changes the text size of the lesson (80-200 %), so lines rewrap to the screen instead of running off it: the page's own zoom is off in the reader, the root font size follows the fingers (iOS `gesture*` events, two-finger touch distance elsewhere), the line under the fingers stays in place, and the size is kept for every lesson on that device (localStorage `tl-text-scale`). Done in `src/lib/reader-page.ts` + `public/reader.css`; the lesson HTML is unchanged. **new**
62. Text size A− / percentage (reset) / A+ in the reader's ⋯ menu at both sizes. **new**
63. At large text images, videos and SVG stay within the screen; code, formulas and unstacked tables scroll sideways; question rows and long badges wrap. **new**
64. Focus mode: a single tap on the lesson text (not on a link, button, field, answer, summary, figure, comment or the page's controls; not after a scroll, a text selection or a pinch) hides the app bar, the review bar and the page's own toolbar; tap again to bring them back; Esc or ⋯ → Hide controls on desktop; a one-time hint "Tap the text to show controls"; safe-area insets stay. (The reader never shows the phone tab bar.) **new**
65. Look: the colours and fonts of the app theme (`app_theme` in the config, else `lesson_theme`; Prussian ink and ocean blue for `basenord`, TUM blue #0065BD and Helvetica Neue for `tum`). While a lesson or a report page fills the screen, the app's bars take that page's own tokens (`borrowPageTokens` in `src/lib/theme.ts`), so a TUM lesson sits in a TUM frame; leaving it gives the app theme back. The server's `api/theme.css` carries the theme's tokens (report.css's, then the theme file's, light and dark) renamed `--pg-*`; `src/index.css` maps the shadcn tokens onto them (background = page `--bg`, popover and sidebar = `--surface`, muted and hover = `--surface-2`, foreground = `--ink`, muted text = `--muted`, border = `--line`, field border = `--line-strong`, primary = the theme's brand colour, attention text = the theme's `--accent`, fonts = `--font`, `--font-display`, `--font-mono`). When that stylesheet does not load, the app keeps its own look: Pretendard, zinc neutrals, teal #0e6e64. Also: desaturated project colours as dots, 13-14 px UI text, hairlines instead of nested cards, radius 8-10 px, ghost icon buttons with tooltips, 150 ms transitions; translucent blurred phone header and tab bar; New lesson in one column with a slim sticky action bar. **new**
66. Light and dark, one state with the pages: the same localStorage key `bn-theme` and the same fallback to the OS setting as `report.js`, `data-theme` on the app's `<html>` before the first paint (index.html). A switch in the desktop sidebar header, the phone header, the report page bar and the reader's ⋯ menu changes the app and every open page iframe at once (`data-theme`, `data-theme-src="stored"`); the page's own button (#bn-theme) changes the app too (MutationObserver on the page's `<html>`, and the storage event). `<meta name=theme-color>` follows the background, so the iOS status bar matches. Done in `src/lib/theme.ts` and `src/components/theme-toggle.tsx`. **new**
67. A page in the page reader (#/r/...) keeps a single top bar, its own: the app puts Back, a status button, a tags button and Open alone into the page's bar (same origin); both buttons open the Status and tags dialog (status, tags, projects, Edit details). The app shows its own header, with the status menu and the tags button, only when it cannot reach the page. **new**
68. Areas in two levels: the sidebar (desktop) and the header menu (phone) list the groups (first folder) with counts after the projects, a picked group (`#/reports?area=<a>`) opening its sub-areas; a row names only the area below the one picked. **new**
69. Tag chips under the status chips: the 12 most used tags of the pages in view (+N more), several can be picked (a page must carry them all), Clear tags. **new**
70. Tags on every page, in both readers (tags button with the count; dialog on desktop, sheet on phone): × removes one, the field adds one or several (Enter, comma), suggestions from the list's tags, lower case. The lesson tag of a page under a root writes or removes the lesson marker in the page file and moves the page to the other reader; a tutor lesson keeps its lesson tag. **new**
71. Old links keep working: `#/l/<slug>` opens a lesson, `#/r/<url>` of a page with the lesson tag goes on to `#/l/<slug>`, `#/reports` is the list and `#/reports?area=<a>` one area. **new**
72. Select mode for clearing a backlog: Select (beside List / Month, list view only) puts a checkbox on every row, a tap on a row toggles it; a bar under the list (above the tab bar on the phone) shows how many are selected, Select all shown / Select none, and Open, Done, Archived, which set the status of the selected pages in one `PATCH api/items {ids, status}` (all or none); a page whose data-doc-id other pages share cannot be picked. Cancel, × or Esc leaves. **new**

## Offline reading (2026-11-22)
73. A service worker (`public/sw.js`, served by the server at the app root as `/sw.js`, `Cache-Control: no-cache`) keeps the app and every page opened in it readable with no connection, and opens them from the cache first: Vite's hashed `assets/` cache first; the app shell, pages, `_template/`, `lessons/_assets/` and same-origin images, fonts, CSS and JS stale-while-revalidate (the saved copy at once, then a request with its ETag so the next open is current; a reload asks the network first); `api/pages`, `api/lessons`, `api/items`, `api/projects` and `api/theme.css` network first with the saved copy offline; the rest of the API, other methods, Range requests and media never cached. A page or shell that changed is announced to the app; a new build's files are saved before its shell, and older builds' files are then deleted. The worker's pure parts are tested in `tests/sw.test.mjs`. **new**
74. Offline badge "Offline: saved copies" at the bottom of the screen while `navigator.onLine` is false or the worker's last request failed. **new**
75. "This page was updated" (or "A new version of the app is ready") with Reload when the background check found a new version of the page in the frame or of the app; a new review state alone does not count, and a page served from the cache pulls its comments once at load (`review-sync.js`). **new**
76. The list marks the pages saved on this device (cloud with a tick); a page's bar in the page reader has Download for offline, which saves the page with the template files and images it references (`prefetchPages` in `src/lib/offline.ts`, 50 MB budget, files already saved cost nothing). **new**

# The page template

HTML template for every overview, report, dashboard and lesson an agent writes for its reader, with a review layer: the reader comments on text or on whole elements, answers question cards, and pastes the export back into the chat.
Its default look is the Basenord palette (Palette D) with Inter and Inter Display, with light and dark modes, page search, a live outline, collapsible sections and change marks since the last read; themes change the look (see Themes).

A page carries only content.
All styling lives in `report.css` (fonts embedded) and one theme stylesheet, and `report.js` builds the top bar, outline, search, question controls and comment panel when the page loads.
Report pages link these files by absolute `file://` path to this folder, so they open from disk on the machine that holds the repo with no build step and no network access; the server rewrites those links for the browsers it serves, and `bundle.py` makes a self-contained copy for anyone else.
Lesson pages link them as `../_assets/`, a symlink in the lessons folder to this folder, which the server also serves at `/lessons/_assets/`.

This README is the reference for the template itself; how an agent writes a good page (when to write one, structure, question cards, figures, the round trip) is the skill in `../skills/agent-pages/`.

`example.html` is a filled example (a project catch-up); `screenshot-light.png`, `screenshot-dark.png` and the two `-narrow` variants show it.
`screenshot-comments.png` (1440 by 1100) shows the comment panel with general notes, two comments and one answered question, and `screenshot-clear-dialog.png` shows the Clear all confirmation.

## Files

- `report.html`: the skeleton `agent-pages new` copies, about 50 lines; `lesson.html`: the skeleton `agent-pages lesson new` copies.
  Both link the assets relatively, so they render in this folder as they are, and the commands point the links at the template and the configured theme.
- `themes/`: `plain.css` (the look report.css defines, no overrides), `tum.css` (TUM corporate design), `basenord.css` (the Basenord brand, pinned).
- `report.css`: tokens, components, print styles and the embedded woff2 fonts (about 250 KB, almost all fonts).
- `report.js`: all behaviour, attached on `DOMContentLoaded` to plain semantic markup.
  The page loads it from `<head>` without `defer`, so the stored light or dark mode applies before the first paint.
- `review-sync.js`: mirrors a lesson's answers, comments and notes to the server, so they follow the reader between devices; the library app loads it.
- `fonts/serif-kr.woff2`: a Korean serif subset for graded answers, loaded only when a Korean glyph needs it.
- `bundle.py`: inlines report.css, the theme and report.js into one page for sharing, with the favicon, fonts and local images as data URIs, and optionally prints it to PDF.
- `favicon.png`, `favicon.ico`, `apple-touch-icon.png`: the tab icon, the app's logo mark (three lines of text on a Basenord tile); `report.html` links `favicon.png`, and the server serves the other two at the site root.
  `icon/icon.svg` is the one source of every icon, the library app's included; `uv run template/icon/build.py [other.svg]` renders them all (needs the `resvg` CLI).
- `example.html`: the skeleton filled with real content and two question cards.
- `docs/`: the change-tracking design page with its figure source, and `demo.html`, which shows the change marks on one file (`?v=1`, then `?v=2`).

Verify a change to `report.js` in a Firefox-engine browser (Zen, Firefox) as well as Chrome: Firefox keeps localStorage per `file://` page, so anything stored across pages behaves differently there.

## Themes

A theme is a stylesheet linked after `report.css` that overrides its tokens (colours, `--heading`, `--font`, `--font-display`, `--font-features`) and nothing else; `themes/tum.css` is the model for a new one.
`agent-pages new` and `agent-pages lesson new` link the theme the config names (`theme`, `lesson_theme`): a name from `themes/` or a path to any `.css` file; `agent-pages new --theme <name>` overrides it for one page.
To switch an existing page, change its theme `<link>` line.

## Make a page

1. Create the page where the work lives, named `YYYY-MM-DD_<slug>.html`.
   `agent-pages new <dest>/2026-10-16_catch-up-overview.html --title "Project catch-up"`
   It copies the skeleton, links the template and the theme, and sets `<title>`, the h1 and `data-doc-id` (default: the file stem).
2. Comments and answers are stored in the browser under `data-doc-id`, so they survive a rename or a move of the file; pass `--id` for a slug other than the file stem.
3. Keep the title short, eight words at most naming the subject (`How BrowserOS neo works`), the same in `<title>` and the h1; the top bar, the tab and the library list show it.
4. Replace everything inside `<main>` with the content.
   Leave the `<link>` and `<script>` lines in `<head>` as they are, and add no `<style>` or `<script>` of your own.
   Adding `defer` to the script tag brings back a flash of the system theme on load when the stored mode differs from it.
5. Run `agent-pages open <path>` and hand over the path; `agent-pages url <path>` prints its server link.
   From a server session with `[remote_open]` configured, the page opens on the Mac a few seconds later, once the file sync has delivered it.

The page needs nothing else: no header, no outline markup, no wrapper divs, no ids.
Headings get ids from their text, tables get their frame, and code blocks get a Copy button at load time.

## Content conventions

- A page that teaches a concept, a method or how a system works carries `<meta name="agent-pages-kind" content="lesson">` right after `<meta charset="utf-8">`; the library app lists it with the lessons, wherever it lives under the server's folders.
  Without the line, or with another `content`, the page is a report; `lesson.html` carries it, `report.html` does not, and the app's Move to lessons and Move to reports actions add or remove it.
- Start with `p.eyebrow` (project and kind of report), the `h1` naming the subject, `p.lede` whose first sentence states the finding, and `p.meta` holding `<span>` items such as the date and the sources.
- Use `h2` for sections and `h3` for subsections; the outline is built from them.
  Headings inside callouts, cards, figures, key-figure cards, question cards and `details` stay out of the outline, as does any heading with class `bn-notoc`.
- Write plain `<table>` markup.
  A first row of `<th>` becomes a sticky header, rows are zebra-striped, and a table too wide for the column scrolls sideways inside a frame.
  Use `td.num` for right-aligned figures and `td.nowrap` for identifiers.
- Write code blocks as `<pre data-lang="bash"><code>...</code></pre>`; `data-lang` is optional.
- Use `.grid-2` or `.grid-3` for side-by-side columns, `.card` for a plain panel, `dl.fields` for label and value pairs, `details` for collapsible material, `blockquote` with a trailing `span.src` for quoted sources, and `p.src` for a source line under a block.

## Components

- Callouts: `<div class="callout note|warning|decision|success">` with an optional `<p class="callout-title">`.
  `warning` covers deadlines and risks, `decision` covers what the reader has to decide, `note` covers context and caveats, and `success` covers what is done.
  A `decision` callout holding an `<ol>` lists several decisions, each with its recommendation.
- Graded answers: inside a callout, a folded `<details class="qa">` holds the question in `div.qa-q` and the reader's verbatim answer in `div.qa-a`, each led by a `span.qa-k` label.
  In the explanation, `<q class="said">` quotes the answer and `<q class="asked">` the question; both render in serif (`--font-serif`), the answer in the accent colour and the question in neutral.
- Badges: `<span class="badge ok|info|warn|danger|neutral|accent">label</span>`; add `plain` to drop the dot.
  Use `ok` for done, `info` for in progress or with the agent, `warn` for waiting or at risk, `danger` for blocked or overdue, `neutral` for parked or later, and `accent` for anything that needs the reader.
- Key figures: a `div.kpis` holding `div.kpi` cards, each with `span.kpi-label`, `span.kpi-value` and an optional `span.kpi-note` or `span.kpi-delta up|down`.
  `.kpi.accent` sets one value in the accent colour, for the single figure that needs attention.
- Figures: `<figure class="fig">` around an `<img>` (a `data:` URI keeps the page portable) or an inline `<svg>` with a `viewBox`, plus a `<figcaption>`.
  Figures are numbered automatically and enlarge on click; `fig bare` drops the frame.
  Inline SVG can use the page tokens, for example `fill="currentColor"` or `stroke="var(--ocean)"`, so it follows the dark mode.

### Question cards

A question card asks the reader something the agent needs decided; the reader answers it in the page, and the answer travels with the export.

```html
<div class="question" data-id="queue-choice" data-type="single">
<p class="q-text">Which queue should the import service use?</p>
<ul>
  <li data-value="postgres">Postgres queue table (recommended)</li>
  <li data-value="rq">RQ with Redis</li>
</ul>
</div>
```

`data-type` is `single` (radio buttons), `multi` (checkboxes) or `text` (a free-text box, no list).
`data-id` is the stable key the export reports, and `data-value` on an option is optional.
Choice questions also get an optional note field.

## Review round trip

1. The agent writes the page, with question cards for anything it needs decided, and hands over the path.
   A screenshot, render or figure mentioned on the page is displayed in it, with its path in the caption.
2. The reader reads it in the browser, comments, answers the cards, and writes general notes in the comment panel.
3. The reader presses Cmd+Shift+X, the clipboard button in the top bar or Export Markdown in the panel and pastes the result into the chat.
   Cmd+Shift+X works from anywhere on the page, a text box included, and behaves like the top bar button.
   When the clipboard is blocked, the top bar button downloads the file instead, and the panel offers Download .md.
4. The agent revises the same file in place, removes the question cards that are answered, and hands the path back.
5. On the next load the page sees that its content changed and clears what the last export carried, so no manual cleanup is needed (see Review rounds below).
   The bin button in the top bar or Clear all in the panel still wipes everything at any time, after a confirmation dialog.
6. The revised page marks what changed since the version the reader exported, and folds the sections already read that did not change (see Changes since the last read below).

### Review rounds

At load, `report.js` hashes the source of `<main>` before decorating it; that hash is the page revision.
A successful export (clipboard, top-bar download fallback or Download .md) records a snapshot of what it carried: each comment's id and text, each answer's choice, text and note, and the general notes.
When the page loads with a revision different from the one of that export, it removes every comment and answer still identical to the snapshot, and the exported notes when the current notes start with them.
Anything added or edited after the export stays, so feedback written while the agent works is never lost; nothing is cleared when there was no export, or when the content did not change.
A toast names what was cleared ("Page revised: cleared 2 comments and 1 answer from your last export."), shown for eight seconds.
The cleared items go to a one-level archive, and Restore cleared round, a link in the panel next to Vim keys, merges them back; the next sweep or Clear all replaces or deletes that archive.
The snapshot, the revision and the archive sit in localStorage next to the comments, under `anno:<doc-id>:round` and `anno:<doc-id>:prev`.

Ways to comment:

- Text: select any text, then press Add comment or Cmd+Shift+M.
  The quote is highlighted and numbered.
  On a touch screen, a long press selects text and Add comment appears under the selection.
- Element: press Pick in the top bar or Cmd+Shift+E, then click a paragraph, list item, table cell or row, table, heading, figure, image, code block, callout, card or key figure.
  The element under the cursor is outlined while hovering; the arrow keys widen to the enclosing element (a cell to its row, a row to its table) and back, Enter or a click opens the comment box, and Esc leaves pick mode.
  A commented element keeps a dashed outline and a numbered badge.
- General notes: the text box at the top of the panel, for anything not tied to one place; `n` opens the panel with the cursor at the end of the notes.
  It shows about nine lines, grows with its content up to half the window, and can be resized by hand.
  Notes are saved as they are typed; Cmd+Enter (or Ctrl+Enter) leaves the box.

Cmd+Enter (or Ctrl+Enter) or Ctrl+S saves a comment and closes its box.
Clicking a highlight, a badge or an entry in the panel reopens it for editing or deletion.

The panel lists, top to bottom, the general notes, the comments in document order and the answers.
Its header counts both, as in "Comments 2 · Answers 1".
The panel button in the top bar carries only symbols: the comment count, and on a page with question cards a second counter, answered of total ("0/2").
Next to it, two symbol-only buttons repeat Export Markdown (clipboard) and Clear all (bin, red on hover), so a round trip needs no trip into the panel.
With the panel closed, their result ("Copied to clipboard as Markdown.", "Nothing to export yet.") shows for three seconds in a small toast under the bar.
Below 560 px both hide, since the panel covers the screen there anyway, and below 420 px the Vim button hides too.
Cards and export headings name the section only when it is a heading other than the h1, so a comment near the page title carries no section label.
The Answers section has one card per question that carries a choice, a text or a note: the question number, its section, the question text, the chosen options and the note.
A card with a note but no choice is marked "no choice yet".
A question with nothing saved shows as a single muted line, "Question 1, open", and clicking a card or a line scrolls to the question card and flashes it.
Answers saved for question cards that a revision has since removed are counted in one line at the end.

The export follows the panel order: the page title and file path, the general notes, the comments in document order, and one answer per question card (its `data-id`, the question, the choice or text and the note).
Each comment heading names its section when it has one; the body quotes the selected text or the first 120 characters of the element, and an element comment adds a CSS selector such as `main > table:nth-of-type(1) > tbody > tr:nth-of-type(3) > td:nth-of-type(1)`.
The selector is written against the page source as the browser parses it (so a table row path includes `tbody`), with the wrappers and controls added by `report.js` left out; an element with an id is addressed by it, as in `h3#smaller-lessons`.

Comments, answers and notes persist in the browser's localStorage under the page's `data-doc-id` (the file path when it is missing), until a revised page sweeps the exported ones or Clear all deletes them.
Clear all opens an in-page dialog, "Clear all comments?", that lists what it deletes: the number of comments, the number of saved answers (every question with a choice, a text or a note, including questions no longer on the page) and the general notes, each only when present.
Cancel has the focus, and Esc or a click on the backdrop also cancels; the red Clear all button deletes.
Tab stays inside the dialog, page shortcuts are off while it is open, and it never prints.

### Shortcuts

The single keys work only while no text box has focus, so typing and Vim keys never trigger them; they ignore Cmd, Ctrl and Alt combinations.
Single keys sidestep the browser's own Cmd+Shift shortcuts on macOS, such as Cmd+Shift+N for an incognito window in Chrome.

- `n`: open the panel with the cursor in General notes.
- `c`: open or close the panel.
- `/`: focus the search.
- `?`: list every shortcut in a dialog; `?` or Esc closes it.
- `]` and `[`: jump to the next or previous change since the last read.
- `d`: show or hide the change marks.
- Cmd+Shift+M: comment on the selected text.
- Cmd+Shift+E: start or leave pick mode.
- Cmd+Shift+X: export comments, answers and notes as Markdown to the clipboard (a download when the clipboard is blocked).
- Cmd+Enter: save a comment, or leave the general notes or an answer box.
- Ctrl+S: save a comment.
- Esc: leave pick mode, the search, a comment box or the panel.

The hint line under the Vim keys checkbox in the panel repeats the main keys, and its "all keys" link opens the same list as `?`.

### Vim keys

A small Vim mode works in the comment box, the general notes and the answer boxes of question cards (free text and the optional note).
It is on by default with a mouse or trackpad and off by default on a touch screen (`pointer: coarse`).
With `vim_default = false` in the config, `agent-pages new` and `agent-pages lesson new` write `data-vim-default="off"` on the `<html>` element, which turns the default off on every device.
The Vim button in the top bar, next to the light and dark toggle, and the Vim keys checkbox in the panel switch it; both show the same setting, which the browser remembers for every page and which wins over the default.
A comment box opens in insert mode, Esc switches to normal mode, and a tag on the line below the text box shows the mode.
A box that regains focus always starts in insert mode, so letters typed into a box left in normal mode never run as commands (IME input such as Hangul bypasses the key handler and would otherwise mix with them).
Normal mode knows `h j k l`, `w b e`, `0 ^ $`, `gg G`, `i a I A o O`, `x`, `dd dw cw D C`, `u` (one level) and `p` (the last deletion).
Cmd+Enter works in either mode: it saves a comment (as does Ctrl+S), and in the general notes or an answer box it switches to normal mode and leaves the box.
In an answer box the mode tag shows only while the box has focus, and Esc in normal mode (or any Esc with Vim keys off) leaves the box, so the single keys work again.
Esc in normal mode closes the comment box only when its text is unchanged; otherwise the hint asks for Cmd+Enter, Ctrl+S or Cancel.

## Reading it

- The page follows the system light or dark setting; the sun and moon button switches mode and remembers the choice.
  `?theme=dark` or `?theme=light` in the URL forces a mode without storing it, which is how the screenshots are taken.
- `/` focuses the search; Enter and Shift+Enter step through the matches, and Esc clears them.
  Matching ignores case and accents and spans inline formatting.
  The outline shows a match count per section, and the funnel button hides table rows, question cards, `section.entry` blocks and `[data-filter-item]` elements without a match.
- The outline highlights the current section while scrolling; below 1100 px it collapses into the list button in the top bar.
- Every h2 and h3 in the outline collapses: a chevron in the left gutter, shown on hover, hides everything up to the next heading of the same or a higher level.
  Alt+click on a chevron collapses or expands every section at that level, and a collapsed section keeps its chevron visible and gets a ▸ in the outline.
  Below 720 px the chevron sits inline before the heading text, since there is no gutter.
  Nothing is wrapped, so comment selectors and the page revision ignore the folding.
  A search match, a comment opened from the panel, an answer card, an outline link or a `#hash` link opens the collapsed sections around its target.
  The state is stored per page under `bn-fold:<doc-id>` and holds only while the content is unchanged: a revised page opens with only its unchanged sections folded (see Changes since the last read).
  `bnFold.collapseAll()` and `bnFold.expandAll()` in the console set every section at once.
- Changes since the last read are marked; see the next section.
- Focus shows as a ring in the primary colour drawn with `box-shadow`, so it follows each element's corner radius: the search bar carries it as a whole, never the input inside it.
- Printing drops the top bar, outline, search, dialogs, every comment mark and control and every change mark, prints collapsed sections expanded, keeps the question cards with their answers, and prints in the light palette.

### Changes since the last read

The browser keeps the text of the version the reader last read, and a revised page compares itself against it at load.

- The unit is the block: heading, paragraph, list item, table row, code block, quote, caption, `summary`, key figure, callout or card.
  Blocks are aligned in order (exact LCS for small pages, patience anchors on unique blocks for long ones), and an unmatched new block pairs with an unmatched old one of the same tag when they share at least 40 % of their words.
- Inside a changed block, added words are highlighted in green and removed words sit inline, struck through in red.
  A changed or new block gets a bar in the left gutter, accent for changed and green for new; removed blocks show as a red minus chip where they were, and clicking it shows their text.
- The outline shows a change count per section, and when the reference was marked read (not a first-visit reference) and something changed, sections without any change collapse on load; folds the reader set on this exact version win.
- The top bar group appears only when there are changes: the diff button with the count shows or hides every mark for a clean view (`d`), the arrows step through the changes (`]` and `[`, hidden below 720 px), and the double check marks the version as read.
- A version counts as read on a successful export or on Mark read; both store the current text as the new baseline and remove the marks.
- The first visit stores the page as baseline and marks nothing.
- Struck-through words are display only: search, comment quotes, selectors and the export ignore them, and the page revision is hashed before they are added.
- The baseline sits in localStorage under `bn-read:<doc-id>`, per browser and device; `bn-read-lru` keeps the 40 most recently opened pages and evicts the oldest, since Chrome shares one storage across all `file://` pages.
  Zen and Firefox keep a separate storage per `file://` page, so there the baseline follows the file path: two files with the same doc id never compare against each other, and a copied or renamed page starts from scratch.
- `docs/demo.html?v=1` and then `?v=2` show the feature on one file; an inline script swaps in the second version before `report.js` reads the page.
- `bnChanges.state()` in the console lists the stops, and `bnChanges.markRead()` marks the page as read.

## Share a page

The `file://` links resolve only on the machine that holds the repo at that path.
For anyone else, bundle the page into one file that carries the stylesheet, theme, script, fonts and the page's local images inline:

```bash
uv run <repo>/template/bundle.py page.html -o page.standalone.html
uv run <repo>/template/bundle.py page.html --pdf    # also prints page.pdf
```

Without `-o` the output goes next to the page as `<name>.standalone.html`.
The script uses the standard library only and reads `report.css`, the theme and `report.js` from the linked path, or from its own folder when that path does not exist.
Images referenced by a relative or `file://` path become data URIs; one that cannot be found stays linked and is named in a warning.
`--pdf [FILE]` prints the bundled page with headless Chrome or Chromium (`CHROME` overrides the binary), for readers who should get a document rather than a page; the print stylesheet wraps long code lines.

## Fonts

Inter Regular and SemiBold and Inter Display SemiBold are embedded in `report.css` as Latin-subset woff2 (about 220 KB), taken from the Basenord Obsidian theme build, under the family names `Report Inter` and `Report Inter Display`.
Characters outside the subset, such as Greek or CJK, fall back to the system sans stack, and code uses the system monospace font.

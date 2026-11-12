---
name: agent-pages
description: "Write an HTML report page the reader opens in a browser, comments on, answers and exports back into the chat: for any answer beyond a short chat reply (tables, figures, a concept, an audit, a plan, several questions), with the agent-pages CLI (agent-pages new, open, url, fig build)."
---
# Pages

A page is an HTML file whose `<main>` holds only content; the shared template adds the top bar, outline, search, comments, question controls and the Markdown export when the page loads.
`REPO` below is the agent-pages checkout: the folder two levels above the real path of this file (resolve the symlink with `realpath`).
`REPO/template/README.md` is the reference for every class and for what the reader can do; read its sections Make a page, Content conventions and Components before the first page of a session.
`agent-pages --help` lists the commands, and `agent-pages config` prints the effective configuration (`~/.config/agent-pages/config.toml`, keys in `REPO/config.example.toml`).

## When to write a page

- Anything beyond a short chat answer: explanations with figures, audits, comparisons, research syntheses, plans, dashboards, and any batch of more than two questions for the reader.
- Markdown stays right for short records and for files another program reads; a document that leaves as a PDF belongs in a typeset format.
- A page that teaches a topic until the reader can explain it is a lesson: use the `tutor` skill.
- A page that teaches a concept, a method or how a system works carries `<meta name="agent-pages-kind" content="lesson">` in its `<head>`, right after `<meta charset="utf-8">`, whichever skill writes it, so the app lists it with the lessons; a report that answers a question, plans, reviews or decides does not.
- A follow-up on the same topic revises the existing page in place instead of starting a second one; the page marks what changed since the reader's last visit.

## Make it

1. `agent-pages new <dir>/YYYY-MM-DD_<slug>.html --title "..."`, next to the work it belongs to (the repo, the project folder).
   `--theme <name|path.css>` overrides the configured theme for one page; `--id` sets the storage key when the file stem is not the slug.
2. Replace everything inside `<main>`; leave `<head>` as it is, and add no `<style>`, `<script>`, wrapper divs or ids.
3. `agent-pages open <path>` opens it in the browser; the hand-over names the path.
4. `agent-pages url <path>` prints the server link of a page under a configured root; notes, mails and other devices get that link, never a `file://` path.
5. `uv run REPO/template/bundle.py <page.html>` writes a self-contained copy for someone without the repo, with fonts and local images inline; `--pdf` also prints it to PDF.

## Structure

- The title names the subject in eight words at most, the same in `<title>` and the `h1`, so it scans in a tab, a list or a link: `How BrowserOS neo works`, `Options for the LOC Day venue`, `Review of Suhyung's tutor app`.
  The finding goes in the first sentence of the lede, never in the title: wrong `Agents drive one shared browser on the home server and keep what they learn in plain files`.
- Open with `p.eyebrow` (project and kind of page), the `h1`, a `p.lede` of two or three sentences (what the page holds, what it rests on, what the reader does with it) and `p.meta` with the date and the sources.
- `h2` sections and `h3` subsections build the outline, the search counts and the folding; headings inside callouts, cards and `details` stay out of the outline.
- What needs the reader comes first: a `callout decision` or `callout warning` near the top, the one figure that matters as `.kpi.accent`.
- A first read takes ten minutes at most; detail goes into `details` blocks or a later round.
- One idea per paragraph; a comparison across more than two attributes is a `<table>` (`td.num` for numbers).
- A screenshot, render or figure the text mentions is displayed on the page, with its source path in the caption.
- Claims carry their source: a link, `p.src` under the block, or a `blockquote` ending in `span.src`.

## Question cards

- Ask through `div.question` cards (`data-type` single, multi or text; markup under Question cards in the template README), never in prose the reader has to answer somewhere else.
- Each card stands on its own: the problem in one sentence, options that state their trade-off, and the recommended option marked "(recommended)".
  The reader does not hold the project's ticket or decision numbers in memory, so name things in words.
- `data-id` is a stable slug, kept across revisions while the question stays open.

## Figures

Read `figures.md` next to this file before adding one: existing visuals first, then `agent-pages fig build` with the configured backend.

## The review round trip

1. The reader comments on text or elements, answers the cards and writes general notes, then pastes the Markdown export into the chat.
   Each comment quotes its passage or names its element by CSS selector; each answer carries its card's `data-id`.
2. Address every comment and answer; an ambiguous one gets a question back, not a guess.
3. Revise the same file in place: rewrite what the comments point at, remove the answered cards, add cards for what is still open, and hand the path back.
4. Leave the stored comments alone: on its next load the revised page clears what the export carried and marks the blocks that changed.
5. A decision settled in the export also goes wherever the project records its decisions.

## Before the hand-over

- Every image path resolves and every tag is closed; `<main>` holds content only.
- Look at the result when a browser or screenshot tool is available, in light and dark mode for a page with figures.

# Figures on a page

One figure per idea, and it agrees with the text next to it.
`agent-pages config` shows `figure_backend` (texfig, matplotlib or none) and `texfig_dir`.

## Existing visuals first

- A real result (a plot, render, screenshot, photo or video from the project) shows the idea better than a schematic: look in the project's `figures/`, `outputs/`, `results/`, `renders/` and `docs/` folders before drawing.
- Copy what you use into a folder next to the page (`figures/` or `media/`), since a server publishes only its configured folders, and caption it with what it shows and its source path.
- Images at most 1600 px wide.
- Video as H.264 mp4, at most 720 px wide and about 8 MB, a GIF over 5 MB included:
  `ffmpeg -i IN -vf scale='min(720,iw)':-2 -c:v libx264 -crf 28 -pix_fmt yuv420p -an -movflags +faststart media/x.mp4`,
  embedded as `<figure class="fig"><video src="media/x.mp4" controls playsinline muted loop preload="metadata"></video><figcaption>...</figcaption></figure>`.

## Embed

- `<figure class="fig"><img src="figures/<name>.png" alt="..."><figcaption>...</figcaption></figure>`; figures are numbered and enlarge on click, and `fig bare` drops the frame.
- A relative path suits a page that stays in its folder; a `data:` URI keeps a page that travels as one file.
- Inline `<svg>` with a `viewBox` works too, and the page tokens (`fill="currentColor"`, `fill="var(--surface)"`, `stroke="var(--ocean)"`) make it follow the theme and dark mode.

## Draw with `agent-pages fig build <file>`

The backend follows the file type, and the PNG lands next to the source (`-o <dir>` elsewhere).

- `.tex` (texfig backend): the file holds only a `tikzpicture` built from the tex-fig styles.
  Read the README of the tex-fig checkout in `texfig_dir` first; it owns the styles, colours and pitfalls.
  Start from the nearest figure in its `examples/` rather than an empty canvas, author on a centimetre canvas and wrap the picture in `\resizebox{\tffigwidth}{!}{...}`.
  Colours are style arguments (`tfarrowc=tfGreen`), never hard-coded; align with `\tfrow` and `\tfcol` instead of guessed coordinates; panels and group boxes come last, fitted around their content.
  `--palette`, `--font` and `--dpi` change the look; `--steps <n>` writes one PNG per reveal step.
- `.py` (matplotlib backend): a script that writes its images into the folder `$AGENT_PAGES_FIG_OUT` names; it runs with uv and matplotlib, in its own folder.
  Colours come from the page's theme or the project's brand palette, never the library defaults; one solid segment per category, no hatching; legend outside the plot area; no title inside the image that repeats the caption.
- `none`: no rendered figures; use existing visuals and inline SVG.

## The loop

1. Render, then read the PNG as an image and compare it against what the text says.
2. Fix and render again; the remaining mismatch is almost always alignment.
3. After two failed fixes, draw the figure as inline SVG instead.
4. In a repo, commit the PNG next to its source, since a reader without the backend cannot render it.

To rebuild a figure from a screenshot, name the roles first (card, chip, panel, arrow, caption), then rebuild it from the styles, keeping its structure and labels but not its colours.

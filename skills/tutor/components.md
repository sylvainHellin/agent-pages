# Lesson components

A lesson page uses every component of the page template (`template/README.md` in the agent-pages repo, and the `agent-pages` skill); these are the parts specific to lessons.

## Recall cards

```html
<h2>Recall</h2>
<div class="question" data-id="recall-1" data-type="text">
<p class="q-text">Why does doubling the batch size not double the latency?</p>
</div>
```

Three cards on the first page, each asking to explain, predict or apply; a revision replaces the answered ones with two new cards on the weakest point, under new `data-id`s.

## Links between lessons

`<a href="../YYYY-MM-DD_<slug>/">` links a related lesson; inside the library app, `report.js` turns such a link into a lesson switch, so the app's bar and review state follow.
Links to other sites open in a new tab.

## Graded answers (revision rounds)

The reader sees the grade weeks later without the chat, so each grade carries the question and the reader's answer, folded:

```html
<div class="callout success">            <!-- success = right, note = partly right, warning = wrong -->
<p class="callout-title">Question 4: partly right</p>
<details class="qa"><summary>Question and your answer</summary>
  <div class="qa-q"><span class="qa-k">Question</span><p>The question, verbatim from the export (the `>` quote).</p></div>
  <div class="qa-a"><span class="qa-k">Your answer</span><p>The reader's answer, verbatim, typos included.</p></div>
</details>
<p>The explanation. Quote the reader's own words as <q class="said">because the output doubles</q> and the question's words as
<q class="asked">the moment shrinks, so it gets faster</q>; both render in serif (`--font-serif`, with a Korean subset in
`fonts/serif-kr.woff2`), the reader's in the accent colour, the question's in neutral, so it is clear which words are theirs.</p>
</div>
```

- Copy question and answer verbatim; do not correct the answer's spelling.
- Write the labels in the lesson's language: `Question` / `Your answer` in English, `질문` / `내 답` in Korean, and the title as `Question 4: partly right` or `4번: 부분 정답`.
- Quote, do not paraphrase, when the explanation refers to the answer: name the exact phrase that was right or wrong.
- Keep the callout short: the grade in the title, then what was right and what was missing, one sentence each.
- Place the graded callouts above the new recall cards.

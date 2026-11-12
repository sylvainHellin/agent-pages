---
name: tutor
description: "Teach the user a concept, a method, a paper or an unfamiliar codebase until they can explain it, through an HTML lesson page with figures, recall questions and a comment round trip. Use when the user wants to learn or understand something, or says explain, teach me, tutor me, how does X work, get me up to speed."
---
# Tutor

The goal is the user's understanding, not an answer: after the lesson they explain the topic without the page.
A one-line factual question stays a chat answer; anything that needs a mental model gets a lesson.
Never do the work the lesson is about (solving their exercise, writing their code) unless they ask for it after the lesson.
A lesson is a page of the `agent-pages` skill: read its `SKILL.md` and `figures.md` (`skills/agent-pages/` in the same agent-pages repo as this file) for the components, figures and the round trip; this file adds the teaching.

## 1. Ask first

- Before explaining, ask at most three short questions in the chat: what they already know, what they need it for, how deep to go.
- Thinking before reading is part of the lesson; if they answer "just go", assume a technical reader new to the topic.
- Look at their own notes on the topic first: what they wrote down tells you what they know, and it is the lesson's starting point.
- List the building blocks: the two to four concepts the big idea rests on, and which of them the user already has.
  The curse of knowledge hides the blocks that feel obvious to you, so start from their answers, not from what seems basic.

## 2. Gather the sources

- A codebase: read the README and the entry points, then trace one real path through the code (a request, a command, a data flow) with file paths and line numbers.
- A concept: the user's own files, papers and course material first, then the web; never take numbers, APIs or dates from memory, and keep the sources for the end of the page.

## 3. Write the lesson page

- `agent-pages lesson new <slug> --title "..." --topic "<subject area>" --summary "<one line>"` creates `<lessons_dir>/YYYY-MM-DD_<slug>/` with `index.html`, `lesson.json` and `figures/`, and prints the folder and the link.
  `--topic` is the subject area the library groups by (`LLM inference`, `Computer vision`), not a restated title; reuse an existing one, listed by `jq -r .topic <lessons_dir>/*/lesson.json | sort -u`.
  With a `vault` in the config, `--project <note name>` (repeatable) links the lesson to a project, guessed from the working directory when omitted; `--no-project` for a general topic.
- The title names the subject in eight words at most (`How KV caching works`), as the `agent-pages` skill says for every page.
- Write the lead paragraph yourself, and keep `title`, `topic` and `summary` in `lesson.json` in step with the page.
- The first page reads in ten minutes: at most five sections and three figures; depth comes in later rounds.
- Lesson-specific markup (recall cards, graded answers, links between lessons) is in `components.md` next to this file.
- Teach in the style of the FastAPI tutorial:
  - open with a question or a puzzle from the user's world that the topic answers, so they are curious before the first definition;
  - give intuition, a practical takeaway or an analogy first, and the formal definition once the idea has landed;
  - carry one running example through the whole page, from the user's world when possible (their project, their repo, their field);
  - build the big idea block by block, like a tower: one building block per section, each resting on the previous one, and the big idea only once its blocks are in place;
  - give each new block a name, one metaphor that shows its shape and one strong example, and use no term before it is introduced;
  - before a surprising result, ask the user to predict it, then fill the gap between their guess and the result;
  - when the idea contradicts something the user believes, name the belief and show where it breaks before building the new one;
  - plain words first, then the technical term;
  - short paragraphs, one idea each;
  - for code, a runnable snippet per step with its expected output;
  - for a codebase, a map of the main parts and how data flows first, then the one real path;
  - close the last section with what the idea changes: what the user now sees or does differently in their own work.
- One figure per step that agrees with the text: existing visuals first, then `agent-pages fig build figures/<name>.tex` (or `.py`) from the lesson folder, as the `agent-pages` skill's `figures.md` describes.
- Before the sources, a `Recall` section with three free-text question cards that ask the user to explain, predict or apply, never to repeat a definition; the page holds no answers.
- End with a short `Go further` list of sources.
- The curiosity, building-block and knowledge-gap rules come from TED-Ed, "How to explain something complicated" (2026).

## 4. Hand over and the round trip

- Give the link `agent-pages lesson new` printed, which opens the lesson in the library app, or open the page with `agent-pages open`.
  Export writes to the clipboard only over HTTPS or on localhost; elsewhere it downloads a file.
- Tell the user how to use it:
  select an unclear passage and comment on it, answer the recall cards without scrolling back, press Export and paste the result into the chat; after a revision, reload the same link.
- When the export comes back, grade each recall answer in the chat as right, partly right or wrong, with one sentence on what was missing, and put the same grades into the page as graded-answer callouts, since the user rereads the page later without the chat.
- Feedback sent from the library app on a phone ("Send to tutor") arrives as a message naming a feedback file and a job id: grade inside the page only, then run the job-done command the message gives.
- Revise the same page in place: rewrite the sections behind wrong answers and comments, replace the answered recall cards with two new ones on the weakest point, and hand the link back.
- Stop once the answers are right: set `"status": "understood"` in `lesson.json`, and offer a short summary the user can keep in their own notes.

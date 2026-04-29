---
name: "Obsidian Vault Workflow"
description: "Enforce the mandatory Obsidian vault read/write protocol for this project. Use at the START of every task (to locate the topic file, read its Overview + Session Log, plus recent Meeting Notes / Content Briefs / Brand Guidelines) and at the END of every task (to append a dated compact summary to the topic file and update the Overview if scope changed). Invoke for any coding, content, architecture, design, feature, bugfix, or review task in the AI Content OS repo."
---

# Obsidian Vault Workflow

The project vault at `vault/` is Claude Code's long-term memory for AI Content OS. It is organized **one file per topic** — the file contains a persistent Overview (what the topic is) plus a Session Log of dated compact summaries. Reading the relevant topic file before work and appending a session entry after work is **mandatory**.

## When to Invoke

**Every task.** Coding, content, architecture, UI, bugfixes, reviews, refactors. Skip only for pure read-only questions that touch zero files and produce zero decisions.

---

## Phase 1 — BEFORE Starting Any Task

### 1. Identify the topic

State the task's topic in one short phrase (e.g. "email cron hardening", "publishing oauth flows", "claude-md refresh"). This phrase drives the filename lookup.

### 2. Locate the topic file

1. Pick the target folder (see Folder Conventions below).
2. List the folder and scan for an **exact** filename match: `<topic-hyphenated>.md`.
3. If no exact match, look for a **close semantic match** (e.g. task "email SES retry" vs existing `email-cron-hardening.md`).
   - If a close match exists → **ask the user** whether to append to the existing topic or create a new one.
   - If nothing close → a new topic file will be created at end of session (do not create an empty stub now).
4. If a matching topic file exists → **Read it fully** (Overview + every prior Session Log entry) before touching code. This is the single most important step for context loading.

### 3. Read recency context (parallel)

Regardless of topic file presence, also read:

- `vault/Meeting Notes/` — list the directory, read the **2–3 most recent** entries (sort by last session date inside the file, or by filename).
- `vault/Content Briefs/` — scan for briefs whose titles match the task domain; read any plausibly related.
- `vault/Brand Guidelines/` — read if the task touches content, channels, UI, copy, or design.

### 4. Report what you pulled

Before writing code, state in one sentence what context you loaded: existing topic file (yes/no), any close-match decision, and the recency reads. Gives the user a chance to redirect.

---

## Phase 2 — AFTER Completing Any Task

You are not done until the topic file is updated AND verified.

### 1. Pick the folder

| Task type | Folder |
|---|---|
| Feature / code / bugfix / refactor | `vault/Meeting Notes/` |
| Architecture / design decision | `vault/Meeting Notes/` |
| Content creation / editorial work | `vault/Content Briefs/` or `vault/Publishing Log/` |
| Publishing execution / post-mortem | `vault/Publishing Log/` |
| Brand / visual / tone decision | `vault/Brand Guidelines/` |

Write creates parent directories automatically.

### 2. Determine the topic filename

Free-form topic, lowercase-hyphenated, **no date**. Examples:

- `email-cron-hardening.md`
- `claude-md-refresh.md`
- `publishing-oauth-flows.md`

If the file already exists → open it. If not → create it with the full template below.

### 3. Topic file format (exact)

```markdown
# <Topic Title>

## Overview
<2–6 sentences describing what this topic covers: scope, key components, current status. This is the "what is this" explanation a future session reads first.>

## Open Questions
- <unresolved decision, untested assumption, or known follow-up>
- <another>
- (or `- none` if nothing is open)

## Session Log

### YYYY-MM-DD — <short session title> [status]
- **What was done:** …
- **Decisions:** … (why, not just what)
- **Notes / Caveats:** …
- **Related:** [[wikilink]], [[wikilink]]

### YYYY-MM-DD — <next session title> [status]
…
```

Newer session entries are **appended at the bottom** so the file reads top→bottom as chronological history.

### Status tags

Every `###` session heading ends with a bracketed status tag so the history is scannable:

- `[shipped]` — merged/deployed/live
- `[spiked]` — experimental or proof-of-concept, not merged to main
- `[wip]` — work-in-progress across sessions, not yet done
- `[reverted]` — rolled back
- `[planned]` — plan/spec only, no code yet
- `[debug]` — investigation/diagnosis session (no ship)

Pick the one that best describes the end-of-session state. If the status changes later, do NOT rewrite the old heading — add a new dated entry with the new status.

### Open Questions section

The `## Open Questions` block sits between Overview and Session Log. It is the most valuable part of the file for the next session — it says "here's what is NOT settled yet". Rules:

- Add an entry whenever this session ended with an unresolved decision, untested assumption, deferred follow-up, or known limitation that a future session should revisit.
- **Remove** entries when they get resolved (don't just leave them crossed out — cleanness matters).
- If nothing is open, write `- none`.
- Keep entries short (one line each). Link to relevant sessions with `[[wikilink#YYYY-MM-DD]]` if context is needed.

### 4. Overview update rule

The Overview **must be updated** whenever this session:

- Expanded or narrowed the topic's scope
- Added a major component, module, or flow
- Corrected prior understanding (something earlier in the file is now wrong)
- Changed status (e.g. "planned" → "shipped", "experimental" → "production")

If none of the above apply, leave the Overview untouched. Never blindly overwrite — when updating, integrate with the existing text rather than replacing it wholesale.

### 5. Append the dated Session Log entry

Add a new `### YYYY-MM-DD — <short title>` section at the bottom of `## Session Log`. Date comes from the session's `currentDate` context. Keep each bullet concise — think `/compact` summary, not a diff.

### 6. Wikilinks — non-negotiable

The `- **Related:**` line MUST contain `[[wikilinks]]` to the most relevant vault notes:

- Any topic file you read in Phase 1 → link it
- Prior notes on the same module, channel, or feature area → link them
- Briefs or guidelines referenced while working → link them

Syntax: `[[email-cron-hardening]]` — filename without `.md`. No markdown links for intra-vault references. If truly nothing related, write `none (first entry on this topic)`.

### 7. Verify the write

After Write/Edit, Read the file back. Confirm:

- `# <Topic Title>` and `## Overview` present at top
- New `### YYYY-MM-DD` section appended at the bottom of `## Session Log` (not inserted above older entries)
- Wikilinks well-formed
- If Overview was updated → the update reads coherently with the rest

Only after verification may you claim the task is complete.

---

## Folder Conventions

Create any of these on first use:

- `vault/Meeting Notes/` — code, architecture, decisions, session logs
- `vault/Content Briefs/` — editorial briefs, campaign specs
- `vault/Publishing Log/` — publish runs, outcomes, post-mortems
- `vault/Brand Guidelines/` — voice, visuals, tone, UI primitives

Inside each folder, one `.md` per topic, plus an `_index.md` listing every topic in the folder with a one-line description.

## Folder Index (`_index.md`)

Each folder contains `_index.md` — a flat list of every topic file in that folder. Format:

```markdown
# <Folder Name> — Index

One-line description of what this folder is for.

## Topics

- [[<topic-filename>]] — one-line description of the topic
- [[<another-topic>]] — one-line description
```

When you create a new topic file, immediately add a line to the matching folder's `_index.md`. When you delete or rename a topic, update the index. The index is how future sessions discover a topic when they don't remember its exact filename.

---

## Anti-Patterns (Do Not Do These)

- ❌ Creating `YYYY-MM-DD <topic>.md` style dated filenames — that's the old protocol, superseded
- ❌ Omitting the `[status]` tag on a session heading — every `###` line ends with a bracketed tag
- ❌ Leaving resolved items in `## Open Questions` — remove them once settled (don't just cross out)
- ❌ Creating a topic file without adding its line to the folder's `_index.md`
- ❌ Creating a new topic file when a close-match file already exists, without first asking the user
- ❌ Inserting a new dated Session Log entry **above** older entries — always append at the bottom
- ❌ Overwriting the Overview wholesale when only a small integration is needed
- ❌ Leaving the Overview stale when this session materially changed scope or status
- ❌ Skipping the Phase 1 topic-file read because "the task seems simple"
- ❌ Skipping `- **Related:**` or leaving it empty without `none (first entry on this topic)`
- ❌ Using markdown links `[text](file.md)` inside the vault instead of `[[wikilinks]]`
- ❌ Dumping a diff or full commit message into the entry — summarize *why* and *what mattered*, git owns line-by-line
- ❌ Creating the note in the repo root, `src/`, or anywhere outside `vault/`
- ❌ Declaring the task done without the Read-back verification step

---

## Minimal Checklist

At task start:
- [ ] Named the topic in one phrase
- [ ] Opened the folder's `_index.md` to find the topic (fastest filename discovery)
- [ ] Looked for exact filename match; handled close-match case (asked user if ambiguous)
- [ ] If topic file exists → Read it fully (Overview + Open Questions + every Session Log entry)
- [ ] Read 2–3 most recent Meeting Notes
- [ ] Scanned Content Briefs, read Brand Guidelines if task touches content/UI
- [ ] Stated what context was loaded (one sentence)

At task end:
- [ ] Picked correct folder
- [ ] Filename is `<topic>.md` (no date)
- [ ] If new file → wrote Overview + Open Questions + first Session Log entry; added line to folder's `_index.md`
- [ ] If existing file → updated Overview only if scope/status/understanding changed
- [ ] Updated `## Open Questions` — added new items; removed resolved ones
- [ ] Appended `### YYYY-MM-DD — <title> [status]` at the **bottom** of Session Log
- [ ] Entry has What was done / Decisions / Notes / Related (with `[[wikilinks]]` or explicit `none`)
- [ ] Read the file back to verify
- [ ] Only then claimed completion

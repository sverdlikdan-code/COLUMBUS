---
source: https://github.com/pbakaus/impeccable
retrieved: 2026-05-26
language: en
original_title: "impeccable — The design language that makes your AI harness better at design"
---

# Impeccable — Design Skill for AI Harnesses

> Source: [GitHub — pbakaus/impeccable](https://github.com/pbakaus/impeccable) + [impeccable.style](https://impeccable.style/) — 2026

## Summary

Impeccable is a free, open-source design skill (Apache 2.0) by Paul Bakaus that gives AI coding assistants — Claude Code, Cursor, Gemini CLI, Codex CLI, and others — a shared design vocabulary and discipline. It ships as one skill file with 23 sub-commands and 7 deep-dive reference files covering typography, color, motion, spatial rhythm, interaction, responsive, and UX writing. The core problem it solves: every AI assistant defaults to the same "Inter font, purple gradient, nested cards" aesthetic. Impeccable encodes real design craft into the harness so the AI steers toward polished, intentional UI.

## GitHub Repository

**https://github.com/pbakaus/impeccable**

Website / docs: https://impeccable.style

## Installation — Claude Code

### Option A: npx (recommended, auto-detects harness)
```bash
npx skills add pbakaus/impeccable
```
Auto-detects the AI harness and writes skill files to `.claude/skills/` (or equivalent). After install: reload your harness, commands are accessible via `/impeccable`.

### Option B: Manual copy — project-level
```bash
cp -r dist/claude-code/.claude your-project/
```

### Option C: Manual copy — global (all projects)
```bash
cp -r dist/claude-code/.claude/* ~/.claude/
```

## How It Works in Claude Code

- Uses **slash commands** — not a standalone SKILL.md executed by Claude Code directly
- Commands follow the pattern: `/impeccable <command> [target]`
- Example: `/impeccable polish the pricing page`, `/impeccable audit the checkout`
- You can pin frequently-used commands as shortcuts: `/impeccable pin audit` → creates `/audit`
- The core skill documentation lives at `skill/SKILL.md` inside the repo — this is what Claude reads to understand the 7 design domains

## The 23 Commands

| Command | What it does |
|---------|-------------|
| `/impeccable craft` | Full shape-then-build flow with visual iteration |
| `/impeccable teach` | Discovery interview — establishes design context, creates root DESIGN.md + PRODUCT.md |
| `/impeccable document` | Generate DESIGN.md from existing project code |
| `/impeccable extract` | Pull reusable components and tokens into the design system |
| `/impeccable shape` | Plan UX/UI before writing code |
| `/impeccable critique` | UX design review: hierarchy, clarity, emotional resonance |
| `/impeccable audit` | Technical quality checks: a11y, performance, responsive |
| `/impeccable polish` | Final pass — design system alignment and shipping readiness |
| `/impeccable bolder` | Amplify boring, flat designs |
| `/impeccable quieter` | Tone down overly bold designs |
| `/impeccable distill` | Strip to essence — remove noise |
| `/impeccable harden` | Error handling, i18n, text overflow, edge cases |
| `/impeccable onboard` | First-run flows, empty states, activation paths |
| `/impeccable animate` | Add purposeful motion |
| `/impeccable colorize` | Introduce strategic color |
| `/impeccable typeset` | Fix font choices, hierarchy, sizing |
| `/impeccable layout` | Fix layout, spacing, visual rhythm |
| `/impeccable delight` | Add moments of joy and micro-interactions |
| `/impeccable overdrive` | Add technically extraordinary effects |
| `/impeccable clarify` | Improve unclear UX copy |
| `/impeccable adapt` | Adapt for different devices / responsive |
| `/impeccable optimize` | Performance improvements |
| `/impeccable live` | Visual variant mode — iterate on elements in the browser |

## Two Modes

Impeccable runs in two modes:
- **Brand mode** — typography, color, token commands (`typeset`, `colorize`, `bolder`, `quieter`)
- **Product mode** — UX flows, onboarding, edge cases (`onboard`, `harden`, `shape`)

## File Structure (Inside Repo)

```
.claude/          ← Claude Code skill files
.cursor/          ← Cursor skill files
.gemini/          ← Gemini CLI skill files
.github/          ← GitHub Copilot files
skill/SKILL.md    ← Core skill doc with 7 domain reference files
dist/             ← Ready-to-copy bundles per harness
```

The 7 reference domains in SKILL.md: typography, color, spatial design, motion, interaction, responsive techniques, UX writing.

## Key Quotes

> "One agent skill that teaches your AI to design, with 23 commands bundled inside." — impeccable.style

> "Ask Claude Code, Cursor, or Gemini CLI to build a UI and the result tends to look the same: Inter font, a purple gradient, nested cards, and gray text on colored backgrounds. Impeccable solves this." — impeccable.style

> "The 23 commands get most of the press, but the load-bearing structure of the skill is the seven reference files, each a deep dive into a single design domain." — impeccable.style docs

## Key Takeaways

- GitHub repo: `https://github.com/pbakaus/impeccable`
- Install via: `npx skills add pbakaus/impeccable` (easiest) or `cp -r dist/claude-code/.claude your-project/`
- Works as **Claude Code slash commands** under the `/impeccable` namespace
- Not a standalone SKILL.md in the COLUMBUS sense — it installs into `.claude/` and uses Claude Code's native slash command system
- 23 commands covering the full design lifecycle from discovery (`teach`) to shipping (`polish`, `harden`)
- 7 domain reference files are the actual engine — commands call into them
- Free, open source, Apache 2.0
- Author: Paul Bakaus

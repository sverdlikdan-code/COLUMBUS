# Skill — Obsidian Bases

## Overview
הקובץ `SKILLS/obsidian/obsidian-bases/SKILL.md` מגדיר skill ליצירה ועריכה של קבצי Obsidian Bases (סיומת `.base`). קבצי Base הם YAML המגדירים views (table, cards, list, map), filters לסינון notes, formulas לחישובים, ו-summaries. ה-skill כולל schema מלא, syntax לפילטרים, reference לפונקציות תאריכים, וסוגי views עם דוגמאות. משמש כאשר המשתמש עובד עם database-like views בתוך Obsidian.

## Open Questions
- none

## Session Log

### 2026-04-27 — תיעוד skill obsidian-bases [planned]
- **What was done:** תיעוד מטרת הקובץ, schema, filter syntax, formula syntax, ו-view types.
- **Decisions:** הקובץ מכסה את כל הצרכים של Obsidian Bases — filters (and/or/not), formulas עם date functions, ו-4 סוגי views.
- **Notes / Caveats:** Duration type דורש גישה לשדה `.days` לפני `.round()` — זה edge case חשוב המתועד ב-SKILL.md.
- **Related:** [[skill-obsidian-markdown]], [[skill-obsidian-vault-workflow]], [[skills-folder-architecture]]

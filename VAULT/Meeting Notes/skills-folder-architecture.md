# Skills Folder Architecture

## Overview
התיקייה `SKILLS/` היא מאגר ה-Skills של הפרויקט — כל skill הוא יכולת מוגדרת שClaude Code יכול להפעיל. כרגע מכילה תת-תיקייה `obsidian/` עם שלושה skills לעבודה עם Obsidian. כל skill מאוחסן בתיקייה נפרדת עם קובץ `SKILL.md` המכיל frontmatter + תיעוד מלא. התיקייה `AGENTS/` מקבילה ל-SKILLS אך לאגנטים עצמאיים (כרגע ריקה).

## Open Questions
- מה ה-convention לתת-קטגוריות נוספות מעבר ל-`obsidian/`?
- האם AGENTS/ יכיל קבצי AGENT.md במבנה זהה ל-SKILL.md?

## Session Log

### 2026-04-27 — תיעוד מבנה תיקיית SKILLS [planned]
- **What was done:** מיפוי מבנה `SKILLS/obsidian/` עם שלושה skills — obsidian-bases, obsidian-markdown, obsidian-vault-workflow.
- **Decisions:** כל skill מתועד בקובץ SKILL.md עם frontmatter (`name`, `description`) ותיעוד workflow מלא.
- **Notes / Caveats:** `AGENTS/` ריקה כרגע — עתידה להכיל אגנטים במבנה דומה.
- **Related:** [[skill-obsidian-bases]], [[skill-obsidian-markdown]], [[skill-obsidian-vault-workflow]], [[agents-folder]]

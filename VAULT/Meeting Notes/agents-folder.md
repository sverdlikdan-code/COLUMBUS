# Agents Folder

## Overview
התיקייה `.claude/AGENTS/` מכילה אגנטים עצמאיים — מקבילה ל-`.claude/SKILLS/`. כל אגנט שמור בתיקייה נפרדת עם קובץ `AGENT.md`. Convention הוגדר: frontmatter (`name`, `description`, `role`) + סקשנים Role, Always Active, Sub-Agent Registry, Routing Logic, Workflow, Anti-Patterns. הסוכן הראשון שהוגדר הוא CEO Agent (המנכ"ל) — הסוכן הראשי שמנתב לכל שאר הסוכנים. ה-PRD המלא נמצא ב-`PRD/ceo-agent-prd.md`.

## Open Questions
- none

## Session Log

### 2026-04-27 — תיעוד תיקיית AGENTS [planned]
- **What was done:** תיעוד קיום התיקייה ומטרתה העתידית.
- **Decisions:** התיקייה נוצרה עם `.gitkeep` כדי שתופיע ב-Git למרות שהיא ריקה.
- **Notes / Caveats:** ריקה לחלוטין — אין תוכן לתעד מעבר למטרה המוצהרת.
- **Related:** [[skills-folder-architecture]]

### 2026-04-27 — יצירת CEO Agent — PRD + AGENT.md [shipped]
- **What was done:** הוגדר convention לפורמט AGENT.md (frontmatter + 6 סקשנים). נוצרו `PRD/ceo-agent-prd.md` ו-`.claude/AGENTS/ceo-agent/AGENT.md`.
- **Decisions:** AGENT.md עוקב אחרי מבנה SKILL.md עם תוספת שדה `role` (orchestrator/specialist). המנכ"ל מוגדר כ-orchestrator שמנתב ל-Content Agent, Research Agent, ו-2 סוכנים TBD.
- **Notes / Caveats:** CLAUDE.md עדיין לא עודכן לטעון את ceo-agent AGENT.md — זה על המפתח.
- **Related:** [[claude-md]], [[skills-folder-architecture]]

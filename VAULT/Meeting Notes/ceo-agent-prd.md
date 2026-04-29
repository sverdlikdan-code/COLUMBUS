# CEO Agent PRD

## Overview
מסמך ה-PRD לסוכן המנכ"ל נמצא ב-`PRD/ceo-agent-prd.md`. הסוכן הוא הנקודה המרכזית של מערכת THE 5 AGENTS — מקבל כל פקודת משתמש, מנתח intent, ומנתב ל-4 סוכנים מתמחים. מוגדר דרך CLAUDE.md ו-AGENT.md בלבד (אין קוד). ה-AGENT.md נמצא ב-`.claude/AGENTS/ceo-agent/AGENT.md`.

## Open Questions
- Content Agent ו-Research Agent עדיין לא הוגדרו — נדרש AGENT.md לכל אחד
- CLAUDE.md עדיין לא עודכן לטעון ceo-agent AGENT.md — על המפתח לעדכן

## Session Log

### 2026-04-27 — יצירת PRD + AGENT.md לסוכן המנכ"ל [shipped]
- **What was done:** נכתב PRD מלא עם ארכיטקטורה, routing logic, פרוטוקול אינטראקציה, ו-convention ל-AGENT.md. נוצר AGENT.md הראשון בפרויקט.
- **Decisions:** הסוכן מנתב לפי keywords: כתיבה → Content Agent, מחקר → Research Agent. כשלא ברור — שואל לפני ניתוב. המנכ"ל לא מבצע משימות בעצמו.
- **Notes / Caveats:** 2 סוכנים מוגדרים (Content, Research), 2 נוספים TBD. Convention AGENT.md: frontmatter (name, description, role) + 6 סקשנים קבועים.
- **Related:** [[agents-folder]], [[claude-md]], [[skills-folder-architecture]]

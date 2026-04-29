# CEO Agent PRD

## Overview
מסמך ה-PRD לסוכן המנכ"ל נמצא ב-`PRD/ceo-agent-prd.md`. הסוכן הוא הנקודה המרכזית של מערכת THE 5 AGENTS — מקבל כל פקודת משתמש, מנתח intent, ומנתב ל-4 סוכנים מתמחים. מוגדר דרך CLAUDE.md ו-AGENT.md בלבד (אין קוד). ה-AGENT.md נמצא ב-`.claude/AGENTS/ceo-agent/AGENT.md`. נכון לעכשיו הופעל מצב זמני `CEO + Geograf`: ניתוב מותר רק ל-Geograf, ושאר סוכני המשנה נשארים כבויים עד הוראה מפורשת.

## Open Questions
- Content Agent ו-Research Agent עדיין לא הוגדרו — נדרש AGENT.md לכל אחד

## Session Log

### 2026-04-27 — יצירת PRD + AGENT.md לסוכן המנכ"ל [shipped]
- **What was done:** נכתב PRD מלא עם ארכיטקטורה, routing logic, פרוטוקול אינטראקציה, ו-convention ל-AGENT.md. נוצר AGENT.md הראשון בפרויקט.
- **Decisions:** הסוכן מנתב לפי keywords: כתיבה → Content Agent, מחקר → Research Agent. כשלא ברור — שואל לפני ניתוב. המנכ"ל לא מבצע משימות בעצמו.
- **Notes / Caveats:** 2 סוכנים מוגדרים (Content, Research), 2 נוספים TBD. Convention AGENT.md: frontmatter (name, description, role) + 6 סקשנים קבועים.
- **Related:** [[agents-folder]], [[claude-md]], [[skills-folder-architecture]]

### 2026-04-29 — CEO-only режим маршрутизации [wip]
- **What was done:** Обновлены `.claude/AGENTS/ceo-agent/AGENT.md` и `CLAUDE.md`, чтобы временно отключить использование всех агентов/сабагентов, кроме CEO.
- **Decisions:** Введено явное правило `CEO-only`: делегирование и запуск суб-агентов запрещены до отдельной команды на включение.
- **Notes / Caveats:** При задачах, которые раньше маршрутизировались к специализированным агентам, теперь требуется работа без делегирования или явное ожидание снятия ограничения.
- **Related:** [[agents-folder]], [[claude-md]]

### 2026-04-29 — Включение Geograf в ограниченном режиме [wip]
- **What was done:** Обновлены `CLAUDE.md` и `.claude/AGENTS/ceo-agent/AGENT.md`: Geograf переведен в активный статус, остальная сеть агентов остается отключенной.
- **Decisions:** Новый временный режим `CEO + Geograf`: разрешена маршрутизация только геомаршрутизационных задач к Geograf.
- **Notes / Caveats:** Любые задачи, требующие Reuven/Yael/Chen/Yuval/Guy, пока не маршрутизируются.
- **Related:** [[agent-geograf]], [[claude-md]], [[agents-folder]]

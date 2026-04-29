# CLAUDE.md

## Overview
הקובץ `CLAUDE.md` בשורש הפרויקט הוא קובץ ה-guidance הראשי ל-Claude Code — מוטען אוטומטית בכל שיחה בסביבת העבודה הזו. הקובץ כבר אינו placeholder: הוא מגדיר את חובת טעינת CEO Agent בכל פנייה, את פרוטוקול העבודה עם Vault, את מצב הזמינות הזמני של הסוכנים (`CEO + Geograf + Designer`), ואת דרישת skill חובה למשימות גיאו-ניתוב בישראל.

## Open Questions
- האם להוסיף section נפרד ל-Designer skill חובה עבור משימות UI/UX

## Session Log

### 2026-04-27 — יצירת CLAUDE.md הראשוני [planned]
- **What was done:** נוצר CLAUDE.md בסיסי עם placeholder — הפרויקט היה ריק בשלב זה.
- **Decisions:** הקובץ יעודכן ידנית ככל שהפרויקט יתפתח.
- **Notes / Caveats:** CLAUDE.md מוטען אוטומטית על ידי Claude Code בכל שיחה — שינויים בו משפיעים על כל עבודה עתידית.
- **Related:** [[claude-settings]], [[skills-folder-architecture]]

### 2026-04-29 — CLAUDE.md синхронизирован с активными агентами [wip]
- **What was done:** В `CLAUDE.md` зафиксирован текущий режим `CEO + Geograf + Designer` и обязательный skill для геомаршрутизации.
- **Decisions:** Ограничение на остальных агентов оставлено явным, чтобы исключить случайную маршрутизацию.
- **Notes / Caveats:** При изменении активного набора агентов этот файл нужно обновлять синхронно с `ceo-agent/AGENT.md`.
- **Related:** [[ceo-agent-prd]], [[agent-geograf]], [[agent-designer]]

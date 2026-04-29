# Agent — חן

## Overview
הקובץ `.claude/AGENTS/chen/AGENT.md` מגדיר סוכנת חיפוש רשת בשם חן (role: specialist). חן משתמשת ב-WebSearch המובנה של Claude Code — מוצאת מאמרים ותוכן איכותי ברשת לפי בקשה מראובן, שומרת גלם ב-`Content/` (של יעל), ומתעדת כל חיפוש ב-`Memory/searches.md` למניעת כפילויות. **חן לא קוראת ישירות ליעל** — רק מדווחת לראובן שמפעיל את יעל.

## Capabilities
- **יודעת:** לחפש ברשת, לסנן מקורות אמינים, לסכם, לחלץ ציטוטים
- **לא יודעת:** ליצור תמונות, לשכתב בסגנון הפרויקט, לגשת ל-API חיצוני

## Open Questions
- ראובן — טרם הוגדר כ-agent. כרגע מייצג את ה-CEO / המשתמש.

## Session Log

### 2026-04-27 — יצירת agent חן [shipped]
- **What was done:** נוצר AGENT.md עם 7-שלבי workflow, Memory Protocol, Source Quality Filters. נוצר SKILL.md לחיפוש רשת איכותי (query building, source evaluation, structured extraction). נוצר `Memory/searches.md` לתיעוד חיפושים. CEO Agent עודכן: "Research Agent" הוחלף ב-חן ב-Registry ו-Routing.
- **Decisions:** חן לא קוראת ישירות ליעל — Flow: חן → ראובן → יעל → Output. Memory Protocol: בדיקה לפני כל חיפוש, תיעוד אחרי כל חיפוש.
- **Notes / Caveats:** "ראובן" מוזכר ב-AGENT.md כסוכן המפעיל — טרם הוגדר רשמית. יכול להיות CEO Agent או agent עתידי.
- **Related:** [[agent-yael]], [[agent-yuval]], [[ceo-agent-prd]], [[agents-folder]]

# Agent — יובל

## Overview
הקובץ `.claude/AGENTS/yuval/AGENT.md` מגדיר סוכן קריאייטיב בשם יובל (role: specialist). יובל סורק תמונות ב-`reference/` בשורש הפרויקט, מנתח סגנון/צבעים/קומפוזיציה, מחלץ מרכיבים רלוונטיים, ומנסח prompt שמשלב בין הבקשה לסגנון. לאחר מכן מפעיל את nano-banana-2 skill ושומר את התמונה ב-`outputs/`. מטרה: עקביות ויזואלית בין כל תמונות הפרויקט. CEO Agent מנתב אליו כשמתבקשת יצירת תמונה.

## Open Questions
- none

## Session Log

### 2026-04-27 — יצירת agent יובל [shipped]
- **What was done:** נוצר AGENT.md עם 5-שלבי workflow, Prompt Formula, Reference Analysis Guide, ו-Output Naming convention. CEO Agent עודכן לכלול יובל ב-Registry ו-Routing Logic.
- **Decisions:** תיקיות reference/ ו-outputs/ נוצרו בשורש הפרויקט. Output naming: `<topic>-YYYYMMDD-HHmm.png`.
- **Notes / Caveats:** אם reference/ ריקה — יובל ממשיך ללא ניתוח ויוצר לפי הבקשה בלבד. Anti-pattern מרכזי: אין לדלג על ניתוח reference גם בבקשות פשוטות.
- **Related:** [[skill-nano-banana-2]], [[ceo-agent-prd]], [[agents-folder]]
